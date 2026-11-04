import { darkTheme } from './themes/dark';
import type { ThemeDefinition } from './types';

/** Adding a theme = one file in ./themes plus one entry here. */
export const THEMES: Readonly<Record<string, ThemeDefinition>> = {
  [darkTheme.id]: darkTheme,
};

export const DEFAULT_THEME_ID = darkTheme.id;

/** Missing or unknown ids (e.g. from a newer build) fall back to the default theme. */
export function resolveTheme(id: unknown): ThemeDefinition {
  return typeof id === 'string' && Object.hasOwn(THEMES, id) ? THEMES[id]! : THEMES[DEFAULT_THEME_ID]!;
}
