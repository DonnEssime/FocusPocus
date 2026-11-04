import type { DayKey } from '@focuspocus/modules/timetrack/time';

export const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

const timeFormats = new Map<string, Intl.DateTimeFormat>();

/** Local wall-clock time `HH:MM` of an instant in `zone`. */
export function formatTime(ms: number, zone: string, locale: string): string {
  const key = `${locale}|${zone}`;
  let f = timeFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone });
    timeFormats.set(key, f);
  }
  return f.format(ms);
}

/** A calendar day as a Date for display only (noon UTC, formatted in UTC, so no zone can shift it). */
function asDate(day: DayKey): Date {
  return new Date(`${day}T12:00:00Z`);
}

export function formatDay(day: DayKey, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(asDate(day));
}

export function formatDayRange(first: DayKey, last: DayKey, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).formatRange(asDate(first), asDate(last));
}

/** `2h 05m`, `45m`, `0m`. */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
