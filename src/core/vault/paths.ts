/** Vault folder layout (README §4.2). */

export const LOG_DIR = 'log';
export const LIVE_DIR = 'log/live';

/** UTC calendar day, `YYYY-MM-DD`. File names use UTC so every computer agrees. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** UTC month, `YYYY-MM`. */
export function utcMonth(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

/** `<day>.<writer>.<n>.jsonl`: one file per writer session segment; only that writer appends to it. */
export function liveSegmentName(day: string, writer: string, n: number): string {
  return `${day}.${writer}.${n.toString(36)}.jsonl`;
}

/** `<month>.<content hash>.jsonl.gz`: immutable, compacted union of a month's segments. */
export function monthFileName(month: string, hash: string): string {
  return `${month}.${hash}.jsonl.gz`;
}

const LOG_FILE = /^(\d{4}-\d{2}).*\.jsonl/;

/**
 * Month a log file belongs to, or null if the name is not a log file. Deliberately lenient so
 * sync-client conflict copies (`… (1).jsonl`, `….jsonl (1).gz`) are still picked up.
 */
export function logFileMonth(name: string): string | null {
  return LOG_FILE.exec(name)?.[1] ?? null;
}
