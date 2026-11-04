import type { AppMessageKey } from '@focuspocus/registry';
import type { ThemeToken } from './tokens';

export interface ThemeDefinition {
  id: string;
  labelKey: AppMessageKey;
  /** Drives CSS `color-scheme` (native controls, scrollbars). */
  colorScheme: 'dark' | 'light';
  tokens: Record<ThemeToken, string>;
}
