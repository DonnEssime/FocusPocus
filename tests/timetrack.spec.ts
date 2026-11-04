import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/core/command/runner';
import type { Command } from '../src/core/command/types';
import { ModuleRegistry } from '../src/core/module';
import { pmapDelete, pmapEmpty, pmapEntries, pmapGet, pmapSet } from '../src/core/pmap';
import { Session } from '../src/core/session';
import { allBlocks, blocksInRange, neighbours } from '../src/modules/timetrack/blocks';
import {
  blockTags,
  duplicateTagIds,
  liveTags,
  nextTagColor,
  runningBlock,
  timetrackActions as tt,
  timetrackModule,
  type TimetrackState,
} from '../src/modules/timetrack';
import {
  addDays,
  dayRange,
  hourMarks,
  logicalDayOf,
  monthStart,
  weekStart,
  windowRange,
} from '../src/modules/timetrack/time';
import { rng } from './helpers/test-modules';

const H = 3_600_000;
const M = 60_000;
/** 08:00 UTC on Wednesday 4 Nov 2026. */
const T0 = Date.UTC(2026, 10, 4, 8);
const BXL = 'Europe/Brussels';

class Clock {
  constructor(public t: number) {}
  now = () => this.t;
}

function session(writerId = 'wa', clock = new Clock(T0 + 12 * H)) {
  return { s: new Session({ modules: [timetrackModule], writerId, now: clock.now }), clock };
}

const state = (s: Session) => s.getState<TimetrackState>('timetrack');
const lastId = (s: Session) => s.runner.commands().at(-1)!.id;
/** Hours since T0, to the nearest second (command timestamps advance a millisecond per command). */
const hours = (ms: number) => Math.round((ms - T0) / 1000) / 3600;
/** Blocks as `[startHour, endHour | null, title]`, hours relative to T0. */
const spans = (s: Session) =>
  [...allBlocks(state(s).blocks)].map((b) => [
    hours(b.startMs),
    b.endMs === null ? null : hours(b.endMs),
    b.title,
  ]);

function create(s: Session, from: number, to: number, title = '', tagIds: string[] = []) {
  return s.dispatch(tt.createBlock({ startMs: T0 + from * H, endMs: T0 + to * H, title, tagIds }));
}

describe('persistent map', () => {
  it('sets, gets and deletes without touching earlier versions', () => {
    let m = pmapEmpty<number>();
    const versions = [m];
    for (let i = 0; i < 500; i++) versions.push((m = pmapSet(m, `k${i}`, i)));
    expect(m.size).toBe(500);
    expect(pmapGet(m, 'k123')).toBe(123);
    const smaller = pmapDelete(m, 'k123');
    expect(pmapGet(smaller, 'k123')).toBeUndefined();
    expect(pmapGet(m, 'k123')).toBe(123);
    expect(smaller.size).toBe(499);
    expect(pmapGet(versions[10]!, 'k20')).toBeUndefined();
    expect([...pmapEntries(smaller)]).toHaveLength(499);
    expect(pmapSet(m, 'k1', 1)).toBe(m);
  });
});

describe('time model', () => {
  it('maps instants to logical days in the given zone', () => {
    // 01:30 in Brussels on 5 Nov is still the 4 Nov day when days start at 07:00.
    const lateNight = Date.UTC(2026, 10, 5, 0, 30);
    expect(logicalDayOf(lateNight, BXL, 7)).toBe('2026-11-04');
    expect(logicalDayOf(lateNight, BXL, 0)).toBe('2026-11-05');
    // The same instant is a different day elsewhere: time zones are transparent.
    expect(logicalDayOf(lateNight, 'Asia/Tokyo', 7)).toBe('2026-11-05');
    expect(logicalDayOf(lateNight, 'America/New_York', 7)).toBe('2026-11-04');
  });

  it('gives logical days of 23, 24 and 25 hours across daylight-saving changes', () => {
    const len = (day: string) => {
      const r = dayRange(day, BXL, 7);
      return (r.to - r.from) / H;
    };
    expect(len('2026-03-28')).toBe(23); // clocks go forward early on 29 March
    expect(len('2026-03-29')).toBe(24);
    expect(len('2026-10-24')).toBe(25); // clocks go back early on 25 October
    expect(dayRange('2026-11-04', BXL, 7).from).toBe(Date.UTC(2026, 10, 4, 6));
  });

  it('computes the visible window, which may end on the next day', () => {
    const w = windowRange('2026-11-04', BXL, { startHour: 7, endHour: 5 });
    expect(w).toEqual({ from: Date.UTC(2026, 10, 4, 6), to: Date.UTC(2026, 10, 5, 4) });
    const same = windowRange('2026-11-04', BXL, { startHour: 9, endHour: 17 });
    expect((same.to - same.from) / H).toBe(8);
    const full = windowRange('2026-11-04', BXL, { startHour: 6, endHour: 6 });
    expect((full.to - full.from) / H).toBe(24);
  });

  it('repeats or skips hour labels on daylight-saving days', () => {
    const fallBack = hourMarks('2026-10-25', BXL, { startHour: 0, endHour: 0 }).map((m) => m.hour);
    expect(fallBack).toHaveLength(25);
    expect(fallBack.slice(0, 5)).toEqual([0, 1, 2, 2, 3]);
    const springForward = hourMarks('2026-03-29', BXL, { startHour: 0, endHour: 0 }).map((m) => m.hour);
    expect(springForward.slice(0, 4)).toEqual([0, 1, 3, 4]);
  });

  it('starts weeks on Monday and navigates calendar dates', () => {
    expect(weekStart('2026-11-04')).toBe('2026-11-02');
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
    expect(monthStart('2026-11-04')).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('blocks', () => {
  it('creates blocks and rejects malformed ones', () => {
    const { s } = session();
    expect(create(s, 1, 2, 'Write').ok).toBe(true);
    expect(create(s, 3, 3)).toMatchObject({ ok: false, reason: 'timetrack.error.invalidBlock' });
    expect(create(s, 5, 4).ok).toBe(false);
    expect(create(s, 4, 5, 'x', ['nope'])).toMatchObject({ reason: 'core.missingDependency' });
    expect(create(s, 4, 5, 'x'.repeat(201)).ok).toBe(false);
    expect(spans(s)).toEqual([[1, 2, 'Write']]);
    expect(state(s).blocks.where.size).toBe(1);
  });

  it('truncates the later-starting block, removes covered ones, and undo restores them', () => {
    const { s } = session();
    create(s, 2, 4, 'B');
    create(s, 5, 6, 'C');
    create(s, 1, 3, 'A'); // A starts first: B is truncated to start at 3
    expect(spans(s)).toEqual([[1, 3, 'A'], [3, 4, 'B'], [5, 6, 'C']]);
    create(s, 0, 7, 'Z'); // covers everything that starts later
    expect(spans(s)).toEqual([[0, 7, 'Z']]);
    s.undo('timetrack');
    expect(spans(s)).toEqual([[1, 3, 'A'], [3, 4, 'B'], [5, 6, 'C']]);
    s.undo('timetrack');
    expect(spans(s)).toEqual([[2, 4, 'B'], [5, 6, 'C']]);
  });

  it('truncates a new block that starts inside an earlier one, and rejects it when fully covered', () => {
    const { s } = session();
    create(s, 1, 3, 'A');
    create(s, 2, 4, 'B');
    expect(spans(s)).toEqual([[1, 3, 'A'], [3, 4, 'B']]);
    expect(create(s, 1.5, 2.5)).toMatchObject({ ok: false, reason: 'timetrack.error.blockCovered' });
    expect(state(s).blocks.where.size).toBe(2);
  });

  it('edits only the given fields, re-applies the overlap rule on time changes, and finds neighbours', () => {
    const { s } = session();
    create(s, 1, 2, 'A');
    const a = lastId(s);
    create(s, 3, 4, 'B');
    expect(s.dispatch(tt.editBlock({ blockId: a, title: 'A2' })).ok).toBe(true);
    expect(s.dispatch(tt.editBlock({ blockId: a, endMs: T0 + 3.5 * H })).ok).toBe(true);
    expect(spans(s)).toEqual([[1, 3.5, 'A2'], [3.5, 4, 'B']]);
    expect(s.dispatch(tt.editBlock({ blockId: a }))).toMatchObject({ reason: 'timetrack.error.noChanges' });
    expect(s.dispatch(tt.editBlock({ blockId: a, startMs: T0 + 4 * H })).ok).toBe(false); // inside out
    const block = [...allBlocks(state(s).blocks)][1]!;
    expect(neighbours(state(s).blocks, block).prev?.id).toBe(a);
    expect(neighbours(state(s).blocks, block).next).toBeUndefined();
    s.undo('timetrack');
    expect(spans(s)).toEqual([[1, 2, 'A2'], [3, 4, 'B']]);
  });

  it('queries a range, including the block that reaches into it from before', () => {
    const { s } = session();
    for (let i = 0; i < 200; i++) create(s, i * 2, i * 2 + 1.5, `b${i}`);
    const titles = (from: number, to: number) =>
      blocksInRange(state(s).blocks, T0 + from * H, T0 + to * H, T0).map((b) => b.title);
    expect(titles(1, 4)).toEqual(['b0', 'b1']);
    expect(titles(1.6, 1.9)).toEqual([]);
    expect(titles(397, 1000)).toEqual(['b198', 'b199']);
    expect(titles(-10, 0)).toEqual([]);
  });

  it('deletes blocks, and dependency-blocks undoing a create while an edit depends on it', () => {
    const { s } = session();
    create(s, 1, 2);
    const id = lastId(s);
    s.dispatch(tt.editBlock({ blockId: id, title: 'x' }));
    expect(s.dispatch(tt.deleteBlock(id)).ok).toBe(true);
    expect(s.dispatch(tt.deleteBlock(id))).toMatchObject({ reason: 'timetrack.error.noSuchBlock' });
    expect(spans(s)).toEqual([]);
    s.undo('timetrack');
    expect(spans(s)).toEqual([[1, 2, 'x']]);
  });
});

describe('tracking', () => {
  it('runs a block until stopped, and undoing the stop makes it run again', () => {
    const { s, clock } = session();
    s.dispatch(tt.startTracking({ startMs: T0, title: 'Run', tagIds: [] }));
    const id = lastId(s);
    expect(runningBlock(state(s))?.id).toBe(id);
    expect(s.dispatch(tt.editBlock({ blockId: id, endMs: T0 + H })).ok).toBe(false); // no end while running
    clock.t = T0 + 2 * H;
    expect(s.dispatch(tt.stopTracking(id, T0 + 2 * H)).ok).toBe(true);
    expect(spans(s)).toEqual([[0, 2, 'Run']]);
    expect(state(s).runningId).toBeNull();
    expect(s.dispatch(tt.stopTracking(id, T0 + 3 * H)).ok).toBe(true); // no longer running: no-op
    expect(spans(s)).toEqual([[0, 2, 'Run']]);
    s.undo('timetrack'); // the no-op stop
    s.undo('timetrack');
    expect(state(s).runningId).toBe(id);
  });

  it('treats the running block as ending now for the overlap rule', () => {
    const { s, clock } = session();
    clock.t = T0 + 3 * H;
    s.dispatch(tt.startTracking({ startMs: T0, title: 'Run', tagIds: [] }));
    const run = lastId(s);
    expect(create(s, 1, 2)).toMatchObject({ reason: 'timetrack.error.blockCovered' }); // before now
    expect(create(s, 2, 5, 'Partly').ok).toBe(true); // truncated to start at now (3)
    expect(create(s, 6, 7, 'Future').ok).toBe(true); // ahead of now: untouched for now
    expect(spans(s)).toEqual([[0, null, 'Run'], [3, 5, 'Partly'], [6, 7, 'Future']]);
    // Starting the running block later than "now" is not allowed.
    expect(s.dispatch(tt.editBlock({ blockId: run, startMs: T0 + 4 * H })).ok).toBe(false);
    clock.t = T0 + 6.5 * H;
    s.dispatch(tt.stopTracking(run, T0 + 6.5 * H)); // now the rule applies for real
    expect(spans(s)).toEqual([[0, 6.5, 'Run'], [6.5, 7, 'Future']]);
  });

  it('moves a start inside an earlier block to its end, but never into the future', () => {
    const { s } = session(); // now is T0 + 12 h
    create(s, 1, 3, 'Past');
    create(s, 11, 13, 'Ahead');
    expect(s.dispatch(tt.startTracking({ startMs: T0 + 11.5 * H, title: 'x', tagIds: [] }))).toMatchObject({
      reason: 'timetrack.error.blockCovered',
    });
    expect(s.dispatch(tt.startTracking({ startMs: T0 + 2 * H, title: 'Run', tagIds: [] })).ok).toBe(true);
    // The running block counts as ending now (12), so the later block gives way.
    expect(spans(s)).toEqual([[1, 3, 'Past'], [3, null, 'Run'], [12, 13, 'Ahead']]);
  });

  it('ends a running block when another one starts, also across computers', () => {
    const { s: a, clock } = session('wa');
    const b = new Session({ modules: [timetrackModule], writerId: 'wb', now: clock.now });
    a.dispatch(tt.startTracking({ startMs: T0, title: 'A', tagIds: [] }));
    clock.t += M;
    b.dispatch(tt.startTracking({ startMs: T0 + H, title: 'B', tagIds: [] }));
    a.ingest(b.runner.commands());
    b.ingest(a.runner.commands());
    for (const s of [a, b]) {
      expect(spans(s)).toEqual([[0, 1, 'A'], [1, null, 'B']]);
      expect(runningBlock(state(s))?.title).toBe('B');
    }
    // A stop for the block that is no longer running is harmless.
    const aId = a.runner.commands()[0]!.id;
    expect(a.dispatch(tt.stopTracking(aId, clock.t)).ok).toBe(true);
    expect(runningBlock(state(a))?.title).toBe('B');
  });

  it('deleting the running block ends tracking without a record', () => {
    const { s } = session();
    s.dispatch(tt.startTracking({ startMs: T0, title: '', tagIds: [] }));
    s.dispatch(tt.deleteBlock(lastId(s)));
    expect(state(s).runningId).toBeNull();
    expect(spans(s)).toEqual([]);
  });
});

describe('tags', () => {
  it('creates, edits and tombstones tags; blocks ignore deleted tags until the delete is undone', () => {
    const { s } = session();
    s.dispatch(tt.createTag({ name: ' Deep work ', color: '#1B9E77', description: '' }));
    const tag = lastId(s);
    expect(state(s).tags[tag]).toMatchObject({ name: 'Deep work', color: '#1b9e77', deleted: false });
    expect(nextTagColor(state(s))).toBe('#d95f02');
    create(s, 1, 2, '', [tag]);
    const block = [...allBlocks(state(s).blocks)][0]!;
    expect(s.dispatch(tt.editTag({ tagId: tag, name: 'Focus', color: '#7570b3' })).ok).toBe(true);
    expect(blockTags(state(s), block).map((t) => t.name)).toEqual(['Focus']);
    expect(s.dispatch(tt.deleteTag(tag)).ok).toBe(true);
    expect(blockTags(state(s), block)).toEqual([]);
    expect(liveTags(state(s))).toEqual([]);
    expect(create(s, 3, 4, '', [tag])).toMatchObject({ reason: 'timetrack.error.noSuchTag' });
    expect(s.dispatch(tt.editTag({ tagId: tag, name: 'x' }))).toMatchObject({ reason: 'timetrack.error.noSuchTag' });
    s.undo('timetrack');
    expect(blockTags(state(s), block).map((t) => t.name)).toEqual(['Focus']);
    expect(s.dispatch(tt.createTag({ name: ' ', color: '#000000', description: '' })).ok).toBe(false);
    expect(s.dispatch(tt.createTag({ name: 'x', color: 'red', description: '' })).ok).toBe(false);
  });

  it('accepts duplicate names from merges and reports them', () => {
    const { s: a, clock } = session('wa');
    const b = new Session({ modules: [timetrackModule], writerId: 'wb', now: clock.now });
    a.dispatch(tt.createTag({ name: 'Admin', color: '#1b9e77', description: '' }));
    b.dispatch(tt.createTag({ name: 'admin', color: '#d95f02', description: '' }));
    b.dispatch(tt.createBlock({ startMs: T0, endMs: T0 + H, title: '', tagIds: [lastId(b)] }));
    a.ingest(b.runner.commands());
    expect(liveTags(state(a))).toHaveLength(2);
    expect(duplicateTagIds(state(a)).size).toBe(2);
    expect(a.runner.issues().rejected).toEqual([]);
  });

  it('undoes a block on another computer before the tag it depends on', () => {
    const { s: a, clock } = session('wa');
    const b = new Session({ modules: [timetrackModule], writerId: 'wb', now: clock.now });
    a.dispatch(tt.createTag({ name: 'A', color: '#1b9e77', description: '' }));
    b.ingest(a.runner.commands());
    clock.t += M;
    b.dispatch(tt.createBlock({ startMs: T0, endMs: T0 + H, title: '', tagIds: [lastId(a)] }));
    a.ingest(b.runner.commands());
    // Undo is per module, not per computer: the block goes first, then the tag can follow.
    a.undo('timetrack');
    expect(spans(a)).toEqual([]);
    expect(liveTags(state(a))).toHaveLength(1);
    a.undo('timetrack');
    expect(liveTags(state(a))).toHaveLength(0);
  });
});

describe('determinism', () => {
  function freshReplay(commands: Command[]): CommandRunner {
    const r = new CommandRunner(new ModuleRegistry([timetrackModule]));
    r.ingest([...commands].reverse());
    return r;
  }

  it('incremental state equals a fresh replay across writers, merges, undo and redo', () => {
    const random = rng(7);
    const clock = new Clock(T0);
    const writers = ['wa', 'wb', 'wc'].map((w) => new Session({ modules: [timetrackModule], writerId: w, now: clock.now }));
    for (const w of writers) (w.runner as unknown as { checkpointInterval: number }).checkpointInterval = 9;
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)];
    const slot = () => T0 + Math.floor(random() * 96) * 15 * M; // within a day, 15-minute steps
    for (let step = 0; step < 2_000; step++) {
      clock.t += Math.floor(random() * 5 * M);
      const w = pick(writers)!;
      const st = state(w);
      const blocks = [...allBlocks(st.blocks)];
      const tags = liveTags(st).map((t) => t.id);
      const someTags = () => tags.filter(() => random() < 0.3);
      const roll = random();
      if (roll < 0.3) {
        const a = slot();
        w.dispatch(tt.createBlock({ startMs: a, endMs: a + (1 + Math.floor(random() * 12)) * 15 * M, title: `s${step}`, tagIds: someTags() }));
      } else if (roll < 0.36) w.dispatch(tt.startTracking({ startMs: clock.t - Math.floor(random() * H), title: `r${step}`, tagIds: someTags() }));
      else if (roll < 0.42 && st.runningId) w.dispatch(tt.stopTracking(st.runningId, clock.t));
      else if (roll < 0.52 && blocks.length) {
        const b = pick(blocks)!;
        const delta = (Math.floor(random() * 9) - 4) * 15 * M;
        const edit = random();
        if (edit < 0.3) w.dispatch(tt.editBlock({ blockId: b.id, startMs: b.startMs + delta }));
        else if (edit < 0.6 && b.endMs !== null) w.dispatch(tt.editBlock({ blockId: b.id, endMs: b.endMs + delta }));
        else w.dispatch(tt.editBlock({ blockId: b.id, title: `e${step}`, tagIds: someTags() }));
      } else if (roll < 0.56 && blocks.length) w.dispatch(tt.deleteBlock(pick(blocks)!.id));
      else if (roll < 0.6) w.dispatch(tt.createTag({ name: `t${step}`, color: nextTagColor(st), description: '' }));
      else if (roll < 0.62 && tags.length) w.dispatch(tt.deleteTag(pick(tags)!));
      else if (roll < 0.64 && tags.length) w.dispatch(tt.editTag({ tagId: pick(tags)!, name: `n${step}` }));
      else if (roll < 0.76) w.undo('timetrack');
      else if (roll < 0.84) w.redo('timetrack');
      else w.ingest(pick(writers)!.runner.commands());
      // Invariants hold after every step: sorted, no overlaps (ignoring the running block's growth).
      const now = state(w);
      const list = [...allBlocks(now.blocks)];
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1]!;
        if (prev.id !== now.runningId && prev.endMs! > list[i]!.startMs) {
          throw new Error(`overlap at step ${step}: ${JSON.stringify([prev, list[i]])} after ${JSON.stringify(w.runner.commands().at(-1))}`);
        }
      }
      expect(list.filter((b) => b.endMs === null).map((b) => b.id)).toEqual(now.runningId ? [now.runningId] : []);
      expect(now.blocks.where.size).toBe(list.length);
    }
    const all = writers.flatMap((w) => w.runner.commands());
    for (const w of writers) w.ingest(all);
    const reference = freshReplay(all);
    const ref = reference.getState<TimetrackState>('timetrack');
    expect(reference.commands().filter((c) => c.t === 'core.Undo').length).toBeGreaterThan(100);
    expect([...allBlocks(ref.blocks)].length).toBeGreaterThan(10);
    for (const w of writers) {
      expect([...allBlocks(state(w).blocks)]).toEqual([...allBlocks(ref.blocks)]);
      expect(state(w).tags).toEqual(ref.tags);
      expect(state(w).runningId).toEqual(ref.runningId);
      expect(w.runner.issues().rejected).toEqual(reference.issues().rejected);
    }
  });
});
