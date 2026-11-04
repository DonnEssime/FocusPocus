import { describe, expect, it } from 'vitest';
import { resolveLocale, SUPPORTED_LOCALES } from '../src/core/i18n/locales';
import { interpolate, resolveMessage } from '../src/core/i18n/resolve';
import { CATALOG_PARTS, catalog, MODULES } from '../src/registry';

describe('catalog', () => {
  it('has an English text for every key', () => {
    for (const [key, entry] of Object.entries(catalog)) {
      expect(entry.en.trim(), key).not.toBe('');
    }
  });

  it('never defines a key twice', () => {
    const total = CATALOG_PARTS.reduce((n, part) => n + Object.keys(part).length, 0);
    expect(Object.keys(catalog)).toHaveLength(total);
  });

  it('prefixes module keys with the module id', () => {
    for (const m of MODULES) {
      for (const key of Object.keys(m.catalog)) expect(key.startsWith(`${m.id}.`), key).toBe(true);
    }
  });

  it('reports missing translations (warn-only)', () => {
    const missing = SUPPORTED_LOCALES.filter((l) => l !== 'en').flatMap((locale) =>
      Object.entries(catalog)
        .filter(([, e]) => !(e as Record<string, string>)[locale])
        .map(([k]) => `${locale}:${k}`),
    );
    if (missing.length) console.warn(`Missing translations: ${missing.length}`);
  });
});

describe('resolve', () => {
  it('interpolates params and falls back for unknown keys and locales', () => {
    expect(interpolate('a {x} b {y}', { x: 1 })).toBe('a 1 b {y}');
    expect(resolveMessage(catalog, 'core.missingDependency', 'en', { dep: 'q' }).text).toContain('q');
    expect(resolveMessage(catalog, 'no.such.key')).toEqual({ text: 'no.such.key', fallback: false, missing: true });
    expect(resolveLocale('xx')).toBe('en');
  });
});
