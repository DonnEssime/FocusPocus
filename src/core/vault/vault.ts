import { newRandomId, compareCommands } from '../command/ids';
import type { Command } from '../command/types';
import { joinPath, type FileInfo, type StorageBackend } from '../storage/backend';
import {
  APP_VERSION,
  isManifest,
  MANIFEST_FILE,
  MANIFEST_KIND,
  SEGMENT_CLOSED,
  SEGMENT_HEADER,
  VAULT_FORMAT_VERSION,
  type SegmentHeader,
  type VaultManifest,
} from './format';
import { LIVE_DIR, LOG_DIR, liveSegmentName, logFileMonth, monthFileName, utcDay, utcMonth } from './paths';
import { decodeLogBytes, encodeLine, gzip, parseSegmentText, sha256Hex, type ParsedSegment } from './segment';

export type VaultFolderKind = 'vault' | 'empty' | 'other';

export async function readManifest(backend: StorageBackend): Promise<VaultManifest | null> {
  if (!(await backend.stat(MANIFEST_FILE))) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(await backend.read(MANIFEST_FILE)));
    return isManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Is this folder an existing vault, empty (a new vault may be created), or something else? */
export async function inspectVaultFolder(backend: StorageBackend): Promise<VaultFolderKind> {
  if (await readManifest(backend)) return 'vault';
  const entries = (await backend.list('')).filter((e) => !e.name.startsWith('.'));
  return entries.length === 0 ? 'empty' : 'other';
}

export async function createVault(backend: StorageBackend, now: () => number = Date.now): Promise<VaultManifest> {
  const manifest: VaultManifest = {
    kind: MANIFEST_KIND,
    format: VAULT_FORMAT_VERSION,
    vaultId: newRandomId(),
    createdAt: now(),
    app: APP_VERSION,
  };
  await backend.write(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export interface VaultOptions {
  writerId: string;
  now?: () => number;
  /** Debounce before writing queued commands (default 2 s). */
  flushDelayMs?: number;
  /** Upper bound on how long a command may wait in memory (default 10 s). */
  maxFlushDelayMs?: number;
  /** Retry delay after a failed write (default 5 s). */
  retryDelayMs?: number;
  /** An unclosed live segment untouched this long belongs to a crashed writer (default 7 days). */
  staleSegmentMs?: number;
}

export interface VaultWriteStatus {
  pending: number;
  saving: boolean;
  error: string | null;
}

export interface CompactionReport {
  months: string[];
  removed: number;
}

interface LogFile extends FileInfo {
  path: string;
  dir: string;
  month: string;
}

interface Segment {
  path: string;
  day: string;
  started: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function signature(f: FileInfo): string {
  return `${f.size}:${f.lastModified}`;
}

/**
 * Persistence for one writer. Concurrency model (README §4.5):
 * - this writer only ever appends to its own live segment files;
 * - files other writers produce are only read (union by command id happens in the runner);
 * - compaction writes an immutable month file before deleting the sources it contains.
 */
export class Vault {
  readonly writerId: string;
  private readonly now: () => number;
  private readonly flushDelayMs: number;
  private readonly maxFlushDelayMs: number;
  private readonly retryDelayMs: number;
  private readonly staleSegmentMs: number;

  private _readOnly: 'newerFormat' | null;
  private readonly known = new Map<string, string>();
  private readonly ownPaths = new Set<string>();
  private segment: Segment | null = null;
  private segmentCounter = 0;

  private pending: Command[] = [];
  private firstPendingAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private saving = false;
  private error: string | null = null;
  private readonly listeners = new Set<() => void>();

  private constructor(
    readonly backend: StorageBackend,
    readonly manifest: VaultManifest,
    options: VaultOptions,
  ) {
    this.writerId = options.writerId;
    this.now = options.now ?? Date.now;
    this.flushDelayMs = options.flushDelayMs ?? 2_000;
    this.maxFlushDelayMs = options.maxFlushDelayMs ?? 10_000;
    this.retryDelayMs = options.retryDelayMs ?? 5_000;
    this.staleSegmentMs = options.staleSegmentMs ?? 7 * DAY_MS;
    this._readOnly = manifest.format > VAULT_FORMAT_VERSION ? 'newerFormat' : null;
  }

  static async open(backend: StorageBackend, options: VaultOptions): Promise<Vault> {
    const manifest = await readManifest(backend);
    if (!manifest) throw new Error('This folder is not a FocusPocus vault.');
    return new Vault(backend, manifest, options);
  }

  get readOnlyReason(): 'newerFormat' | null {
    return this._readOnly;
  }

  get status(): VaultWriteStatus {
    return { pending: this.pending.length, saving: this.saving, error: this.error };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---------------------------------------------------------------- writing

  /** Queue a command for the next coalesced write. */
  enqueue(cmd: Command): void {
    if (this._readOnly) return;
    if (this.pending.length === 0) this.firstPendingAt = this.now();
    this.pending.push(cmd);
    const deadline = Math.min(this.now() + this.flushDelayMs, this.firstPendingAt + this.maxFlushDelayMs);
    this.setTimer(deadline - this.now());
    this.emit();
  }

  /** Write everything queued now (e.g. when the window is hidden). */
  flush(): Promise<void> {
    this.clearTimer();
    this.chain = this.chain.then(() => this.writePending());
    return this.chain;
  }

  /**
   * Flush and mark the current segment closed (it becomes eligible for compaction). A later
   * write starts a fresh segment file.
   */
  async close(): Promise<void> {
    await this.flush();
    this.chain = this.chain.then(() => this.finishSegment()).catch((e: unknown) => this.setError(e));
    await this.chain;
  }

  dispose(): void {
    this.clearTimer();
    this.listeners.clear();
  }

  private setTimer(delayMs: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, Math.max(0, delayMs));
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async writePending(): Promise<void> {
    if (this.pending.length === 0 || this._readOnly) return;
    const batch = this.pending;
    this.pending = [];
    this.saving = true;
    this.emit();
    try {
      const day = utcDay(this.now());
      if (this.segment && this.segment.day !== day) await this.finishSegment();
      this.segment ??= {
        path: joinPath(LIVE_DIR, liveSegmentName(day, this.writerId, this.segmentCounter++)),
        day,
        started: false,
      };
      const seg = this.segment;
      let text = '';
      if (!seg.started) {
        const header: SegmentHeader = { t: SEGMENT_HEADER, format: VAULT_FORMAT_VERSION, app: APP_VERSION, w: this.writerId };
        text += `${encodeLine(header)}\n`;
      }
      text += `${batch.map(encodeLine).join('\n')}\n`;
      await this.backend.append(seg.path, text);
      seg.started = true;
      this.ownPaths.add(seg.path);
      this.error = null;
    } catch (e) {
      this.pending = batch.concat(this.pending);
      this.setError(e);
      this.setTimer(this.retryDelayMs);
    } finally {
      this.saving = false;
      this.emit();
    }
  }

  private async finishSegment(): Promise<void> {
    const seg = this.segment;
    this.segment = null;
    if (!seg?.started) return;
    // Never recreate a file that compaction already removed.
    if (await this.backend.stat(seg.path)) {
      await this.backend.append(seg.path, `${encodeLine({ t: SEGMENT_CLOSED })}\n`);
    }
  }

  private setError(e: unknown): void {
    this.error = e instanceof Error ? e.message : String(e);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  // ---------------------------------------------------------------- reading

  /** Read every log file in the vault. Duplicates across files are expected; the runner dedupes. */
  async loadAll(): Promise<Command[]> {
    const files = await this.listLogFiles();
    const out: Command[] = [];
    await Promise.all(
      files.map(async (f) => {
        const parsed = await this.readLog(f.path);
        this.known.set(f.path, signature(f));
        for (const c of parsed.commands) out.push(c);
      }),
    );
    return out;
  }

  /** Commands from files that are new or changed since the last load/poll (own files excluded). */
  async poll(): Promise<Command[]> {
    const files = await this.listLogFiles();
    const present = new Set<string>();
    const out: Command[] = [];
    for (const f of files) {
      present.add(f.path);
      if (this.ownPaths.has(f.path)) continue;
      const sig = signature(f);
      if (this.known.get(f.path) === sig) continue;
      let parsed: ParsedSegment;
      try {
        parsed = await this.readLog(f.path);
      } catch {
        continue; // vanished between list and read (e.g. compacted); its content is elsewhere
      }
      this.known.set(f.path, sig);
      for (const c of parsed.commands) out.push(c);
    }
    for (const path of [...this.known.keys()]) if (!present.has(path)) this.known.delete(path);
    return out;
  }

  private async listLogFiles(): Promise<LogFile[]> {
    const out: LogFile[] = [];
    for (const dir of [LOG_DIR, LIVE_DIR]) {
      for (const f of await this.backend.list(dir)) {
        if (f.kind !== 'file') continue;
        const month = logFileMonth(f.name);
        if (month) out.push({ ...f, path: joinPath(dir, f.name), dir, month });
      }
    }
    return out;
  }

  private async readLog(path: string): Promise<ParsedSegment> {
    const parsed = parseSegmentText(await decodeLogBytes(await this.backend.read(path)));
    if (parsed.header && parsed.header.format > VAULT_FORMAT_VERSION) this._readOnly = 'newerFormat';
    return parsed;
  }

  // ---------------------------------------------------------------- compaction

  /**
   * Merge finished segments of past months into one immutable gzip file per month, then delete
   * the merged sources. Safe to run concurrently on several computers: the output name is
   * derived from the content, and duplicates are harmless because loading dedupes by id.
   */
  async compact(): Promise<CompactionReport> {
    const report: CompactionReport = { months: [], removed: 0 };
    if (this._readOnly) return report;
    const currentMonth = utcMonth(this.now());
    const groups = new Map<string, LogFile[]>();
    for (const f of await this.listLogFiles()) {
      if (f.month >= currentMonth || f.path === this.segment?.path) continue;
      const list = groups.get(f.month);
      if (list) list.push(f);
      else groups.set(f.month, [f]);
    }

    for (const [month, group] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const sources: LogFile[] = [];
      const byId = new Map<string, Command>();
      for (const f of group) {
        let parsed: ParsedSegment;
        try {
          parsed = await this.readLog(f.path);
        } catch {
          continue;
        }
        if (this._readOnly) return report;
        const finished = f.dir !== LIVE_DIR || parsed.closed || this.now() - f.lastModified >= this.staleSegmentMs;
        if (!finished) continue;
        sources.push(f);
        for (const c of parsed.commands) if (!byId.has(c.id)) byId.set(c.id, c);
      }
      if (sources.length === 0) continue;
      if (sources.length === 1 && sources[0]!.dir === LOG_DIR) continue;

      const body = [...byId.values()].sort(compareCommands).map(encodeLine);
      const hash = (await sha256Hex(body.join('\n'))).slice(0, 12);
      const path = joinPath(LOG_DIR, monthFileName(month, hash));
      if (!sources.some((s) => s.path === path)) {
        const header: SegmentHeader = { t: SEGMENT_HEADER, format: VAULT_FORMAT_VERSION, app: APP_VERSION, w: 'month', month };
        const text = [encodeLine(header), ...body, encodeLine({ t: SEGMENT_CLOSED })].join('\n') + '\n';
        await this.backend.write(path, await gzip(text));
      }
      for (const s of sources) {
        if (s.path === path) continue;
        await this.backend.remove(s.path);
        this.known.delete(s.path);
        report.removed++;
      }
      const written = await this.backend.stat(path);
      if (written) this.known.set(path, signature(written));
      report.months.push(month);
    }
    return report;
  }
}
