import type { Action } from '../../core/session';
import { applied, defineCommand, defineModule, rejected } from '../../core/module';
import { focusCatalog } from './catalog';

export const FOCUS_DURATION_MIN = 1;
export const FOCUS_DURATION_MAX = 180;

export interface FocusSettings {
  durationMin: number;
  tickingSoundId: string;
  finishingSoundId: string;
}

export interface FocusState {
  settings: FocusSettings;
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  durationMin: 25,
  tickingSoundId: 'clock-tick',
  finishingSoundId: 'bell-single',
};

export type SetFocusSettingsPayload = Partial<FocusSettings>;

function isSoundId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value);
}

const SetSettings = defineCommand<FocusState, SetFocusSettingsPayload>({
  v: 1,
  undoable: true,
  apply(state, p) {
    const { durationMin, tickingSoundId, finishingSoundId } = p ?? {};
    if (durationMin === undefined && tickingSoundId === undefined && finishingSoundId === undefined) {
      return rejected('focus.error.noChanges');
    }
    if (
      durationMin !== undefined &&
      !(Number.isInteger(durationMin) && durationMin >= FOCUS_DURATION_MIN && durationMin <= FOCUS_DURATION_MAX)
    ) {
      return rejected('focus.error.invalidDuration', { min: FOCUS_DURATION_MIN, max: FOCUS_DURATION_MAX });
    }
    if (tickingSoundId !== undefined && !isSoundId(tickingSoundId)) return rejected('focus.error.invalidSound');
    if (finishingSoundId !== undefined && !isSoundId(finishingSoundId)) return rejected('focus.error.invalidSound');
    return applied({
      ...state,
      settings: {
        ...state.settings,
        ...(durationMin !== undefined ? { durationMin } : {}),
        ...(tickingSoundId !== undefined ? { tickingSoundId } : {}),
        ...(finishingSoundId !== undefined ? { finishingSoundId } : {}),
      },
    });
  },
});

export const focusModule = defineModule<FocusState>({
  id: 'focus',
  ns: 'focus',
  initialState: () => ({ settings: { ...DEFAULT_FOCUS_SETTINGS } }),
  commands: { SetSettings },
  catalog: focusCatalog,
});

export const focusActions = {
  setSettings: (p: SetFocusSettingsPayload): Action<SetFocusSettingsPayload> => ({ t: 'focus.SetSettings', p }),
};
