import type { Command, CommandResult } from '@focuspocus/core/command/types';
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
  /**
   * Called just before an undo or redo in `moduleId` with the action it reverts or re-applies
   * (never the Undo command itself). A returned function runs once it succeeded, so a module can
   * compare before and after, e.g. to bring the changed item into view. Returns an unsubscribe.
   */
  onUndoRedo(moduleId: string, listener: UndoRedoListener): () => void;
}

export type UndoRedoListener = (subject: Command) => void | (() => void);

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
