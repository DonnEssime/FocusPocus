import type { Locale } from './locales';

/** One catalog entry: English is mandatory, every other locale optional (falls back to English). */
export type MessageEntry = { en: string } & Partial<Record<Exclude<Locale, 'en'>, string>>;

export type MessageCatalog = Record<string, MessageEntry>;

export type MessageParams = Record<string, string | number>;
