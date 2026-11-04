import type { Action } from '../../core/session';
import { applied, defineCommand, defineModule, rejected } from '../../core/module';
import { timetrackCatalog } from './catalog';

/**
 * Visible part of a logical day, in whole local hours. `endHour <= startHour` means the end
 * falls on the next day; whole hours make a window longer than 24 h impossible.
 */
export interface DayWindow {
  startHour: number;
  endHour: number;
}

export interface TimetrackState {
  dayWindow: DayWindow;
}

export const DEFAULT_DAY_WINDOW: DayWindow = { startHour: 7, endHour: 5 };

function isHour(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 23;
}

const SetDayWindow = defineCommand<TimetrackState, DayWindow>({
  v: 1,
  undoable: true,
  apply(state, p) {
    if (!isHour(p?.startHour) || !isHour(p?.endHour)) return rejected('timetrack.error.invalidHour');
    return applied({ ...state, dayWindow: { startHour: p.startHour, endHour: p.endHour } });
  },
});

export const timetrackModule = defineModule<TimetrackState>({
  id: 'timetrack',
  ns: 'tt',
  initialState: () => ({ dayWindow: { ...DEFAULT_DAY_WINDOW } }),
  commands: { SetDayWindow },
  catalog: timetrackCatalog,
});

export const timetrackActions = {
  setDayWindow: (p: DayWindow): Action<DayWindow> => ({ t: 'tt.SetDayWindow', p }),
};
