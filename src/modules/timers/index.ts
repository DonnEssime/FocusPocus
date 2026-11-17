import type { Action } from '../../core/session';
import { applied, defineCommand, defineModule, rejected, type ApplyResult } from '../../core/module';
import { timersCatalog } from './catalog';

export const TIMER_LABEL_MAX = 100;
/** Shortest timer: one second. */
export const TIMER_MIN_MS = 1_000;
/** Longest timer, or how far ahead an alarm time may lie: a year and a day. */
export const TIMER_MAX_MS = 366 * 24 * 3_600_000;
/** The sound manual timers start with until the user picks another. */
export const DEFAULT_TIMER_SOUND_ID = 'bell-triple';

/**
 * A timer in the list. It rings once at `endsAt` and then stays, shown as finished, until it is
 * dismissed. Finishing writes nothing: a timer whose end has passed simply is finished.
 */
export interface Timer {
  /** Id of the `timers.Start` command that began it. */
  id: string;
  /** Optional name; empty when none was given. */
  label: string;
  /** Wall-clock start on the computer that started it (not the hybrid-clock `at`). */
  startedAt: number;
  /** Wall-clock moment it rings. */
  endsAt: number;
  soundId: string;
}

/** A length on the quick list, started with one click. */
export interface TimerPreset {
  /** Id of the `timers.AddPreset` command that made it. */
  id: string;
  durationMs: number;
  label: string;
  soundId: string;
}

export interface TimersState {
  timers: Readonly<Record<string, Timer>>;
  /** Sorted by length, then name, then id: the quick list's display order. */
  presets: readonly TimerPreset[];
  /** Sound of timers started from the form (presets carry their own). */
  soundId: string;
}

export interface StartTimerPayload {
  label: string;
  startedAt: number;
  endsAt: number;
  soundId: string;
}

export interface AddPresetPayload {
  durationMs: number;
  label: string;
  soundId: string;
}

export interface SetTimerSettingsPayload {
  soundId?: string;
}

export const EMPTY_TIMERS: TimersState = { timers: {}, presets: [], soundId: DEFAULT_TIMER_SOUND_ID };

function isLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length <= TIMER_LABEL_MAX;
}

function isSoundId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value);
}

function isLength(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= TIMER_MIN_MS && (value as number) <= TIMER_MAX_MS;
}

const invalidLabel = <S>(): ApplyResult<S> => rejected('timers.error.invalidLabel', { max: TIMER_LABEL_MAX });
const invalidLength = <S>(): ApplyResult<S> => rejected('timers.error.invalidLength');

export function isFinished(timer: Timer, now: number): boolean {
  return now >= timer.endsAt;
}

/** All timers, the one that rings first on top. */
export function timersByEnd(state: TimersState): Timer[] {
  return Object.values(state.timers).sort((a, b) => a.endsAt - b.endsAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function comparePresets(a: TimerPreset, b: TimerPreset): number {
  return a.durationMs - b.durationMs || a.label.localeCompare(b.label) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The preset already on the quick list with this length and name (names compared case-insensitively). */
export function findPreset(state: TimersState, durationMs: number, label: string): TimerPreset | undefined {
  const name = label.trim().toLowerCase();
  return state.presets.find((p) => p.durationMs === durationMs && p.label.toLowerCase() === name);
}

/** Starts a timer. Any number may run at once; the timer id is this command's id. */
const Start = defineCommand<TimersState, StartTimerPayload>({
  v: 1,
  undoable: true,
  apply(state, p, ctx) {
    if (!p || !Number.isFinite(p.startedAt) || !Number.isFinite(p.endsAt)) return rejected('timers.error.invalidPayload');
    if (!isLength(p.endsAt - p.startedAt)) return invalidLength();
    if (!isLabel(p.label)) return invalidLabel();
    if (!isSoundId(p.soundId)) return rejected('timers.error.invalidSound');
    const timer: Timer = { id: ctx.id, label: p.label.trim(), startedAt: p.startedAt, endsAt: p.endsAt, soundId: p.soundId };
    return applied({ ...state, timers: { ...state.timers, [timer.id]: timer } });
  },
});

/**
 * Cancels a running timer or dismisses a finished one. A timer that is already gone (two windows
 * dismissing it at once) is a harmless no-op.
 */
const Remove = defineCommand<TimersState, { timerId: string }>({
  v: 1,
  undoable: true,
  apply(state, p) {
    if (typeof p?.timerId !== 'string') return rejected('timers.error.invalidPayload');
    if (!Object.hasOwn(state.timers, p.timerId)) return applied(state);
    const timers = { ...state.timers };
    delete timers[p.timerId];
    return applied({ ...state, timers });
  },
});

/**
 * Adds a length to the quick list. Duplicates are not rejected here (two computers may add the
 * same one before syncing); the UI offers to save only what is not on the list yet.
 */
const AddPreset = defineCommand<TimersState, AddPresetPayload>({
  v: 1,
  undoable: true,
  apply(state, p, ctx) {
    if (!p || !isLength(p.durationMs)) return invalidLength();
    if (!isLabel(p.label)) return invalidLabel();
    if (!isSoundId(p.soundId)) return rejected('timers.error.invalidSound');
    const preset: TimerPreset = { id: ctx.id, durationMs: p.durationMs, label: p.label.trim(), soundId: p.soundId };
    return applied({ ...state, presets: [...state.presets, preset].sort(comparePresets) });
  },
});

const DeletePreset = defineCommand<TimersState, { presetId: string }>({
  v: 1,
  undoable: true,
  apply(state, p) {
    if (typeof p?.presetId !== 'string') return rejected('timers.error.invalidPayload');
    const presets = state.presets.filter((x) => x.id !== p.presetId);
    if (presets.length === state.presets.length) return rejected('timers.error.noSuchPreset');
    return applied({ ...state, presets });
  },
});

const SetSettings = defineCommand<TimersState, SetTimerSettingsPayload>({
  v: 1,
  undoable: true,
  apply(state, p) {
    if (p?.soundId === undefined) return rejected('timers.error.noChanges');
    if (!isSoundId(p.soundId)) return rejected('timers.error.invalidSound');
    return applied({ ...state, soundId: p.soundId });
  },
});

export const timersModule = defineModule<TimersState>({
  id: 'timers',
  ns: 'timers',
  initialState: () => EMPTY_TIMERS,
  commands: { Start, Remove, AddPreset, DeletePreset, SetSettings },
  catalog: timersCatalog,
});

export const timersActions = {
  /** A timer that rings at `endsAt` (wall clock). */
  start: (p: { label: string; endsAt: number; soundId: string }, now: number): Action<StartTimerPayload> => ({
    t: 'timers.Start',
    p: { label: p.label, startedAt: now, endsAt: p.endsAt, soundId: p.soundId },
  }),
  /** No `deps` on the preset: deleting it (or undoing its creation) leaves running timers alone. */
  startPreset: (preset: TimerPreset, now: number): Action<StartTimerPayload> => ({
    t: 'timers.Start',
    p: { label: preset.label, startedAt: now, endsAt: now + preset.durationMs, soundId: preset.soundId },
  }),
  remove: (timerId: string): Action<{ timerId: string }> => ({ t: 'timers.Remove', p: { timerId }, deps: [timerId] }),
  addPreset: (p: AddPresetPayload): Action<AddPresetPayload> => ({ t: 'timers.AddPreset', p }),
  deletePreset: (presetId: string): Action<{ presetId: string }> => ({
    t: 'timers.DeletePreset',
    p: { presetId },
    deps: [presetId],
  }),
  setSettings: (p: SetTimerSettingsPayload): Action<SetTimerSettingsPayload> => ({ t: 'timers.SetSettings', p }),
};
