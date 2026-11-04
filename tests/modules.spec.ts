import { describe, expect, it } from 'vitest';
import { ModuleRegistry } from '../src/core/module';
import { Session } from '../src/core/session';
import { DEFAULT_FOCUS_SETTINGS, focusActions, isSessionRunning, remainingMs, type FocusState } from '../src/modules/focus';
import { DEFAULT_DAY_WINDOW, timetrackActions, type TimetrackState } from '../src/modules/timetrack';
import { MODULES } from '../src/registry';

const session = () => new Session({ modules: MODULES, writerId: 'wa' });

describe('module registry', () => {
  it('has unique ids and namespaces', () => {
    expect(() => new ModuleRegistry(MODULES)).not.toThrow();
  });
});

describe('focus', () => {
  it('validates and applies settings, one undo step per change', () => {
    const s = session();
    expect(s.getState<FocusState>('focus').settings).toEqual(DEFAULT_FOCUS_SETTINGS);
    expect(s.dispatch(focusActions.setSettings({ durationMin: 50 })).ok).toBe(true);
    for (const bad of [0, 181, 2.5, Number.NaN]) {
      expect(s.dispatch(focusActions.setSettings({ durationMin: bad }))).toMatchObject({ reason: 'focus.error.invalidDuration' });
    }
    expect(s.dispatch(focusActions.setSettings({ tickingSoundId: 'Not OK!' }))).toMatchObject({ reason: 'focus.error.invalidSound' });
    expect(s.dispatch(focusActions.setSettings({}))).toMatchObject({ reason: 'focus.error.noChanges' });
    expect(s.getState<FocusState>('focus').settings.durationMin).toBe(50);
    s.undo('focus');
    expect(s.getState<FocusState>('focus').settings.durationMin).toBe(25);
  });
});

describe('focus sessions', () => {
  const T0 = Date.UTC(2026, 10, 4, 9);
  const focus = (s: Session) => s.getState<FocusState>('focus');

  it('copies settings into the session and counts down from its own start time', () => {
    const s = session();
    s.dispatch(focusActions.setSettings({ durationMin: 30, tickingSoundId: 'rainforest-rain' }));
    expect(s.dispatch(focusActions.start(focus(s).settings, T0)).ok).toBe(true);
    s.dispatch(focusActions.setSettings({ durationMin: 5 }));
    const session0 = focus(s).session!;
    expect(session0).toMatchObject({ startedAt: T0, durationMs: 30 * 60_000, tickingSoundId: 'rainforest-rain', stoppedAt: null });
    expect(remainingMs(focus(s), T0 + 60_000)).toBe(29 * 60_000);
    // Finishing writes nothing: the session is simply over once its time has passed.
    expect(isSessionRunning(session0, T0 + 30 * 60_000)).toBe(false);
    expect(remainingMs(focus(s), T0 + 30 * 60_000)).toBeNull();
  });

  it('stops a running session, and treats stopping a finished or replaced one as a no-op', () => {
    const s = session();
    s.dispatch(focusActions.start(focus(s).settings, T0));
    const id = focus(s).session!.id;
    expect(s.dispatch(focusActions.stop(id, T0 + 1_000)).ok).toBe(true);
    expect(focus(s).session!.stoppedAt).toBe(T0 + 1_000);
    expect(remainingMs(focus(s), T0 + 2_000)).toBeNull();
    // Already stopped, unknown session, or after the natural end: accepted, nothing changes.
    expect(s.dispatch(focusActions.stop(id, T0 + 5_000)).ok).toBe(true);
    expect(focus(s).session!.stoppedAt).toBe(T0 + 1_000);
    s.dispatch(focusActions.start(focus(s).settings, T0 + 10_000));
    const before = focus(s);
    expect(s.dispatch(focusActions.stop(focus(s).session!.id, T0 + 10_000 + 26 * 60_000)).ok).toBe(true);
    expect(focus(s)).toBe(before);
  });

  it('lets the newer Start win when two computers start at the same time', () => {
    const a = new Session({ modules: MODULES, writerId: 'wa', now: () => 1_000 });
    const b = new Session({ modules: MODULES, writerId: 'wb', now: () => 2_000 });
    a.dispatch(focusActions.start({ ...DEFAULT_FOCUS_SETTINGS, durationMin: 10 }, T0));
    b.dispatch(focusActions.start({ ...DEFAULT_FOCUS_SETTINGS, durationMin: 50 }, T0 + 500));
    a.ingest(b.runner.commands());
    b.ingest(a.runner.commands());
    expect(focus(a)).toEqual(focus(b));
    expect(focus(a).session!.durationMs).toBe(50 * 60_000);
    expect(a.runner.issues().rejected).toEqual([]);
  });

  it('validates sessions and keeps Start/Stop off the undo stack', () => {
    const s = session();
    expect(s.dispatch({ t: 'focus.Start', p: { ...focusActions.start(DEFAULT_FOCUS_SETTINGS, T0).p, durationMs: 1 } })).toMatchObject({
      reason: 'focus.error.invalidDuration',
    });
    expect(s.dispatch({ t: 'focus.Start', p: { ...focusActions.start(DEFAULT_FOCUS_SETTINGS, T0).p, tickingSoundId: '' } })).toMatchObject({
      reason: 'focus.error.invalidSound',
    });
    s.dispatch(focusActions.setSettings({ durationMin: 40 }));
    s.dispatch(focusActions.start(focus(s).settings, T0));
    s.dispatch(focusActions.stop(focus(s).session!.id, T0 + 1));
    s.undo('focus');
    expect(focus(s).settings.durationMin).toBe(25);
    expect(focus(s).session!.stoppedAt).toBe(T0 + 1);
    expect(s.canUndo('focus')).toBe(false);
  });
});

describe('timetrack', () => {
  it('accepts whole hours, including windows that end the next day', () => {
    const s = session();
    expect(s.getState<TimetrackState>('timetrack').dayWindow).toEqual(DEFAULT_DAY_WINDOW);
    expect(s.dispatch(timetrackActions.setDayWindow({ startHour: 9, endHour: 9 })).ok).toBe(true);
    expect(s.dispatch(timetrackActions.setDayWindow({ startHour: 24, endHour: 5 }))).toMatchObject({ reason: 'timetrack.error.invalidHour' });
    expect(s.dispatch(timetrackActions.setDayWindow({ startHour: 7.5, endHour: 5 })).ok).toBe(false);
    expect(s.getState<TimetrackState>('timetrack').dayWindow).toEqual({ startHour: 9, endHour: 9 });
  });
});
