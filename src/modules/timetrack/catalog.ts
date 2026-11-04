import type { MessageCatalog } from '../../core/i18n/types';

export const timetrackCatalog = {
  'timetrack.title': { en: 'Time tracking' },
  'timetrack.panel.timeView': { en: 'Calendar' },
  'timetrack.panel.settings': { en: 'Settings' },
  'timetrack.placeholder': { en: 'The calendar is coming soon.' },
  'timetrack.dayWindow.summary': { en: 'Days are shown from {start} to {end}.' },
  'timetrack.dayWindow.summaryNextDay': { en: 'Days are shown from {start} to {end} the next day.' },
  'timetrack.dayWindow.start': { en: 'Day starts at' },
  'timetrack.dayWindow.end': { en: 'Day ends at' },
  'timetrack.error.invalidHour': { en: 'Hours must be whole numbers from 0 to 23.' },
} as const satisfies MessageCatalog;
