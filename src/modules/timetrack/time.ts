/**
 * All calendar arithmetic of the time tracker (§10.2 *Time model*). Blocks are UTC instants; this
 * helper maps them to logical days in a given IANA time zone. Built on `Temporal` (native in current
 * Chromium; the web app loads a polyfill where it is missing, and the tests install one globally).
 *
 * Never replace this with hand-written `Date` or millisecond arithmetic: logical days are 23, 24 or
 * 25 hours long across daylight-saving changes.
 */

/** A logical day, as an ISO calendar date `YYYY-MM-DD` (the date on which the day starts). */
export type DayKey = string;

/** Monday. Weeks start on this ISO weekday everywhere in the app. */
export const WEEK_STARTS_ON = 1;

export interface DayWindowHours {
  startHour: number;
  endHour: number;
}

export interface Range {
  /** Inclusive start, epoch ms. */
  from: number;
  /** Exclusive end, epoch ms. */
  to: number;
}

export function currentZone(): string {
  return Temporal.Now.timeZoneId();
}

function plain(day: DayKey): Temporal.PlainDate {
  return Temporal.PlainDate.from(day);
}

/** Start of the given local wall-clock hour on `day`. A skipped hour (DST gap) moves forward. */
function wallClockMs(day: Temporal.PlainDate, hour: number, zone: string): number {
  return day.toZonedDateTime({ timeZone: zone, plainTime: new Temporal.PlainTime(hour) }).epochMilliseconds;
}

export function addDays(day: DayKey, n: number): DayKey {
  return plain(day).add({ days: n }).toString();
}

export function addMonths(day: DayKey, n: number): DayKey {
  return plain(day).add({ months: n }).toString();
}

/** The logical day an instant belongs to: before `dayStartHour` it still counts as the previous day. */
export function logicalDayOf(ms: number, zone: string, dayStartHour: number): DayKey {
  const zdt = Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone);
  const date = zdt.toPlainDate();
  return (zdt.hour < dayStartHour ? date.subtract({ days: 1 }) : date).toString();
}

/** The full logical day, from `dayStartHour` to the same hour on the next calendar day. */
export function dayRange(day: DayKey, zone: string, dayStartHour: number): Range {
  const d = plain(day);
  return { from: wallClockMs(d, dayStartHour, zone), to: wallClockMs(d.add({ days: 1 }), dayStartHour, zone) };
}

/** The visible part of a logical day. `endHour <= startHour` ends on the next calendar day. */
export function windowRange(day: DayKey, zone: string, window: DayWindowHours): Range {
  const d = plain(day);
  const endDay = window.endHour > window.startHour ? d : d.add({ days: 1 });
  return { from: wallClockMs(d, window.startHour, zone), to: wallClockMs(endDay, window.endHour, zone) };
}

/** The Monday on or before `day`. */
export function weekStart(day: DayKey): DayKey {
  const d = plain(day);
  return d.subtract({ days: (d.dayOfWeek - WEEK_STARTS_ON + 7) % 7 }).toString();
}

export function monthStart(day: DayKey): DayKey {
  return plain(day).with({ day: 1 }).toString();
}

export function daysInMonth(day: DayKey): number {
  return plain(day).daysInMonth;
}

/** ISO weekday, 1 = Monday … 7 = Sunday. */
export function weekday(day: DayKey): number {
  return plain(day).dayOfWeek;
}

/** `count` consecutive days starting at `first`. */
export function daySequence(first: DayKey, count: number): DayKey[] {
  const d = plain(first);
  return Array.from({ length: count }, (_, i) => d.add({ days: i }).toString());
}

/** Whole local hours from the window start to each hour mark inside the window (for grid lines). */
export function hourMarks(day: DayKey, zone: string, window: DayWindowHours): { ms: number; hour: number }[] {
  const { from, to } = windowRange(day, zone, window);
  const marks: { ms: number; hour: number }[] = [];
  let zdt = Temporal.Instant.fromEpochMilliseconds(from).toZonedDateTimeISO(zone);
  while (zdt.epochMilliseconds < to) {
    marks.push({ ms: zdt.epochMilliseconds, hour: zdt.hour });
    // Adding exact time (not wall-clock hours) shows the repeated hour on a 25 h day.
    zdt = zdt.add({ hours: 1 }).round({ smallestUnit: 'hour', roundingMode: 'floor' });
  }
  return marks;
}
