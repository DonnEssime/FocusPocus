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
  'shadow',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
