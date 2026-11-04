import { describe, expect, it } from 'vitest';
import { ModuleRegistry } from '../src/core/module';
import { Session } from '../src/core/session';
import { DEFAULT_FOCUS_SETTINGS, focusActions, type FocusState } from '../src/modules/focus';
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
