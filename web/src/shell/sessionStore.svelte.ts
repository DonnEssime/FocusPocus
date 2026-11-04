import type { CommandResult } from '@focuspocus/core/command/types';
import type { Action } from '@focuspocus/core/session';
import type { VaultSession, VaultSessionStatus } from '@focuspocus/core/vault/vault-session';

/** Svelte-reactive facade over a VaultSession: reading through it re-runs on every change. */
export class SessionStore {
  version = $state(0);
  status = $state<VaultSessionStatus>(null!);
  private readonly unsubscribe: () => void;

  constructor(readonly vs: VaultSession) {
    this.status = vs.status;
    this.unsubscribe = vs.subscribe(() => {
      this.version++;
      this.status = vs.status;
    });
  }

  moduleState<S>(moduleId: string): S {
    void this.version;
    return this.vs.session.getState<S>(moduleId);
  }

  canUndo(scope: string): boolean {
    void this.version;
    return this.vs.session.canUndo(scope);
  }

  canRedo(scope: string): boolean {
    void this.version;
    return this.vs.session.canRedo(scope);
  }

  dispatch(action: Action): CommandResult {
    return this.vs.session.dispatch(action);
  }

  dispose(): void {
    this.unsubscribe();
  }
}
