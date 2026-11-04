import { DEFAULT_LOCALE, type Locale } from './locales';
import type { MessageCatalog, MessageParams } from './types';

export interface ResolvedMessage {
  text: string;
  /** The requested locale had no entry and English was used instead. */
  fallback: boolean;
  /** The key does not exist at all; `text` is the key itself. */
  missing: boolean;
}

export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

export function resolveMessage(
  catalog: MessageCatalog,
  key: string,
  locale: Locale = DEFAULT_LOCALE,
  params?: MessageParams,
): ResolvedMessage {
  const entry = Object.hasOwn(catalog, key) ? catalog[key] : undefined;
  if (!entry) return { text: key, fallback: false, missing: true };
  const localized = (entry as Partial<Record<Locale, string>>)[locale];
  if (localized) return { text: interpolate(localized, params), fallback: false, missing: false };
  return { text: interpolate(entry.en, params), fallback: locale !== 'en', missing: false };
}
