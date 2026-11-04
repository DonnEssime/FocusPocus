import type { CommandResult } from '@focuspocus/core/command/types';
import type { Action } from '@focuspocus/core/session';
import { getContext, setContext } from 'svelte';
import type { SessionStore } from './sessionStore.svelte';

export interface ShellApi {
  /** Mark the module whose panel the user is interacting with (undo/redo scope). */
  setActiveModule(moduleId: string): void;
  /** Dispatch an action; failures are shown as a toast. */
  run(action: Action): CommandResult;
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
