import { describe, expect, it } from 'vitest';
import { Session, type Action } from '../src/core/session';
import { encodeLine, parseSegmentText } from '../src/core/vault/segment';
import {
  DEFAULT_TIMER_SOUND_ID,
  findPreset,
  isFinished,
  TIMER_LABEL_MAX,
  TIMER_MAX_MS,
  timersActions as ta,
  timersByEnd,
  timersModule,
  type TimersState,
} from '../src/modules/timers';
import { rng } from './helpers/test-modules';

const T0 = Date.UTC(2026, 10, 17, 9, 0);
const MIN = 60_000;
const session = (writerId = 'wa') => new Session({ modules: [timersModule], writerId });
const state = (s: Session) => s.getState<TimersState>('timers');
const lastId = (s: Session) => s.runner.commands().at(-1)!.id;
/** Without `deps`, so the module's own checks run (the kernel checks deps first). */
const bare = (a: Action): Action => ({ t: a.t, p: a.p });

function start(s: Session, minutes: number, label = '', now = T0): string {
  const r = s.dispatch(ta.start({ label, endsAt: now + minutes * MIN, soundId: 'bell-single' }, now));
  if (!r.ok) throw new Error(`start rejected: ${JSON.stringify(r)}`);
  return lastId(s);
}

function addPreset(s: Session, minutes: number, label = '', soundId = 'chime-soft'): string {
  const r = s.dispatch(ta.addPreset({ durationMs: minutes * MIN, label, soundId }));
  if (!r.ok) throw new Error(`addPreset rejected: ${JSON.stringify(r)}`);
  return lastId(s);
}

describe('timers: running timers', () => {
  it('starts any number of timers, listed by when they ring', () => {
    const s = session();
    const a = start(s, 10, '  Pasta ');
    const b = start(s, 5);
    expect(timersByEnd(state(s)).map((t) => t.id)).toEqual([b, a]);
    expect(state(s).timers[a]).toEqual({ id: a, label: 'Pasta', startedAt: T0, endsAt: T0 + 10 * MIN, soundId: 'bell-single' });
  });

  it('is finished once its end has passed, which writes nothing', () => {
    const s = session();
    const a = start(s, 5);
    const t = state(s).timers[a]!;
    expect(isFinished(t, T0 + 5 * MIN - 1)).toBe(false);
    expect(isFinished(t, T0 + 5 * MIN)).toBe(true);
    expect(s.runner.commands()).toHaveLength(1);
  });

  it('validates length, name, sound and payload', () => {
    const s = session();
    const go = (p: Record<string, unknown>) =>
      s.dispatch({ t: 'timers.Start', p: { label: '', startedAt: T0, endsAt: T0 + MIN, soundId: 'bell-single', ...p } });
    expect(go({ endsAt: T0 + 999 })).toMatchObject({ reason: 'timers.error.invalidLength' });
    expect(go({ endsAt: T0 - MIN })).toMatchObject({ reason: 'timers.error.invalidLength' });
    expect(go({ endsAt: T0 + TIMER_MAX_MS + 1 })).toMatchObject({ reason: 'timers.error.invalidLength' });
    expect(go({ label: 'x'.repeat(TIMER_LABEL_MAX + 1) })).toMatchObject({ reason: 'timers.error.invalidLabel' });
    expect(go({ label: 3 })).toMatchObject({ reason: 'timers.error.invalidLabel' });
    expect(go({ soundId: 'Not A Sound' })).toMatchObject({ reason: 'timers.error.invalidSound' });
    expect(go({ startedAt: 'now' })).toMatchObject({ reason: 'timers.error.invalidPayload' });
    expect(s.dispatch({ t: 'timers.Start', p: null })).toMatchObject({ reason: 'timers.error.invalidPayload' });
    expect(s.runner.commands()).toHaveLength(0);
    expect(go({ endsAt: T0 + TIMER_MAX_MS }).ok).toBe(true);
  });

  it('removes (cancels or dismisses) a timer; a timer already gone is a no-op', () => {
    const s = session();
    const a = start(s, 5);
    expect(s.dispatch(ta.remove(a)).ok).toBe(true);
    expect(state(s).timers).toEqual({});
    expect(ta.remove(a).deps).toEqual([a]);
    const before = state(s);
    expect(s.dispatch(bare(ta.remove(a))).ok).toBe(true);
    expect(state(s)).toBe(before);
    expect(s.dispatch({ t: 'timers.Remove', p: {} })).toMatchObject({ reason: 'timers.error.invalidPayload' });
  });

  it('undoes a removal (the timer comes back) and a start (the timer goes)', () => {
    const s = session();
    const a = start(s, 5);
    s.dispatch(ta.remove(a));
    s.undo('timers');
    expect(Object.keys(state(s).timers)).toEqual([a]);
    s.undo('timers');
    expect(state(s).timers).toEqual({});
    s.redo('timers');
    s.redo('timers');
    expect(state(s).timers).toEqual({});
  });

  it('keeps both timers when two computers start at once, and merges a double dismissal', () => {
    const a = session('wa');
    const b = session('wb');
    const x = start(a, 5);
    start(b, 7);
    a.ingest(b.runner.commands());
    b.ingest(a.runner.commands());
    expect(Object.keys(state(a).timers)).toHaveLength(2);
    a.dispatch(ta.remove(x));
    b.dispatch(ta.remove(x));
    a.ingest(b.runner.commands());
    b.ingest(a.runner.commands());
    expect(state(a)).toEqual(state(b));
    expect(Object.keys(state(a).timers)).toHaveLength(1);
  });
});

describe('timers: quick list', () => {
  it('keeps presets sorted by length, then name', () => {
    const s = session();
    addPreset(s, 10, 'Tea');
    addPreset(s, 3, 'Egg');
    addPreset(s, 10, 'Bread');
    expect(state(s).presets.map((p) => `${p.durationMs / MIN} ${p.label}`)).toEqual(['3 Egg', '10 Bread', '10 Tea']);
    expect(findPreset(state(s), 10 * MIN, ' tea ')?.label).toBe('Tea');
    expect(findPreset(state(s), 10 * MIN, '')).toBeUndefined();
  });

  it('starts a preset with its own length, name and sound, without depending on it', () => {
    const s = session();
    const p = addPreset(s, 4, 'Tea', 'chime-soft');
    const preset = state(s).presets[0]!;
    const action = ta.startPreset(preset, T0);
    expect(action.deps).toBeUndefined();
    s.dispatch(action);
    const timer = timersByEnd(state(s))[0]!;
    expect(timer).toMatchObject({ label: 'Tea', endsAt: T0 + 4 * MIN, soundId: 'chime-soft' });
    // Deleting the preset leaves the running timer alone.
    expect(s.dispatch(ta.deletePreset(p)).ok).toBe(true);
    expect(state(s).presets).toEqual([]);
    expect(Object.keys(state(s).timers)).toHaveLength(1);
  });

  it('validates presets and rejects deleting a missing one', () => {
    const s = session();
    expect(s.dispatch(ta.addPreset({ durationMs: 500, label: '', soundId: 'bell-single' }))).toMatchObject({
      reason: 'timers.error.invalidLength',
    });
    expect(s.dispatch(ta.addPreset({ durationMs: 1.5 * MIN + 0.5, label: '', soundId: 'bell-single' }))).toMatchObject({
      reason: 'timers.error.invalidLength',
    });
    expect(s.dispatch(ta.addPreset({ durationMs: MIN, label: 'x'.repeat(101), soundId: 'bell-single' }))).toMatchObject({
      reason: 'timers.error.invalidLabel',
    });
    expect(s.dispatch(ta.addPreset({ durationMs: MIN, label: '', soundId: '' }))).toMatchObject({
      reason: 'timers.error.invalidSound',
    });
    expect(s.dispatch(bare(ta.deletePreset('nope')))).toMatchObject({ reason: 'timers.error.noSuchPreset' });
  });

  it('undoes adding and deleting presets', () => {
    const s = session();
    const p = addPreset(s, 5);
    s.dispatch(ta.deletePreset(p));
    s.undo('timers');
    expect(state(s).presets.map((x) => x.id)).toEqual([p]);
    s.undo('timers');
    expect(state(s).presets).toEqual([]);
  });
});

describe('timers: settings', () => {
  it('sets the sound for timers started from the form, undoably', () => {
    const s = session();
    expect(state(s).soundId).toBe(DEFAULT_TIMER_SOUND_ID);
    expect(s.dispatch(ta.setSettings({ soundId: 'chime-soft' })).ok).toBe(true);
    expect(state(s).soundId).toBe('chime-soft');
    expect(s.dispatch(ta.setSettings({}))).toMatchObject({ reason: 'timers.error.noChanges' });
    expect(s.dispatch(ta.setSettings({ soundId: '../x' }))).toMatchObject({ reason: 'timers.error.invalidSound' });
    s.undo('timers');
    expect(state(s).soundId).toBe(DEFAULT_TIMER_SOUND_ID);
  });
});

describe('timers: replay', () => {
  it('round-trips through the segment line codec', () => {
    const s = session();
    start(s, 5, 'ünïcødé “quotes”');
    addPreset(s, 3, 'Egg');
    s.dispatch(ta.setSettings({ soundId: 'chime-soft' }));
    const copy = session('wb');
    copy.ingest(parseSegmentText(s.runner.commands().map(encodeLine).join('\n')).commands);
    expect(state(copy)).toEqual(state(s));
  });

  it('incremental state equals a fresh replay across random edits, undo and merges', () => {
    const random = rng(11);
    const writers = [session('wa'), session('wb'), session('wc')];
    const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(random() * xs.length)];
    for (let step = 0; step < 1_000; step++) {
      const w = pick(writers)!;
      const timers = Object.keys(state(w).timers);
      const presets = state(w).presets;
      const roll = random();
      if (roll < 0.25) start(w, 1 + Math.floor(random() * 30), random() < 0.5 ? `t${step}` : '', T0 + step * 1_000);
      else if (roll < 0.4 && timers.length) w.dispatch(ta.remove(pick(timers)!));
      else if (roll < 0.5) addPreset(w, 1 + Math.floor(random() * 5), random() < 0.5 ? 'p' : '');
      else if (roll < 0.55 && presets.length) w.dispatch(ta.deletePreset(pick(presets)!.id));
      else if (roll < 0.6 && presets.length) w.dispatch(ta.startPreset(pick(presets)!, T0 + step * 1_000));
      else if (roll < 0.63) w.dispatch(ta.setSettings({ soundId: pick(['bell-single', 'chime-soft'])! }));
      else if (roll < 0.73) w.undo('timers');
      else if (roll < 0.8) w.redo('timers');
      else w.ingest(pick(writers)!.runner.commands());
    }
    const all = writers.flatMap((w) => w.runner.commands());
    for (const w of writers) w.ingest(all);
    const fresh = session('zz');
    fresh.ingest(all);
    expect(Object.keys(state(fresh).timers).length).toBeGreaterThan(0);
    for (const w of writers) expect(state(w)).toEqual(state(fresh));
  });
});
