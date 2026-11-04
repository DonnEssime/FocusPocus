import type { MessageCatalog } from '../../core/i18n/types';

export const focusCatalog = {
  'focus.title': { en: 'Focus' },
  'focus.panel.timer': { en: 'Timer' },
  'focus.panel.settings': { en: 'Settings' },
  'focus.placeholder': { en: 'The focus timer is coming soon.' },
  'focus.start': { en: 'Start' },
  'focus.settings.duration': { en: 'Length (minutes)' },
  'focus.error.invalidDuration': { en: 'The length must be a whole number of minutes from {min} to {max}.' },
  'focus.error.invalidSound': { en: 'Unknown sound.' },
  'focus.error.noChanges': { en: 'Nothing to change.' },
} as const satisfies MessageCatalog;
