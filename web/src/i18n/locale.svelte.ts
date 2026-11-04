import { DEFAULT_LOCALE, type Locale } from '@focuspocus/core/i18n/locales';

let current = $state<Locale>(DEFAULT_LOCALE);

export function getLocale(): Locale {
  return current;
}

/** Set from vault state (app module) by the shell; never persisted in the browser. */
export function setLocale(next: Locale): void {
  current = next;
}
