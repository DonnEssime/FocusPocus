import { HybridClock } from './command/clock';
import { BATCH, CORE_COMMAND_VERSION, UNDO, type BatchPayload, type UndoPayload } from './command/core-commands';
import { makeCommandId, newWriterId } from './command/ids';
import { CommandRunner, type RunnerOptions } from './command/runner';
import { fail, type Command, type CommandResult } from './command/types';
import { ModuleRegistry, type ModuleDefinition } from './module';

/** What UI code dispatches. The session turns it into a full command envelope. */
export interface Action<P = unknown> {
  t: string;
  p: P;
  deps?: string[];
}

export type ReadOnlyReason = 'newerFormat' | 'newerData';

export interface SessionOptions extends RunnerOptions {
  modules: readonly ModuleDefinition<any>[];
  writerId?: string;
  now?: () => number;
}

/**
 * One writer's view of the command log: builds envelopes (ids, hybrid timestamps), executes
 * them, provides per-module undo/redo, and tells listeners about changes. No I/O here.
 */
export class Session {
  readonly runner: CommandRunner;
  readonly registry: ModuleRegistry;
  readonly writerId: string;
  private seq = 0;
  private readonly clock: HybridClock;
  private readonly listeners = new Set<() => void>();
  private readonly commitHooks = new Set<(cmd: Command) => void>();
  private _readOnly: ReadOnlyReason | null = null;

  constructor(options: SessionOptions) {
    this.registry = new ModuleRegistry(options.modules as readonly ModuleDefinition[]);
    this.runner = new CommandRunner(this.registry, options);
    this.writerId = options.writerId ?? newWriterId();
    this.clock = new HybridClock(options.now);
  }

  get readOnly(): ReadOnlyReason | null {
    return this._readOnly;
  }

  setReadOnly(reason: ReadOnlyReason): void {
    if (this._readOnly) return;
    this._readOnly = reason;
    this.notify();
  }

  getState<S>(moduleId: string): S {
    return this.runner.getState<S>(moduleId);
  }

  dispatch(action: Action): CommandResult {
    const def = this.registry.lookup(action.t);
    if (!def) return fail('core.unknownCommand', { type: action.t });
    return this.commit(action.t, def.def.v, action.p, action.deps);
  }

  /** Several actions of one module, applied atomically and undone as one step. */
  dispatchBatch(actions: Action[]): CommandResult {
    if (actions.length === 0) return fail('core.batchEmpty');
    const cmds: BatchPayload['cmds'] = [];
    const deps = new Set<string>();
    for (const a of actions) {
      const def = this.registry.lookup(a.t);
      if (!def) return fail('core.unknownCommand', { type: a.t });
      cmds.push({ t: a.t, v: def.def.v, p: a.p });
      for (const d of a.deps ?? []) deps.add(d);
    }
    return this.commit(BATCH, CORE_COMMAND_VERSION, { cmds } satisfies BatchPayload, [...deps]);
  }

  canUndo(scope: string): boolean {
    return !this._readOnly && this.runner.undoTarget(scope) !== undefined;
  }

  canRedo(scope: string): boolean {
    return !this._readOnly && this.runner.redoTarget(scope) !== undefined;
  }

  undo(scope: string): CommandResult {
    const target = this.runner.undoTarget(scope);
    if (!target) return fail('core.nothingToUndo');
    return this.commit(UNDO, CORE_COMMAND_VERSION, { target } satisfies UndoPayload);
  }

  redo(scope: string): CommandResult {
    const target = this.runner.redoTarget(scope);
    if (!target) return fail('core.nothingToRedo');
    return this.commit(UNDO, CORE_COMMAND_VERSION, { target } satisfies UndoPayload);
  }

  /** Merge commands from disk or other writers. */
  ingest(commands: Iterable<Command>): number {
    const list = Array.isArray(commands) ? (commands as Command[]) : [...commands];
    for (const c of list) if (typeof c?.at === 'number') this.clock.observe(c.at);
    const added = this.runner.ingest(list);
    if (this.runner.hasNewerData()) this.setReadOnly('newerData');
    if (added > 0) this.notify();
    return added;
  }

  /** Commands written by this session's writer (for handing to a newly opened window). */
  ownCommands(): Command[] {
    return this.runner.commandsBy(this.writerId);
  }

  /** Called with every successfully executed local command (persistence, broadcast). */
  onCommit(hook: (cmd: Command) => void): () => void {
    this.commitHooks.add(hook);
    return () => this.commitHooks.delete(hook);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const l of this.listeners) l();
  }

  private commit(t: string, v: number, p: unknown, deps?: string[]): CommandResult {
    if (this._readOnly) return fail('core.readOnly');
    this.clock.observe(this.runner.maxAt());
    const cmd: Command = { id: makeCommandId(this.writerId, ++this.seq), t, v, at: this.clock.next(), p };
    if (deps && deps.length) cmd.deps = deps;
    const result = this.runner.execute(cmd);
    if (!result.ok) return result;
    for (const hook of this.commitHooks) hook(cmd);
    this.notify();
    return result;
  }
}
