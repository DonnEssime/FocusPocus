import { blocksInRange, effectiveEnd } from './blocks';
import type { TimetrackState } from './index';
import { dayRange, type DayKey } from './time';

/** Key used for time without any live tag. */
export const NO_TAG = '';

export interface Totals {
  totalMs: number;
  /** Tag id (or `NO_TAG`) → milliseconds. Shares always add up to `totalMs`. */
  byTag: Map<string, number>;
}

function liveTagIds(state: TimetrackState, tagIds: readonly string[]): string[] {
  return tagIds.filter((id) => Object.hasOwn(state.tags, id) && !state.tags[id]!.deleted);
}

/**
 * Tracked time inside `[from, to)`. A block with n live tags adds 1/n of its time to each; a
 * block without live tags counts as "No tag". The running block counts up to `now`.
 *
 * Cost: one range query (the buckets around the range), so a month of days stays cheap no matter
 * how much history the vault holds.
 */
export function rangeTotals(state: TimetrackState, from: number, to: number, now: number): Totals {
  const byTag = new Map<string, number>();
  let totalMs = 0;
  for (const block of blocksInRange(state.blocks, from, to, now)) {
    const ms = Math.min(effectiveEnd(block, now), to) - Math.max(block.startMs, from);
    if (ms <= 0) continue;
    totalMs += ms;
    const tags = liveTagIds(state, block.tagIds);
    const keys = tags.length ? tags : [NO_TAG];
    for (const k of keys) byTag.set(k, (byTag.get(k) ?? 0) + ms / keys.length);
  }
  return { totalMs, byTag };
}

/** Totals per logical day. Blocks crossing a day boundary are split across the days they touch. */
export function dayTotals(
  state: TimetrackState,
  days: readonly DayKey[],
  zone: string,
  dayStartHour: number,
  now: number,
): Map<DayKey, Totals> {
  return new Map(
    days.map((day) => {
      const { from, to } = dayRange(day, zone, dayStartHour);
      return [day, rangeTotals(state, from, to, now)];
    }),
  );
}

/** Slices for a pie or legend, largest first, ties in a stable order. */
export function totalsSlices(totals: Totals): { key: string; ms: number; share: number }[] {
  return [...totals.byTag]
    .filter(([, ms]) => ms > 0)
    .map(([key, ms]) => ({ key, ms, share: totals.totalMs ? ms / totals.totalMs : 0 }))
    .sort((a, b) => b.ms - a.ms || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
