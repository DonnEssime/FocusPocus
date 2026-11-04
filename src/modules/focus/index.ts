import type { Action } from '../../core/session';
import { applied, defineCommand, defineModule, rejected } from '../../core/module';
import { focusCatalog } from './catalog';

export const FOCUS_DURATION_MIN = 1;
export const FOCUS_DURATION_MAX = 180;
const MINUTE_MS = 60_000;

export interface FocusSettings {
  durationMin: number;
  tickingSoundId: string;
  finishingSoundId: string;
}

/**
 * The latest focus session. It is running while `stoppedAt === null` and `now < endsAt`.
 * Finishing naturally writes nothing: a session without a Stop simply ran to the end.
 */
export interface FocusSession {
  /** Id of the `focus.Start` command that began it. */
  id: string;
  /** Wall-clock start on the computer that started it (not the hybrid-clock `at`). */
  startedAt: number;
  durationMs: number;
  tickingSoundId: string;
  finishingSoundId: string;
  stoppedAt: number | null;
}

export interface FocusState {
  settings: FocusSettings;
  session: FocusSession | null;
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  durationMin: 25,
  tickingSoundId: 'clock-tick',
  finishingSoundId: 'bell-single',
};

export type SetFocusSettingsPayload = Partial<FocusSettings>;

export interface StartFocusPayload {
  startedAt: number;
  durationMs: number;
  tickingSoundId: string;
  finishingSoundId: string;
}

export interface StopFocusPayload {
  sessionId: string;
  stoppedAt: number;
}

function isSoundId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value);
}

function isDurationMin(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= FOCUS_DURATION_MIN && (value as number) <= FOCUS_DURATION_MAX;
}

export function sessionEndsAt(session: FocusSession): number {
  return session.startedAt + session.durationMs;
}

export function isSessionRunning(session: FocusSession | null, now: number): session is FocusSession {
  return session !== null && session.stoppedAt === null && now < sessionEndsAt(session);
}

/** Remaining time of the running session, or null when idle. */
export function remainingMs(state: FocusState, now: number): number | null {
  return isSessionRunning(state.session, now) ? sessionEndsAt(state.session) - now : null;
}

const SetSettings = defineCommand<FocusState, SetFocusSettingsPayload>({
  v: 1,
  undoable: true,
  apply(state, p) {
    const { durationMin, tickingSoundId, finishingSoundId } = p ?? {};
    if (durationMin === undefined && tickingSoundId === undefined && finishingSoundId === undefined) {
      return rejected('focus.error.noChanges');
    }
    if (durationMin !== undefined && !isDurationMin(durationMin)) {
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

/**
 * Starts a session. A session still running is superseded: the newer Start (in log order) wins,
 * which also resolves two computers starting at the same time.
 */
const Start = defineCommand<FocusState, StartFocusPayload>({
  v: 1,
  undoable: false,
  apply(state, p, ctx) {
    if (!Number.isFinite(p?.startedAt)) return rejected('focus.error.invalidSession');
    if (!(Number.isInteger(p.durationMs) && isDurationMin(p.durationMs / MINUTE_MS))) {
      return rejected('focus.error.invalidDuration', { min: FOCUS_DURATION_MIN, max: FOCUS_DURATION_MAX });
    }
    if (!isSoundId(p.tickingSoundId) || !isSoundId(p.finishingSoundId)) return rejected('focus.error.invalidSound');
    return applied({
      ...state,
      session: {
        id: ctx.id,
        startedAt: p.startedAt,
        durationMs: p.durationMs,
        tickingSoundId: p.tickingSoundId,
        finishingSoundId: p.finishingSoundId,
        stoppedAt: null,
      },
    });
  },
});

/**
 * Cuts the session short. Stopping a session that already ended, was already stopped or was
 * superseded is a harmless no-op (common after merges), not a conflict.
 */
const Stop = defineCommand<FocusState, StopFocusPayload>({
  v: 1,
  undoable: false,
  apply(state, p) {
    if (typeof p?.sessionId !== 'string' || !Number.isFinite(p.stoppedAt)) return rejected('focus.error.invalidSession');
    const s = state.session;
    if (!s || s.id !== p.sessionId || !isSessionRunning(s, p.stoppedAt)) return applied(state);
    return applied({ ...state, session: { ...s, stoppedAt: Math.max(p.stoppedAt, s.startedAt) } });
  },
});

export const focusModule = defineModule<FocusState>({
  id: 'focus',
  ns: 'focus',
  initialState: () => ({ settings: { ...DEFAULT_FOCUS_SETTINGS }, session: null }),
  commands: { SetSettings, Start, Stop },
  catalog: focusCatalog,
});

export const focusActions = {
  setSettings: (p: SetFocusSettingsPayload): Action<SetFocusSettingsPayload> => ({ t: 'focus.SetSettings', p }),
  /** Copies the current settings into the session, so later settings changes don't affect it. */
  start: (settings: FocusSettings, now: number): Action<StartFocusPayload> => ({
    t: 'focus.Start',
    p: {
      startedAt: now,
      durationMs: settings.durationMin * MINUTE_MS,
      tickingSoundId: settings.tickingSoundId,
      finishingSoundId: settings.finishingSoundId,
    },
  }),
  stop: (sessionId: string, now: number): Action<StopFocusPayload> => ({
    t: 'focus.Stop',
    p: { sessionId, stoppedAt: now },
    deps: [sessionId],
  }),
};
