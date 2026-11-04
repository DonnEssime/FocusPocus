import type { MessageCatalog } from '../../core/i18n/types';
import { defineModule } from '../../core/module';

/**
 * App-wide settings. Fields stay optional: readers resolve missing/unknown values to defaults
 * (theme registry, SUPPORTED_LOCALES), so adding `app.SetTheme` / `app.SetLanguage` later is purely additive.
 */
export interface AppState {
  themeId?: string;
  locale?: string;
}

export const appCatalog = {} as const satisfies MessageCatalog;

export const appModule = defineModule<AppState>({
  id: 'app',
  ns: 'app',
  initialState: () => ({}),
  commands: {},
  catalog: appCatalog,
});
