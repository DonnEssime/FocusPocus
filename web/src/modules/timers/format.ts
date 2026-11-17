import { msgText } from '../../i18n/msg';

/** `05:03`, `1:05:03`, `2d 03:05:03`; rounds up, so a fresh 5-minute timer reads 05:00. */
export function formatCountdown(ms: number): string {
  let total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86_400);
  total -= days * 86_400;
  const h = Math.floor(total / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (days) return `${days}d ${String(h).padStart(2, '0')}:${mmss}`;
  return h ? `${h}:${mmss}` : mmss;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * When a timer rings (or rang), in local time: `13:45` today, `tomorrow 01:00`, otherwise with the
 * date (`Fri 20 Nov 13:45`, plus the year when it differs).
 */
export function formatWhen(ms: number, now: number, locale: string): string {
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
  const day = startOfDay(ms);
  const today = startOfDay(now);
  if (day === today) return time;
  const tomorrow = startOfDay(new Date(today).setDate(new Date(today).getDate() + 1));
  if (day === tomorrow) return msgText('timers.tomorrow', { time });
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  const date = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(ms);
  return `${date} ${time}`;
}
