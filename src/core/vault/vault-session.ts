import { newWriterId } from '../command/ids';
import { Session, type ReadOnlyReason, type SessionOptions } from '../session';
import type { StorageBackend } from '../storage/backend';
import type { BroadcastPort, SyncMessage } from './broadcast';
import { Vault, type VaultOptions } from './vault';

export interface VaultSessionOptions
  extends Omit<SessionOptions, 'writerId'>,
    Omit<VaultOptions, 'writerId' | 'now'> {
  writerId?: string;
  /** Same-browser window sync (BroadcastChannel in the web app). */
  broadcast?: (vaultId: string) => BroadcastPort | null;
  /** Mutual exclusion within one browser (Web Locks in the web app). */
  withLock?: (name: string, fn: () => Promise<void>) => Promise<void>;
  /** How often to look for other computers' changes (default 15 s). */
  pollIntervalMs?: number;
  /** Delay before the first compaction after opening (default 30 s). */
  compactionDelayMs?: number;
  /** Interval between compactions while open (default 6 h). */
  compactionIntervalMs?: number;
}

export interface VaultSessionStatus {
  pending: number;
  saving: boolean;
  error: string | null;
  readOnly: ReadOnlyReason | null;
  rejected: number;
}

/** A Session wired to a Vault: loading, persistence, polling, window sync, compaction. */
export class VaultSession {
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: Array<() => void> = [];
  private readonly timers: Array<ReturnType<typeof setTimeout>> = [];
  private polling: Promise<void> | null = null;
  private closed = false;

  private constructor(
    readonly vault: Vault,
    readonly session: Session,
    private readonly port: BroadcastPort | null,
    private readonly options: VaultSessionOptions,
  ) {
    this.cleanups.push(
      session.onCommit((cmd) => {
        vault.enqueue(cmd);
        port?.post({ kind: 'commands', from: session.writerId, cmds: [cmd] });
      }),
      session.subscribe(() => this.emit()),
      vault.subscribe(() => this.emit()),
    );
    if (port) this.cleanups.push(port.onMessage((m) => this.onMessage(m)));
  }

  static async open(backend: StorageBackend, options: VaultSessionOptions): Promise<VaultSession> {
    const writerId = options.writerId ?? newWriterId();
    const vault = await Vault.open(backend, { ...options, writerId });
    const session = new Session({ ...options, writerId });
    session.ingest(await vault.loadAll());
    if (vault.readOnlyReason) session.setReadOnly(vault.readOnlyReason);
    const port = options.broadcast?.(vault.manifest.vaultId) ?? null;
    return new VaultSession(vault, session, port, options);
  }

  /** Start background work: polling, compaction, and asking sibling windows for unsaved commands. */
  start(): void {
    const poll = this.options.pollIntervalMs ?? 15_000;
    this.timers.push(setInterval(() => void this.pollNow(), poll));
    this.timers.push(setTimeout(() => void this.compactNow(), this.options.compactionDelayMs ?? 30_000));
    this.timers.push(setInterval(() => void this.compactNow(), this.options.compactionIntervalMs ?? 6 * 3_600_000));
    this.port?.post({ kind: 'hello', from: this.session.writerId });
  }

  get status(): VaultSessionStatus {
    const s = this.vault.status;
    return {
      ...s,
      readOnly: this.session.readOnly,
      rejected: this.session.runner.issues().rejected.length,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Pick up changes written by other computers (or windows of another browser). */
  pollNow(): Promise<void> {
    this.polling ??= (async () => {
      try {
        const cmds = await this.vault.poll();
        if (this.vault.readOnlyReason) this.session.setReadOnly(this.vault.readOnlyReason);
        this.session.ingest(cmds);
      } finally {
        this.polling = null;
      }
    })();
    return this.polling;
  }

  async compactNow(): Promise<void> {
    const run = async () => {
      await this.vault.compact();
    };
    try {
      if (this.options.withLock) await this.options.withLock(`focuspocus:compact:${this.vault.manifest.vaultId}`, run);
      else await run();
    } catch {
      // Compaction is an optimisation; a failure must never affect the session.
    }
  }

  flush(): Promise<void> {
    return this.vault.flush();
  }

  /** Flush and close the current segment (window hidden or page being unloaded). */
  suspend(): Promise<void> {
    return this.vault.close();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    await this.vault.close();
    this.vault.dispose();
    for (const c of this.cleanups) c();
    this.port?.close();
    this.listeners.clear();
  }

  private onMessage(message: SyncMessage): void {
    if (message.from === this.session.writerId) return;
    if (message.kind === 'hello') {
      const own = this.session.ownCommands();
      if (own.length) this.port?.post({ kind: 'commands', from: this.session.writerId, cmds: own });
    } else {
      this.session.ingest(message.cmds);
    }
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
