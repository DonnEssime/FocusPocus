/**
 * Complete list of semantic colour tokens. Components use `var(--<token>)` only; every theme
 * must define every token (enforced by the `Record<ThemeToken, string>` type).
 */
export const THEME_TOKENS = [
  'bg',
  'surface',
  'surface-raised',
  'surface-sunken',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'text-on-accent',
  'accent',
  'accent-hover',
  'danger',
  'warning',
  'success',
  'focus-ring',
  'tag-none',
  'ink-on-light',
  'ink-on-dark',
  'now-line',
  'shadow',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
