/**
 * Target hours and balances (§10.2 *Target hours*). Targets attach to calendar dates (`DayKey`),
 * percentages resolve against the effective-dated full-time hours, and a balance is always
 * `tracked − Σ targets` over whole logical days up to today.
 */
import { firstBlock, getBlock, trackedBefore } from './blocks';
import type { TimetrackState } from './index';
import { dayRange, logicalDayOf, type DayKey } from './time';

export type DayTarget = { percent: number } | { ms: number };

/** One step of the full-time schedule: applies from `from` (inclusive) until the next entry. */
export interface FulltimeEntry {
  /** `''` sorts before every date: "since always". */
  from: DayKey | '';
  ms: number;
}

export interface BalanceInterval {
  /** `null` = since the beginning (the first day with tracked time or a target). */
  from: DayKey | null;
  /** `null` = now (through today). */
  to: DayKey | null;
}

export interface TargetsState {
  /** Only hides the UI: the data below is kept either way. */
  enabled: boolean;
  /** Sorted by `from`; the first entry is always `''`. */
  fulltime: readonly FulltimeEntry[];
  /** Days with a target of their own, sorted; parallel to `targets`. A missing day has target 0. */
  days: readonly DayKey[];
  targets: readonly DayTarget[];
  interval: BalanceInterval;
}

export const DEFAULT_FULLTIME_MS = 8 * 3_600_000;
export const MAX_TARGET_MS = 24 * 3_600_000;
export const MAX_TARGET_PERCENT = 300;

export const INITIAL_TARGETS: TargetsState = {
  enabled: false,
  fulltime: [{ from: '', ms: DEFAULT_FULLTIME_MS }],
  days: [],
  targets: [],
  interval: { from: null, to: null },
};

// ---------------------------------------------------------------------------------------------
// Validation and parsing

export function isDayKey(value: unknown): value is DayKey {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return Temporal.PlainDate.from(value, { overflow: 'reject' }).toString() === value;
  } catch {
    return false;
  }
}

export function isTargetMs(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_TARGET_MS && (value as number) % 60_000 === 0;
}

export function isDayTarget(value: unknown): value is DayTarget {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (keys.length !== 1) return false;
  if ('ms' in v) return isTargetMs(v.ms);
  if ('percent' in v) {
    return typeof v.percent === 'number' && Number.isFinite(v.percent) && v.percent >= 0 && v.percent <= MAX_TARGET_PERCENT;
  }
  return false;
}

/** A target of zero is stored as "no target", so 0 % and an empty day are the same thing. */
export function isZeroTarget(t: DayTarget): boolean {
  return 'ms' in t ? t.ms === 0 : t.percent === 0;
}

/**
 * Parses what the user typed: `hh:mm` (`6:30`, `06:30`) or a percentage (`75%`, `62.5 %`,
 * `62,5%`). Returns null for anything else or anything out of range.
 */
export function parseTarget(text: string): DayTarget | null {
  const s = text.trim();
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (clock) {
    const ms = (Number(clock[1]) * 60 + Number(clock[2])) * 60_000;
    return ms <= MAX_TARGET_MS ? { ms } : null;
  }
  const pct = /^(\d{1,3}(?:[.,]\d+)?)\s*%$/.exec(s);
  if (pct) {
    const percent = Number(pct[1]!.replace(',', '.'));
    return percent <= MAX_TARGET_PERCENT ? { percent } : null;
  }
  return null;
}

/** `8:00`, `0:45`. */
export function formatClock(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** `+1:15`, `−0:30` (a real minus sign), `0:00`. */
export function formatBalance(ms: number): string {
  const rounded = Math.round(ms / 60_000);
  if (rounded === 0) return '0:00';
  return `${rounded > 0 ? '+' : '−'}${formatClock(ms)}`;
}

/** Parses `h:mm` for the full-time setting (1 minute to 24 hours). */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim());
  if (!m) return null;
  const ms = (Number(m[1]) * 60 + Number(m[2])) * 60_000;
  return ms > 0 && ms <= MAX_TARGET_MS ? ms : null;
}

// ---------------------------------------------------------------------------------------------
// Pure updates (used by the commands)

function lowerBound(days: readonly string[], day: string): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid]! < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Sets (or clears, for null or zero) one day's target. Copies two arrays of days-with-targets. */
export function withDayTarget(t: TargetsState, day: DayKey, target: DayTarget | null): TargetsState {
  const i = lowerBound(t.days, day);
  const exists = t.days[i] === day;
  const days = [...t.days];
  const targets = [...t.targets];
  if (target === null || isZeroTarget(target)) {
    if (!exists) return t;
    days.splice(i, 1);
    targets.splice(i, 1);
  } else if (exists) {
    targets[i] = target;
  } else {
    days.splice(i, 0, day);
    targets.splice(i, 0, target);
  }
  return { ...t, days, targets };
}

/** New full-time hours, from `applyFrom` on (later entries are replaced) or for all days (null). */
export function withFulltime(t: TargetsState, ms: number, applyFrom: DayKey | null): TargetsState {
  if (applyFrom === null) return { ...t, fulltime: [{ from: '', ms }] };
  const kept = t.fulltime.filter((e) => e.from < applyFrom);
  return { ...t, fulltime: [...kept, { from: applyFrom, ms }] };
}

// ---------------------------------------------------------------------------------------------
// Queries

/** Full-time hours in force on `day`. */
export function fulltimeOn(t: TargetsState, day: DayKey): number {
  let ms = t.fulltime[0]!.ms;
  for (const e of t.fulltime) {
    if (e.from <= day) ms = e.ms;
    else break;
  }
  return ms;
}

export function resolveTarget(t: TargetsState, day: DayKey, target: DayTarget): number {
  return 'ms' in target ? target.ms : Math.round(((target.percent / 100) * fulltimeOn(t, day)) / 60_000) * 60_000;
}

/** The day's own target, if any (never a zero one). */
export function dayTarget(t: TargetsState, day: DayKey): DayTarget | null {
  const i = lowerBound(t.days, day);
  return t.days[i] === day ? t.targets[i]! : null;
}

export function targetMs(t: TargetsState, day: DayKey): number {
  const target = dayTarget(t, day);
  return target ? resolveTarget(t, day, target) : 0;
}

/** Σ targets over `[first, last]` (inclusive). O(log n + days with a target in range). */
export function targetSum(t: TargetsState, first: DayKey, last: DayKey): number {
  let sum = 0;
  for (let i = lowerBound(t.days, first); i < t.days.length && t.days[i]! <= last; i++) {
    sum += resolveTarget(t, t.days[i]!, t.targets[i]!);
  }
  return sum;
}

export interface Balance {
  /** The days actually aggregated: `[first, last]`, or null when nothing (or only the future) is in range. */
  first: DayKey | null;
  last: DayKey | null;
  trackedMs: number;
  targetMs: number;
  balanceMs: number;
}

export interface BalanceContext {
  zone: string;
  dayStartHour: number;
  now: number;
}

/**
 * Balance over the logical days `[first, last]`, clipped to today: future days never count, today
 * counts in full. Every day contributes `tracked − target`, so no per-day scan is needed.
 * Cost: O(buckets) for the tracked time plus O(log n + targets in range).
 */
export function balanceOver(state: TimetrackState, first: DayKey, last: DayKey, ctx: BalanceContext): Balance {
  const today = logicalDayOf(ctx.now, ctx.zone, ctx.dayStartHour);
  const end = last < today ? last : today;
  if (first > end) return { first: null, last: null, trackedMs: 0, targetMs: 0, balanceMs: 0 };
  const from = dayRange(first, ctx.zone, ctx.dayStartHour).from;
  const to = Math.min(dayRange(end, ctx.zone, ctx.dayStartHour).to, ctx.now);
  const running = state.runningId ? getBlock(state.blocks, state.runningId) : undefined;
  const tracked = Math.max(0, trackedBefore(state.blocks, to, ctx.now, running) - trackedBefore(state.blocks, from, ctx.now, running));
  const target = targetSum(state.targets, first, end);
  return { first, last: end, trackedMs: tracked, targetMs: target, balanceMs: tracked - target };
}

/** The first day with tracked time or a target: where "since the beginning" starts. */
export function firstActiveDay(state: TimetrackState, ctx: BalanceContext): DayKey | null {
  const candidates: DayKey[] = [];
  const first = firstBlock(state.blocks);
  if (first) candidates.push(logicalDayOf(first.startMs, ctx.zone, ctx.dayStartHour));
  if (state.targets.days[0]) candidates.push(state.targets.days[0]);
  return candidates.length ? candidates.sort()[0]! : null;
}

/** The balance over the configured interval (§10.2 *Statistics*). */
export function intervalBalance(state: TimetrackState, ctx: BalanceContext): Balance {
  const { from, to } = state.targets.interval;
  const first = from ?? firstActiveDay(state, ctx);
  const last = to ?? logicalDayOf(ctx.now, ctx.zone, ctx.dayStartHour);
  if (!first) return { first: null, last: null, trackedMs: 0, targetMs: 0, balanceMs: 0 };
  return balanceOver(state, first, last, ctx);
}

/** Balance of one logical day (for the Day-view chip and week headers). */
export function dayBalance(state: TimetrackState, day: DayKey, ctx: BalanceContext): Balance {
  return balanceOver(state, day, day, ctx);
}

