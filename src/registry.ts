/**
 * Composition root: the one place that knows every module. The kernel (src/core) never imports
 * modules, and modules never import each other.
 */
import { coreCatalog } from './core/i18n/catalog-core';
import { shellCatalog } from './core/i18n/catalog-shell';
import type { MessageCatalog } from './core/i18n/types';
import type { ModuleDefinition } from './core/module';
import { appModule, appCatalog } from './modules/app';
import { focusModule } from './modules/focus';
import { focusCatalog } from './modules/focus/catalog';
import { timetrackModule } from './modules/timetrack';
import { timetrackCatalog } from './modules/timetrack/catalog';
import { todoModule } from './modules/todo';
import { todoCatalog } from './modules/todo/catalog';

export const MODULES: readonly ModuleDefinition<any>[] = [appModule, timetrackModule, focusModule, todoModule];

/** Separate parts, so a test can verify that no key is defined twice. */
export const CATALOG_PARTS: readonly MessageCatalog[] = [coreCatalog, shellCatalog, appCatalog, timetrackCatalog, focusCatalog, todoCatalog];

export const catalog = {
  ...coreCatalog,
  ...shellCatalog,
  ...appCatalog,
  ...timetrackCatalog,
  ...focusCatalog,
  ...todoCatalog,
} as const satisfies MessageCatalog;

export type AppMessageKey = keyof typeof catalog;
