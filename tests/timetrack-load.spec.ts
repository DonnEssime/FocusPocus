import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/core/command/runner';
import type { Command } from '../src/core/command/types';
import { ModuleRegistry } from '../src/core/module';
import { Session } from '../src/core/session';
import { MemoryBackend } from '../src/core/storage/memory';
import { Vault } from '../src/core/vault/vault';
import { timetrackActions as tt, timetrackModule, type TimetrackState } from '../src/modules/timetrack';
import { dayTotals, NO_TAG, rangeTotals, totalsSlices } from '../src/modules/timetrack/stats';
import { daySequence, monthStart, daysInMonth } from '../src/modules/timetrack/time';
import { MODULES } from '../src/registry';
import { summarize } from './helpers/fixture-summary';

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 4, 8);
const BXL = 'Europe/Brussels';
const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('statistics', () => {
  it('splits time over tags, counts untagged and deleted-tag time as No tag, and splits days', () => {
    let t = T0 + 48 * H;
    const s = new Session({ modules: [timetrackModule], writerId: 'wa', now: () => t++ });
    const id = () => s.runner.commands().at(-1)!.id;
    s.dispatch(tt.createTag({ name: 'A', color: '#1b9e77', description: '' }));
    const a = id();
    s.dispatch(tt.createTag({ name: 'B', color: '#d95f02', description: '' }));
    const b = id();
    s.dispatch(tt.createTag({ name: 'Gone', color: '#7570b3', description: '' }));
    const gone = id();
    s.dispatch(tt.createBlock({ startMs: T0, endMs: T0 + H, title: '', tagIds: [a, b] }));
    s.dispatch(tt.createBlock({ startMs: T0 + H, endMs: T0 + 3 * H, title: '', tagIds: [] }));
    s.dispatch(tt.createBlock({ startMs: T0 + 3 * H, endMs: T0 + 4 * H, title: '', tagIds: [gone] }));
    // 06:00 UTC = 07:00 Brussels: this block crosses from the 4 Nov logical day into the 5 Nov one.
    s.dispatch(tt.createBlock({ startMs: Date.UTC(2026, 10, 5, 5), endMs: Date.UTC(2026, 10, 5, 7), title: '', tagIds: [a] }));
    s.dispatch(tt.deleteTag(gone));
    const st = s.getState<TimetrackState>('timetrack');
    const totals = rangeTotals(st, T0, T0 + 4 * H, t);
    expect(totals.totalMs).toBe(4 * H);
    expect(Object.fromEntries(totals.byTag)).toEqual({ [a]: 0.5 * H, [b]: 0.5 * H, [NO_TAG]: 3 * H });
    expect(totalsSlices(totals).map((x) => [x.key, x.share])).toEqual([[NO_TAG, 0.75], [a, 0.125], [b, 0.125]]);
    const days = dayTotals(st, ['2026-11-04', '2026-11-05'], BXL, 7, t);
    expect(days.get('2026-11-04')!.totalMs).toBe(5 * H);
    expect(days.get('2026-11-05')!.totalMs).toBe(H);
  });

  it('counts the running block up to now', () => {
    const s = new Session({ modules: [timetrackModule], writerId: 'wa', now: () => T0 });
    s.dispatch(tt.startTracking({ startMs: T0 - H, title: '', tagIds: [] }));
    const st = s.getState<TimetrackState>('timetrack');
    expect(rangeTotals(st, T0 - 2 * H, T0 + 2 * H, T0 + 0.5 * H).totalMs).toBe(1.5 * H);
  });
});

describe('scale', () => {
  it('replays ten years of blocks quickly and renders a month without scanning history', () => {
    // About 11 blocks a day for 10 years: 40k blocks plus some tags, edits and undos.
    const start = Date.UTC(2016, 0, 1, 7);
    let t = start;
    const s = new Session({ modules: [timetrackModule], writerId: 'wa', now: () => t });
    const tags: string[] = [];
    for (let i = 0; i < 12; i++) {
      s.dispatch(tt.createTag({ name: `t${i}`, color: '#1b9e77', description: '' }));
      tags.push(s.runner.commands().at(-1)!.id);
    }
    const BLOCKS = 40_000;
    const begin = performance.now();
    for (let i = 0; i < BLOCKS; i++) {
      const day = Math.floor(i / 11);
      const from = start + day * 24 * H + (i % 11) * H;
      t = from + H;
      s.dispatch(tt.createBlock({ startMs: from, endMs: from + 0.75 * H, title: '', tagIds: [tags[i % 12]!] }));
      if (i % 50 === 0) s.dispatch(tt.editBlock({ blockId: s.runner.commands().at(-1)!.id, title: 'edited' }));
      if (i % 97 === 0) s.undo('timetrack');
    }
    const dispatchMs = performance.now() - begin;
    const commands: Command[] = s.runner.commands();

    const replayBegin = performance.now();
    const fresh = new CommandRunner(new ModuleRegistry([timetrackModule]));
    fresh.ingest(commands);
    const st = fresh.getState<TimetrackState>('timetrack');
    const replayMs = performance.now() - replayBegin;

    const month = (day: string) => {
      const first = monthStart(day);
      return dayTotals(st, daySequence(first, daysInMonth(first)), BXL, 7, t);
    };
    month('2021-05-15'); // warm-up: the first call also pays for JIT and calendar setup
    const monthBegin = performance.now();
    const totals = month('2021-06-15');
    const monthMs = performance.now() - monthBegin;

    console.info(
      `[benchmark] ${commands.length} commands: dispatch ${dispatchMs.toFixed(0)} ms, ` +
        `fresh replay ${replayMs.toFixed(0)} ms, month totals ${monthMs.toFixed(2)} ms`,
    );
    expect(st.blocks.where.size).toBeGreaterThan(39_000);
    expect([...totals.values()].every((x) => x.totalMs > 0)).toBe(true);
    // Generous bounds: they catch accidental O(n²) behaviour, not small regressions.
    expect(replayMs).toBeLessThan(1_500);
    expect(monthMs).toBeLessThan(20);
  });
});

describe('frozen fixture vault v1', () => {
  it('loads to exactly the recorded state', async () => {
    const dir = join(FIXTURES, 'vault-v1');
    const backend = new MemoryBackend(() => Date.UTC(2026, 10, 4));
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    for (const file of walk(dir)) await backend.write(relative(dir, file), new Uint8Array(readFileSync(file)));
    const vault = await Vault.open(backend, { writerId: 'reader', now: backend.now });
    expect(vault.readOnlyReason).toBeNull();
    const session = new Session({ modules: MODULES, writerId: 'reader' });
    session.ingest(await vault.loadAll());
    const expected = JSON.parse(readFileSync(join(FIXTURES, 'vault-v1.expected.json'), 'utf8'));
    expect(JSON.parse(JSON.stringify(summarize(session)))).toEqual(expected);
  });
});
