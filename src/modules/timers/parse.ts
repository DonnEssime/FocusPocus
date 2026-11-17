import { TIMER_MAX_MS, TIMER_MIN_MS } from './index';

/**
 * Reading what the user typed in the new-timer field. Two shapes:
 *
 * - **A length**, with units: `5m`, `90s`, `1h`, `1h30`, `1h 30m`, `2h15m30s`, `1.5h`, `1,5 h`,
 *   `2d`. A bare number is minutes (`25`). A bare number after a unit is the next smaller unit
 *   (`1h00` is 1 hour, `5m30` is 5 minutes 30 seconds).
 * - **A clock time**, which needs a colon or am/pm: `13:30`, `1:00 am`, `7am`, `7 p.m.`.
 *   Without a date it is the next such moment (today, or tomorrow if that has passed). An optional
 *   date, before or after the time: `today`, `tomorrow`, `20/11`, `20.11.2026`, `2026-11-20`
 *   (day first). A date without a year that has passed this year means next year.
 *
 * Runs in the UI (it reads the local time zone through `Date`), never inside an apply function.
 */
export type ParsedTimer = { kind: 'length'; ms: number } | { kind: 'at'; endsAt: number };

export type ParseTimerReason = 'timers.parse.invalid' | 'timers.parse.past' | 'timers.parse.tooShort' | 'timers.parse.tooLong';

export type ParseTimerResult = { ok: true; value: ParsedTimer } | { ok: false; reason: ParseTimerReason };

const SECOND = 1_000;
const UNITS: Record<string, { rank: number; ms: number }> = {};
for (const [names, rank, ms] of [
  [['d', 'day', 'days'], 3, 86_400_000],
  [['h', 'hr', 'hrs', 'hour', 'hours'], 2, 3_600_000],
  [['m', 'min', 'mins', 'minute', 'minutes'], 1, 60_000],
  [['s', 'sec', 'secs', 'second', 'seconds'], 0, SECOND],
] as const) {
  for (const name of names) UNITS[name] = { rank, ms };
}
const MS_BY_RANK = [SECOND, 60_000, 3_600_000, 86_400_000];

const fail = (reason: ParseTimerReason): ParseTimerResult => ({ ok: false, reason });

export function parseTimerInput(text: string, now: number): ParseTimerResult {
  const s = text
    .toLowerCase()
    .replace(/\b([ap])\.m\.?/g, '$1m')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return fail('timers.parse.invalid');
  return parseClock(s, now) ?? parseLength(s);
}

function parseLength(s: string): ParseTimerResult {
  const re = /(\d+(?:[.,]\d+)?) ?([a-z]*) ?/y;
  let ms = 0;
  let lastRank: number | null = null;
  let tokens = 0;
  let m: RegExpExecArray | null;
  while (re.lastIndex < s.length && (m = re.exec(s))) {
    const value = Number(m[1]!.replace(',', '.'));
    let rank: number;
    if (m[2]) {
      const unit = UNITS[m[2]];
      if (!unit) return fail('timers.parse.invalid');
      rank = unit.rank;
    } else if (lastRank === null) {
      rank = 1; // a lone number is minutes
      if (re.lastIndex < s.length) return fail('timers.parse.invalid');
    } else {
      rank = lastRank - 1; // `1h30`: the next smaller unit
      if (rank < 0) return fail('timers.parse.invalid');
    }
    if (lastRank !== null && rank >= lastRank) return fail('timers.parse.invalid');
    lastRank = rank;
    ms += value * MS_BY_RANK[rank]!;
    tokens++;
  }
  if (tokens === 0 || re.lastIndex < s.length) return fail('timers.parse.invalid');
  ms = Math.round(ms);
  if (ms < TIMER_MIN_MS) return fail('timers.parse.tooShort');
  if (ms > TIMER_MAX_MS) return fail('timers.parse.tooLong');
  return { ok: true, value: { kind: 'length', ms } };
}

type DateSpec = { kind: 'relative'; days: 0 | 1 } | { kind: 'date'; day: number; month: number; year: number | null };

const DATE_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => DateSpec]> = [
  [/\b(today|tomorrow)\b/, (m) => ({ kind: 'relative', days: m[1] === 'today' ? 0 : 1 })],
  [/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, (m) => ({ kind: 'date', year: +m[1]!, month: +m[2]!, day: +m[3]! })],
  [
    /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}|\d{2}))?(?![\d:])/,
    (m) => ({ kind: 'date', day: +m[1]!, month: +m[2]!, year: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null }),
  ],
];

/** A clock time (with an optional date), or `null` when the text is not one, so it may be a length. */
function parseClock(s: string, now: number): ParseTimerResult | null {
  let date: DateSpec | null = null;
  let rest = s;
  for (const [re, read] of DATE_PATTERNS) {
    const m = rest.match(re);
    if (!m) continue;
    date = read(m);
    rest = rest.slice(0, m.index) + rest.slice(m.index! + m[0].length);
    break;
  }
  rest = rest.replace(/\b(at|on)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const t = /^(\d{1,2})(?::(\d{2}))? ?(am|pm)?$/.exec(rest);
  // Not a time: maybe a length after all (`2.5 min` looks like a day.month date).
  if (!t || (t[2] === undefined && t[3] === undefined)) return null;
  let hour = +t[1]!;
  const minute = t[2] === undefined ? 0 : +t[2];
  if (minute > 59) return fail('timers.parse.invalid');
  if (t[3]) {
    if (hour < 1 || hour > 12) return fail('timers.parse.invalid');
    hour = (hour % 12) + (t[3] === 'pm' ? 12 : 0);
  } else if (hour > 23) {
    return fail('timers.parse.invalid');
  }

  const today = new Date(now);
  const at = (year: number, month: number, day: number) => new Date(year, month - 1, day, hour, minute).getTime();
  let endsAt: number;
  if (!date) {
    endsAt = at(today.getFullYear(), today.getMonth() + 1, today.getDate());
    if (endsAt <= now) endsAt = at(today.getFullYear(), today.getMonth() + 1, today.getDate() + 1);
  } else if (date.kind === 'relative') {
    endsAt = at(today.getFullYear(), today.getMonth() + 1, today.getDate() + date.days);
  } else {
    const year = date.year ?? today.getFullYear();
    const check = new Date(year, date.month - 1, date.day);
    if (check.getMonth() !== date.month - 1 || check.getDate() !== date.day) return fail('timers.parse.invalid');
    endsAt = at(year, date.month, date.day);
    if (endsAt <= now && date.year === null) endsAt = at(year + 1, date.month, date.day);
  }
  if (endsAt <= now) return fail('timers.parse.past');
  if (endsAt - now > TIMER_MAX_MS) return fail('timers.parse.tooLong');
  return { ok: true, value: { kind: 'at', endsAt } };
}

/** A length as `1h 30m`, `5m`, `45s`, `2d 3h`: only the parts that are not zero. */
export function formatLength(ms: number): string {
  let rest = Math.round(ms / SECOND);
  const parts: string[] = [];
  for (const [unit, size] of [
    ['d', 86_400],
    ['h', 3_600],
    ['m', 60],
    ['s', 1],
  ] as const) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n) parts.push(`${n}${unit}`);
  }
  return parts.join(' ') || '0s';
}
