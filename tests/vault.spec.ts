import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../src/core/command/types';
import { MemoryBackend } from '../src/core/storage/memory';
import { MANIFEST_FILE, VAULT_FORMAT_VERSION } from '../src/core/vault/format';
import { LIVE_DIR, LOG_DIR } from '../src/core/vault/paths';
import { decodeLogBytes, parseSegmentText } from '../src/core/vault/segment';
import { createVault, inspectVaultFolder, Vault } from '../src/core/vault/vault';

const OCT_30 = Date.UTC(2026, 9, 30, 12);
const NOV_04 = Date.UTC(2026, 10, 4, 12);
const DAY = 86_400_000;

function cmd(id: string, at: number, n = 1): Command {
  return { id, t: 'ctr.Add', v: 1, at, p: { n } };
}

class Clock {
  constructor(public t: number) {}
  now = () => this.t;
}

async function setup(start = NOV_04) {
  const clock = new Clock(start);
  const backend = new MemoryBackend(clock.now);
  await createVault(backend, clock.now);
  return { clock, backend };
}

async function readFile(backend: MemoryBackend, path: string) {
  return parseSegmentText(await decodeLogBytes(await backend.read(path)));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('vault folder', () => {
  it('distinguishes vaults, empty folders and other folders', async () => {
    const backend = new MemoryBackend();
    expect(await inspectVaultFolder(backend)).toBe('empty');
    await backend.write('.DS_Store', 'x');
    expect(await inspectVaultFolder(backend)).toBe('empty');
    await backend.write('notes.txt', 'hello');
    expect(await inspectVaultFolder(backend)).toBe('other');
    await expect(Vault.open(backend, { writerId: 'wa' })).rejects.toThrow();
    const fresh = new MemoryBackend();
    const manifest = await createVault(fresh);
    expect(manifest.format).toBe(VAULT_FORMAT_VERSION);
    expect(await inspectVaultFolder(fresh)).toBe('vault');
  });

  it('opens a vault with a newer format read-only and never writes to it', async () => {
    const { backend, clock } = await setup();
    const manifest = JSON.parse(backend.text(MANIFEST_FILE));
    await backend.write(MANIFEST_FILE, JSON.stringify({ ...manifest, format: VAULT_FORMAT_VERSION + 1 }));
    const vault = await Vault.open(backend, { writerId: 'wa', now: clock.now });
    expect(vault.readOnlyReason).toBe('newerFormat');
    vault.enqueue(cmd('wa.1', clock.t));
    await vault.flush();
    expect(backend.paths(LOG_DIR)).toEqual([]);
  });

  it('switches to read-only when a segment with a newer format shows up', async () => {
    const { backend, clock } = await setup();
    const vault = await Vault.open(backend, { writerId: 'wa', now: clock.now });
    await vault.loadAll();
    await backend.write(`${LIVE_DIR}/2026-11-04.wb.0.jsonl`, `${JSON.stringify({ t: 'core.SegmentHeader', format: 99, app: '9.0.0', w: 'wb' })}\n`);
    await vault.poll();
    expect(vault.readOnlyReason).toBe('newerFormat');
  });
});

describe('writing', () => {
  it('appends to its own live segment, with a header only on the first write', async () => {
    const { backend, clock } = await setup();
    const vault = await Vault.open(backend, { writerId: 'wa', now: clock.now });
    vault.enqueue(cmd('wa.1', clock.t));
    vault.enqueue(cmd('wa.2', clock.t + 1));
    await vault.flush();
    vault.enqueue(cmd('wa.3', clock.t + 2));
    await vault.flush();
    const [path] = backend.paths(LIVE_DIR);
    expect(path).toBe(`${LIVE_DIR}/2026-11-04.wa.0.jsonl`);
    const parsed = await readFile(backend, path!);
    expect(parsed.header).toMatchObject({ format: VAULT_FORMAT_VERSION, w: 'wa' });
    expect(parsed.commands.map((c) => c.id)).toEqual(['wa.1', 'wa.2', 'wa.3']);
    expect(backend.text(path!).match(/SegmentHeader/g)).toHaveLength(1);
  });

  it('coalesces bursts into one write (debounce, bounded by max wait)', async () => {
    vi.useFakeTimers({ now: NOV_04 });
    const backend = new MemoryBackend();
    await createVault(backend);
    const vault = await Vault.open(backend, { writerId: 'wa' });
    const writesBefore = backend.writes;
    for (let i = 1; i <= 5; i++) {
      vault.enqueue(cmd(`wa.${i}`, Date.now()));
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(backend.writes).toBe(writesBefore);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(backend.writes).toBe(writesBefore + 1);

    // A steady stream never waits longer than the max delay.
    for (let i = 6; i <= 30; i++) {
      vault.enqueue(cmd(`wa.${i}`, Date.now()));
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(backend.writes).toBe(writesBefore + 2);
  });

  it('rotates to a new segment at the UTC day boundary and closes the old one', async () => {
    const { backend, clock } = await setup();
    const vault = await Vault.open(backend, { writerId: 'wa', now: clock.now });
    vault.enqueue(cmd('wa.1', clock.t));
    await vault.flush();
    clock.t += DAY;
    vault.enqueue(cmd('wa.2', clock.t));
    await vault.flush();
    const paths = backend.paths(LIVE_DIR);
    expect(paths).toEqual([`${LIVE_DIR}/2026-11-04.wa.0.jsonl`, `${LIVE_DIR}/2026-11-05.wa.1.jsonl`]);
    expect((await readFile(backend, paths[0]!)).closed).toBe(true);
    expect((await readFile(backend, paths[1]!)).closed).toBe(false);
  });

  it('keeps commands queued and retries when a write fails', async () => {
    vi.useFakeTimers({ now: NOV_04 });
    const backend = new MemoryBackend();
    await createVault(backend);
    const vault = await Vault.open(backend, { writerId: 'wa' });
    backend.failNextWrites = 1;
    vault.enqueue(cmd('wa.1', Date.now()));
    await vault.flush();
    expect(vault.status).toMatchObject({ pending: 1 });
    expect(vault.status.error).toMatch(/Simulated/);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(vault.status).toEqual({ pending: 0, saving: false, error: null });
    const parsed = await readFile(backend, backend.paths(LIVE_DIR)[0]!);
    expect(parsed.header).not.toBeNull();
    expect(parsed.commands).toHaveLength(1);
  });
});

describe('reading', () => {
  it('loads every writer and conflict copies, and polls only new or changed foreign files', async () => {
    const { backend, clock } = await setup();
    const a = await Vault.open(backend, { writerId: 'wa', now: clock.now });
    const b = await Vault.open(backend, { writerId: 'wb', now: clock.now });
    a.enqueue(cmd('wa.1', clock.t));
    await a.flush();
    b.enqueue(cmd('wb.1', clock.t));
    await b.flush();
    await backend.write(`${LIVE_DIR}/2026-11-04 (1).wb.0.jsonl`, backend.text(`${LIVE_DIR}/2026-11-04.wb.0.jsonl`));

    const loaded = await a.loadAll();
    expect(loaded.map((c) => c.id).sort()).toEqual(['wa.1', 'wb.1', 'wb.1']);
    expect(await a.poll()).toEqual([]);

    a.enqueue(cmd('wa.2', clock.t + 1));
    await a.flush();
    expect(await a.poll()).toEqual([]); // own file is never re-read

    clock.t += 1;
    b.enqueue(cmd('wb.2', clock.t));
    await b.flush();
    expect((await a.poll()).map((c) => c.id)).toEqual(['wb.1', 'wb.2']);
  });

  it('skips torn or garbage lines instead of failing', async () => {
    const { backend, clock } = await setup();
    await backend.write(`${LIVE_DIR}/2026-11-04.wb.0.jsonl`, `${JSON.stringify(cmd('wb.1', clock.t))}\n{"id":"wb.2","t":"ctr.A`);
    const vault = await Vault.open(backend, { writerId: 'wa', now: clock.now });
    expect((await vault.loadAll()).map((c) => c.id)).toEqual(['wb.1']);
  });
});

describe('compaction', () => {
  async function octoberSegments() {
    const { backend, clock } = await setup(OCT_30);
    const a = await Vault.open(backend, { writerId: 'wa', now: clock.now });
    const b = await Vault.open(backend, { writerId: 'wb', now: clock.now });
    a.enqueue(cmd('wa.1', clock.t));
    b.enqueue(cmd('wb.1', clock.t + 1));
    await a.close(); // closed segment
    await b.flush(); // left open (still running, or crashed)
    clock.t = NOV_04;
    return { backend, clock };
  }

  it('merges finished segments of past months into one month file and removes the sources', async () => {
    const { backend, clock } = await octoberSegments();
    const c = await Vault.open(backend, { writerId: 'wc', now: clock.now });
    const report = await c.compact();
    expect(report).toEqual({ months: ['2026-10'], removed: 1 });
    const monthFiles = backend.paths(LOG_DIR).filter((p) => p.endsWith('.jsonl.gz'));
    expect(monthFiles).toHaveLength(1);
    expect(monthFiles[0]).toMatch(/^log\/2026-10\.[0-9a-f]{12}\.jsonl\.gz$/);
    expect((await readFile(backend, monthFiles[0]!)).commands.map((x) => x.id)).toEqual(['wa.1']);
    // The open segment is untouched until it is closed or stale.
    expect(backend.paths(LIVE_DIR)).toEqual([`${LIVE_DIR}/2026-10-30.wb.0.jsonl`]);

    clock.t = OCT_30 + 8 * DAY;
    await c.compact();
    expect(backend.paths(LIVE_DIR)).toEqual([]);
    const all = await (await Vault.open(backend, { writerId: 'wd', now: clock.now })).loadAll();
    expect(all.map((x) => x.id).sort()).toEqual(['wa.1', 'wb.1']);
    expect(backend.paths(LOG_DIR).filter((p) => p.endsWith('.gz'))).toHaveLength(1);
    expect(await c.compact()).toEqual({ months: [], removed: 0 });
  });

  it('is safe when two computers compact the same month at the same time', async () => {
    const { backend, clock } = await octoberSegments();
    clock.t = OCT_30 + 8 * DAY;
    const other = new MemoryBackend(clock.now);
    for (const [p, f] of backend.files) other.files.set(p, { ...f, data: f.data.slice() });

    const x = await Vault.open(backend, { writerId: 'wx', now: clock.now });
    const y = await Vault.open(other, { writerId: 'wy', now: clock.now });
    await Promise.all([x.compact(), y.compact()]);
    // Same content → same file name and bytes on both sides: nothing for the sync client to fight over.
    expect(backend.paths(LOG_DIR)).toEqual(other.paths(LOG_DIR));
    const [month] = backend.paths(LOG_DIR);
    expect(backend.files.get(month!)!.data).toEqual(other.files.get(month!)!.data);
  });

  it('folds duplicate month files (e.g. conflict copies) into one', async () => {
    const { backend, clock } = await octoberSegments();
    const c = await Vault.open(backend, { writerId: 'wc', now: clock.now });
    await c.compact();
    const [month] = backend.paths(LOG_DIR).filter((p) => p.endsWith('.gz'));
    await backend.write(month!.replace('.jsonl.gz', ' (1).jsonl.gz'), await backend.read(month!));
    clock.t = OCT_30 + 8 * DAY;
    await c.compact();
    expect(backend.paths(LOG_DIR).filter((p) => p.endsWith('.gz'))).toHaveLength(1);
  });
});
