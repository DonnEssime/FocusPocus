/** Every locale the app ships. Adding a language = add its code here and fill catalog entries. */
export const SUPPORTED_LOCALES = ['en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Map any stored/unknown value to a supported locale (unknown → default). */
export function resolveLocale(value: unknown): Locale {
  return (SUPPORTED_LOCALES as readonly unknown[]).includes(value) ? (value as Locale) : DEFAULT_LOCALE;
}
