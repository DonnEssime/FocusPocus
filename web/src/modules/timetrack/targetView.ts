import type { TimetrackState } from '@focuspocus/modules/timetrack';
import { dayBalance, dayTarget, formatClock, targetMs, type DayTarget } from '@focuspocus/modules/timetrack/targets';
import type { DayKey } from '@focuspocus/modules/timetrack/time';
import type { TimetrackUi } from './ui.svelte';

export interface DayTargetView {
  day: DayKey;
  future: boolean;
  /** Resolved target (0 when none). */
  targetMs: number;
  trackedMs: number;
  balanceMs: number;
  /** Whether the day counts: a target above 0 or tracked time; a future day only with tracked time (§10.2 *Which days count*). */
  counts: boolean;
}

export function dayTargetView(tt: TimetrackState, day: DayKey, ui: TimetrackUi): DayTargetView {
  const future = day > ui.today;
  const target = targetMs(tt.targets, day);
  const b = dayBalance(tt, day, { zone: ui.zone, dayStartHour: ui.dayStartHour, now: ui.now });
  return { day, future, targetMs: target, trackedMs: b.trackedMs, balanceMs: b.balanceMs, counts: b.first !== null && (target > 0 || b.trackedMs > 0) };
}

/** The day's own target as the entry field shows it: `6:30`, `75%`, or empty. */
export function targetText(target: DayTarget | null): string {
  if (!target) return '';
  return 'ms' in target ? formatClock(target.ms) : `${target.percent}%`;
}

export function ownTarget(tt: TimetrackState, day: DayKey): DayTarget | null {
  return dayTarget(tt.targets, day);
}
