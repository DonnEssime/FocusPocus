import type { CommandResult } from '@focuspocus/core/command/types';
import type { MessageParams } from '@focuspocus/core/i18n/types';
import type { Action } from '@focuspocus/core/session';
import { getContext, setContext } from 'svelte';
import type { SessionStore } from './sessionStore.svelte';

export interface ShellApi {
  /** Mark the module whose panel the user is interacting with (undo/redo scope). */
  setActiveModule(moduleId: string): void;
  /** Dispatch an action; failures are shown as a toast. */
  run(action: Action): CommandResult;
  /** Show a short message (a catalog key) as a toast. */
  notify(key: string, params?: MessageParams): void;
  /** Undo / redo the latest step of one module; failures are shown as a toast. */
  undo(moduleId: string): void;
  redo(moduleId: string): void;
}

const SESSION = Symbol('session');
const SHELL = Symbol('shell');

export function setSessionStore(store: SessionStore): void {
  setContext(SESSION, store);
}

export function getSessionStore(): SessionStore {
  return getContext<SessionStore>(SESSION);
}

export function setShell(api: ShellApi): void {
  setContext(SHELL, api);
}

export function getShell(): ShellApi {
  return getContext<ShellApi>(SHELL);
}
