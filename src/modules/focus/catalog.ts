import type { MessageCatalog } from '../../core/i18n/types';

export const focusCatalog = {
  'focus.title': { en: 'Focus' },
  'focus.panel.timer': { en: 'Timer' },
  'focus.panel.settings': { en: 'Settings' },
  'focus.start': { en: 'Start' },
  'focus.stop': { en: 'Stop' },
  'focus.silentHere': { en: 'Running in another window. Sounds play there.' },
  'focus.settings.duration': { en: 'Length (minutes)' },
  'focus.settings.tickingSound': { en: 'Ticking sound' },
  'focus.settings.finishingSound': { en: 'Finishing sound' },
  'focus.settings.previewHint': { en: 'Choosing a sound plays a short preview.' },
  'focus.sound.clock-tick': { en: 'Clock ticking' },
  'focus.sound.rainforest-rain': { en: 'Rainforest rain' },
  'focus.sound.bell-single': { en: 'Single bell' },
  'focus.sound.bell-triple': { en: 'Triple bell' },
  'focus.sound.chime-soft': { en: 'Soft chimes' },
  'focus.error.invalidDuration': { en: 'The length must be a whole number of minutes from {min} to {max}.' },
  'focus.error.invalidSound': { en: 'Unknown sound.' },
  'focus.error.invalidSession': { en: 'This focus session is malformed.' },
  'focus.error.noChanges': { en: 'Nothing to change.' },
} as const satisfies MessageCatalog;
