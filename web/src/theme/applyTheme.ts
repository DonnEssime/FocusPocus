import { THEME_TOKENS } from './tokens';
import type { ThemeDefinition } from './types';

export function applyTheme(theme: ThemeDefinition, root: HTMLElement = document.documentElement): void {
  for (const token of THEME_TOKENS) root.style.setProperty(`--${token}`, theme.tokens[token]);
  root.style.colorScheme = theme.colorScheme;
  root.dataset.theme = theme.id;
}
