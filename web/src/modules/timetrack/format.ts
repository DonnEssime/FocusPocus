export const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
