import { describe, expect, it } from 'vitest';
import { formatLength, parseTimerInput } from '../src/modules/timers/parse';

// Local wall-clock times, so the tests hold in any time zone.
const local = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = local(2026, 11, 17, 10, 15);
const S = 1_000;
const M = 60 * S;
const H = 60 * M;

const length = (text: string) => {
  const r = parseTimerInput(text, NOW);
  return r.ok && r.value.kind === 'length' ? r.value.ms : r;
};
const at = (text: string, now = NOW) => {
  const r = parseTimerInput(text, now);
  return r.ok && r.value.kind === 'at' ? r.value.endsAt : r;
};
const reason = (text: string) => {
  const r = parseTimerInput(text, NOW);
  return r.ok ? r.value : r.reason;
};

describe('parseTimerInput: lengths', () => {
  it.each([
    ['5m', 5 * M],
    ['5 min', 5 * M],
    ['5 minutes', 5 * M],
    ['25', 25 * M],
    ['2.5', 2.5 * M],
    ['2.5 min', 2.5 * M],
    ['90s', 90 * S],
    ['1h', H],
    ['1h00', H],
    ['1h30', H + 30 * M],
    ['1h 30m', H + 30 * M],
    ['1 hour 5 minutes', H + 5 * M],
    ['2h15m30s', 2 * H + 15 * M + 30 * S],
    ['5m30', 5 * M + 30 * S],
    ['1.5h', 1.5 * H],
    ['1,5 h', 1.5 * H],
    ['2d', 48 * H],
    ['  10M ', 10 * M],
  ])('%s', (text, ms) => {
    expect(length(text)).toBe(ms);
  });

  it.each([
    ['', 'timers.parse.invalid'],
    ['abc', 'timers.parse.invalid'],
    ['5x', 'timers.parse.invalid'],
    ['30m 1h', 'timers.parse.invalid'], // units must get smaller
    ['5m 5m', 'timers.parse.invalid'],
    ['10s5', 'timers.parse.invalid'], // nothing smaller than seconds
    ['5 5', 'timers.parse.invalid'],
    ['0', 'timers.parse.tooShort'],
    ['0.5s', 'timers.parse.tooShort'],
    ['400d', 'timers.parse.tooLong'],
  ])('rejects %j', (text, why) => {
    expect(reason(text)).toBe(why);
  });
});

describe('parseTimerInput: clock times', () => {
  it('reads 24-hour and am/pm times, as the next such moment', () => {
    expect(at('13:30')).toBe(local(2026, 11, 17, 13, 30));
    expect(at('1:00 pm')).toBe(local(2026, 11, 17, 13, 0));
    expect(at('7pm')).toBe(local(2026, 11, 17, 19, 0));
    expect(at('7 P.M.')).toBe(local(2026, 11, 17, 19, 0));
    expect(at('at 18:00')).toBe(local(2026, 11, 17, 18, 0));
    // Already passed today: tomorrow.
    expect(at('1:00 am')).toBe(local(2026, 11, 18, 1, 0));
    expect(at('10:15')).toBe(local(2026, 11, 18, 10, 15));
    expect(at('12am')).toBe(local(2026, 11, 18, 0, 0));
    expect(at('12pm')).toBe(local(2026, 11, 17, 12, 0));
    expect(at('0:30')).toBe(local(2026, 11, 18, 0, 30));
  });

  it('reads an optional date before or after the time', () => {
    expect(at('7am tomorrow')).toBe(local(2026, 11, 18, 7, 0));
    expect(at('tomorrow at 13:30')).toBe(local(2026, 11, 18, 13, 30));
    expect(at('today 18:00')).toBe(local(2026, 11, 17, 18, 0));
    expect(at('13:30 20/11')).toBe(local(2026, 11, 20, 13, 30));
    expect(at('20.11 1:00 am')).toBe(local(2026, 11, 20, 1, 0));
    expect(at('1:00 am 20/11/2026')).toBe(local(2026, 11, 20, 1, 0));
    expect(at('9:00 3/1/27')).toBe(local(2027, 1, 3, 9, 0));
    expect(at('2026-12-24 18:00')).toBe(local(2026, 12, 24, 18, 0));
    // A day-month that has passed this year means next year.
    expect(at('9:00 3/1')).toBe(local(2027, 1, 3, 9, 0));
  });

  it.each([
    ['today 9:00', 'timers.parse.past'],
    ['9:00 17/11/2026', 'timers.parse.past'],
    ['9:00 2025-01-01', 'timers.parse.past'],
    ['9:00 31/2', 'timers.parse.invalid'],
    ['24:00', 'timers.parse.invalid'],
    ['13:60', 'timers.parse.invalid'],
    ['13pm', 'timers.parse.invalid'],
    ['0am', 'timers.parse.invalid'],
    ['tomorrow', 'timers.parse.invalid'],
    ['tomorrow 5m', 'timers.parse.invalid'],
    ['20/11', 'timers.parse.invalid'],
    ['9:00 2028-01-01', 'timers.parse.tooLong'],
  ])('rejects %j', (text, why) => {
    expect(reason(text)).toBe(why);
  });
});

describe('formatLength', () => {
  it('shows only the parts that are not zero', () => {
    expect(formatLength(5 * M)).toBe('5m');
    expect(formatLength(H + 30 * M)).toBe('1h 30m');
    expect(formatLength(H + 30 * S)).toBe('1h 30s');
    expect(formatLength(50 * H)).toBe('2d 2h');
    expect(formatLength(0)).toBe('0s');
  });
});
