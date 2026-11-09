import type { MessageParams } from '../i18n/types';
import type { ModuleDefinition, ModuleRegistry, ResolvedCommandType } from '../module';
import { BATCH, UNDO, type BatchPayload, type UndoPayload } from './core-commands';
import { compareKeys, parseCommandId } from './ids';
import { fail, isCommandShape, OK, type Command, type CommandResult, type MessageKey } from './types';

interface Entry {
  cmd: Command;
  writer: string;
  seq: number;
}

interface Checkpoint {
  /** States *before* applying `entries[index]`. */
  index: number;
  states: Map<string, unknown>;
}

type ApplyOutcome =
  | { kind: 'ok'; moduleId: string; state: unknown }
  | { kind: 'rejected'; reason: MessageKey; params?: MessageParams }
  | { kind: 'unknown' }
  | { kind: 'newer' };

export interface RejectedCommand {
  id: string;
  type: string;
  reason: MessageKey;
  params?: MessageParams;
}

export interface RunnerIssues {
  /** Commands that failed validation against the merged state (rejected-on-merge). */
  rejected: RejectedCommand[];
  /** Commands of a type this build does not know (kept, skipped). */
  unknown: number;
  /** Commands with a payload version newer than this build understands. */
  newer: number;
  /** Malformed records dropped during ingest. */
  invalid: number;
}

export interface RunnerOptions {
  checkpointInterval?: number;
  maxCheckpoints?: number;
}

function entryOrder(a: Entry, b: Entry): number {
  return compareKeys(
    { at: a.cmd.at, writer: a.writer, seq: a.seq },
    { at: b.cmd.at, writer: b.writer, seq: b.seq },
  );
}

/**
 * In-memory command kernel. Holds the merged, totally ordered log and the derived module states.
 *
 * - Local commands (`execute`) are validated and applied incrementally.
 * - Commands from other writers (`ingest`) may land anywhere in the order; the runner rebuilds
 *   from the nearest checkpoint before the earliest affected position.
 * - Undo/redo are `core.Undo` commands; the effective log is the log minus suppressed commands.
 *
 * Replay never throws on semantic conflicts: a command that no longer validates is recorded
 * as rejected and skipped.
 */
export class CommandRunner {
  private entries: Entry[] = [];
  private readonly byId = new Map<string, Entry>();
  private indexOf = new Map<string, number>();
  private readonly dependents = new Map<string, string[]>();

  private states: Map<string, unknown>;
  private appliedUpTo = 0;
  private checkpoints: Checkpoint[];

  private suppressed = new Set<string>();
  private undoneUndos = new Set<string>();
  private readonly rejected = new Map<string, { reason: MessageKey; params?: MessageParams }>();
  private readonly unknown = new Set<string>();
  private readonly newer = new Set<string>();
  private invalid = 0;

  private _version = 0;
  private targetCache = new Map<string, { version: number; undo?: string; redo?: string }>();

  private readonly checkpointInterval: number;
  private readonly maxCheckpoints: number;

  constructor(
    private readonly registry: ModuleRegistry,
    options: RunnerOptions = {},
  ) {
    this.checkpointInterval = options.checkpointInterval ?? 256;
    this.maxCheckpoints = Math.max(4, options.maxCheckpoints ?? 64);
    this.states = registry.initialStates();
    this.checkpoints = [{ index: 0, states: new Map(this.states) }];
  }

  // ---------------------------------------------------------------- queries

  /** Increments on every change to log or state. Cheap change detection for UIs. */
  get version(): number {
    return this._version;
  }

  get size(): number {
    return this.entries.length;
  }

  getState<S>(moduleId: string): S {
    if (!this.states.has(moduleId)) throw new Error(`Unknown module "${moduleId}"`);
    return this.states.get(moduleId) as S;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** A command of the merged log by id. */
  get(id: string): Command | undefined {
    return this.byId.get(id)?.cmd;
  }

  /** The merged log in global order, including Undo commands and suppressed ones. */
  commands(): Command[] {
    return this.entries.map((e) => e.cmd);
  }

  commandsBy(writer: string): Command[] {
    return this.entries.filter((e) => e.writer === writer).map((e) => e.cmd);
  }

  maxAt(): number {
    return this.entries.length ? this.entries[this.entries.length - 1]!.cmd.at : 0;
  }

  isSuppressed(id: string): boolean {
    return this.suppressed.has(id);
  }

  hasNewerData(): boolean {
    return this.newer.size > 0;
  }

  issues(): RunnerIssues {
    return {
      rejected: [...this.rejected].map(([id, r]) => ({
        id,
        type: this.byId.get(id)?.cmd.t ?? '?',
        reason: r.reason,
        ...(r.params ? { params: r.params } : {}),
      })),
      unknown: this.unknown.size,
      newer: this.newer.size,
      invalid: this.invalid,
    };
  }

  /** Module id a command belongs to (Undo → its target's module). */
  scopeOf(id: string): string | undefined {
    const entry = this.byId.get(id);
    return entry ? this.scopeOfCommand(entry.cmd) : undefined;
  }

  /** The command an Undo in `scope` would revert right now, if any. */
  undoTarget(scope: string): string | undefined {
    return this.targets(scope).undo;
  }

  /** The Undo command a Redo in `scope` would revert right now, if any. */
  redoTarget(scope: string): string | undefined {
    return this.targets(scope).redo;
  }

  // ---------------------------------------------------------------- mutations

  /**
   * Execute a locally created command. It must sort after everything already in the log
   * (guaranteed by the hybrid clock). A rejected command is not added.
   */
  execute(cmd: Command): CommandResult {
    const parsed = isCommandShape(cmd) ? parseCommandId(cmd.id) : null;
    if (!parsed) return fail('core.invalidCommand');
    if (this.byId.has(cmd.id)) return fail('core.duplicateCommandId');
    for (const dep of cmd.deps ?? []) {
      if (!this.byId.has(dep)) return fail('core.missingDependency', { dep });
    }
    const entry: Entry = { cmd, writer: parsed.writer, seq: parsed.seq };
    const last = this.entries[this.entries.length - 1];
    if (last && entryOrder(last, entry) >= 0) return fail('core.clockOutOfOrder');

    if (cmd.t === UNDO) {
      const target = (cmd.p as UndoPayload | undefined)?.target;
      const scope = typeof target === 'string' ? this.scopeOf(target) : undefined;
      if (!scope || (target !== this.undoTarget(scope) && target !== this.redoTarget(scope))) {
        return fail('core.invalidUndoTarget');
      }
      this.append(entry);
      this.refresh(this.entries.length);
      return OK;
    }

    if (this.appliedUpTo !== this.entries.length) this.replayFrom(this.appliedUpTo);
    const states = new Map(this.states);
    const outcome = this.applyCommand(states, cmd);
    if (outcome.kind === 'unknown' || outcome.kind === 'newer') {
      return fail('core.unknownCommand', { type: cmd.t });
    }
    if (outcome.kind === 'rejected') return fail(outcome.reason, outcome.params);
    states.set(outcome.moduleId, outcome.state);
    this.append(entry);
    this.states = states;
    this.appliedUpTo = this.entries.length;
    this.afterApply(this.entries.length - 1, states);
    this.bump();
    return OK;
  }

  /**
   * Merge commands from disk or other writers. Duplicates (by id) and malformed records are
   * ignored. Returns how many new commands were added.
   */
  ingest(commands: Iterable<Command>): number {
    const fresh: Entry[] = [];
    const seen = new Set<string>();
    for (const cmd of commands) {
      const parsed = isCommandShape(cmd) ? parseCommandId(cmd.id) : null;
      if (!parsed) {
        this.invalid++;
        continue;
      }
      if (this.byId.has(cmd.id) || seen.has(cmd.id)) continue;
      seen.add(cmd.id);
      fresh.push({ cmd, writer: parsed.writer, seq: parsed.seq });
    }
    if (fresh.length === 0) return 0;
    fresh.sort(entryOrder);

    const last = this.entries[this.entries.length - 1];
    let earliest: number;
    if (!last || entryOrder(last, fresh[0]!) < 0) {
      earliest = this.entries.length;
      for (const e of fresh) this.append(e);
    } else {
      this.entries = mergeSorted(this.entries, fresh);
      for (const e of fresh) this.registerEntry(e);
      this.reindex();
      earliest = this.indexOf.get(fresh[0]!.cmd.id)!;
    }
    this.refresh(earliest);
    return fresh.length;
  }

  // ---------------------------------------------------------------- internals

  private bump(): void {
    this._version++;
  }

  private registerEntry(e: Entry): void {
    this.byId.set(e.cmd.id, e);
    for (const dep of e.cmd.deps ?? []) {
      const list = this.dependents.get(dep);
      if (list) list.push(e.cmd.id);
      else this.dependents.set(dep, [e.cmd.id]);
    }
  }

  private append(e: Entry): void {
    this.entries.push(e);
    this.registerEntry(e);
    this.indexOf.set(e.cmd.id, this.entries.length - 1);
  }

  private reindex(): void {
    this.indexOf = new Map(this.entries.map((e, i) => [e.cmd.id, i]));
  }

  /** Recompute suppression and replay from the earliest position whose outcome may differ. */
  private refresh(earliest: number): void {
    const before = this.suppressed;
    const { suppressed, undone } = this.computeSuppression();
    this.suppressed = suppressed;
    this.undoneUndos = undone;
    let start = Math.min(earliest, this.appliedUpTo);
    for (const id of before) if (!suppressed.has(id)) start = Math.min(start, this.indexOf.get(id) ?? start);
    for (const id of suppressed) if (!before.has(id)) start = Math.min(start, this.indexOf.get(id) ?? start);
    if (start < this.entries.length) this.replayFrom(start);
    this.bump();
  }

  private replayFrom(index: number): void {
    let start: number;
    let states: Map<string, unknown>;
    if (index >= this.appliedUpTo) {
      start = this.appliedUpTo;
      states = new Map(this.states);
    } else {
      let ci = this.checkpoints.length - 1;
      while (ci > 0 && this.checkpoints[ci]!.index > index) ci--;
      const cp = this.checkpoints[ci]!;
      this.checkpoints.length = ci + 1;
      start = cp.index;
      states = new Map(cp.states);
    }
    for (let i = start; i < this.entries.length; i++) {
      this.applyAt(i, states);
      this.afterApply(i, states);
    }
    this.states = states;
    this.appliedUpTo = this.entries.length;
  }

  private applyAt(i: number, states: Map<string, unknown>): void {
    const { cmd } = this.entries[i]!;
    const id = cmd.id;
    this.rejected.delete(id);
    this.unknown.delete(id);
    this.newer.delete(id);
    if (cmd.t === UNDO || this.suppressed.has(id)) return;
    const outcome = this.applyCommand(states, cmd);
    switch (outcome.kind) {
      case 'ok':
        states.set(outcome.moduleId, outcome.state);
        break;
      case 'rejected':
        this.rejected.set(id, outcome.params ? { reason: outcome.reason, params: outcome.params } : { reason: outcome.reason });
        break;
      case 'unknown':
        this.unknown.add(id);
        break;
      case 'newer':
        this.newer.add(id);
        break;
    }
  }

  private afterApply(i: number, states: Map<string, unknown>): void {
    const next = i + 1;
    if (next % this.checkpointInterval !== 0) return;
    const last = this.checkpoints[this.checkpoints.length - 1]!;
    if (last.index >= next) return;
    this.checkpoints.push({ index: next, states: new Map(states) });
    if (this.checkpoints.length > this.maxCheckpoints) this.thinCheckpoints();
  }

  /** Drop every other checkpoint in the older half: recent history stays dense, old history sparse. */
  private thinCheckpoints(): void {
    const cps = this.checkpoints;
    const half = Math.floor(cps.length / 2);
    const kept: Checkpoint[] = [cps[0]!];
    for (let i = 1; i < half; i++) if (i % 2 === 0) kept.push(cps[i]!);
    for (let i = half; i < cps.length; i++) kept.push(cps[i]!);
    this.checkpoints = kept;
  }

  private resolve(
    t: string,
    v: number,
    p: unknown,
  ): { kind: 'ok'; resolved: ResolvedCommandType; payload: unknown } | { kind: 'unknown' } | { kind: 'newer' } {
    const resolved = this.registry.lookup(t);
    if (!resolved) return { kind: 'unknown' };
    if (v > resolved.def.v) return { kind: 'newer' };
    let payload = p;
    for (let from = v; from < resolved.def.v; from++) {
      const up = resolved.def.upcast?.[from];
      if (up) payload = up(payload);
    }
    return { kind: 'ok', resolved, payload };
  }

  private applyCommand(states: Map<string, unknown>, cmd: Command): ApplyOutcome {
    const ctx = { id: cmd.id, at: cmd.at };
    if (cmd.t === BATCH) {
      const subs = (cmd.p as BatchPayload | undefined)?.cmds;
      if (!Array.isArray(subs) || subs.length === 0) return { kind: 'rejected', reason: 'core.batchEmpty' };
      let module: ModuleDefinition | undefined;
      let state: unknown;
      for (const sub of subs) {
        const r = this.resolve(sub.t, sub.v, sub.p);
        if (r.kind !== 'ok') return r;
        if (!module) {
          module = r.resolved.module;
          state = states.get(module.id);
        } else if (r.resolved.module !== module) {
          return { kind: 'rejected', reason: 'core.batchMixedScopes' };
        }
        const res = r.resolved.def.apply(state, r.payload, ctx);
        if (!res.ok) return { kind: 'rejected', reason: res.reason, ...(res.params ? { params: res.params } : {}) };
        state = res.state;
      }
      return { kind: 'ok', moduleId: module!.id, state };
    }
    const r = this.resolve(cmd.t, cmd.v, cmd.p);
    if (r.kind !== 'ok') return r;
    const moduleId = r.resolved.module.id;
    const res = r.resolved.def.apply(states.get(moduleId), r.payload, ctx);
    return res.ok
      ? { kind: 'ok', moduleId, state: res.state }
      : { kind: 'rejected', reason: res.reason, ...(res.params ? { params: res.params } : {}) };
  }

  /**
   * Walk Undo commands in order. Undoing a normal command suppresses it and, transitively,
   * everything that depends on it (its "victims"). Undoing an Undo restores that Undo's victims.
   */
  private computeSuppression(): { suppressed: Set<string>; undone: Set<string> } {
    const suppressed = new Set<string>();
    const undone = new Set<string>();
    const victims = new Map<string, string[]>();
    for (const { cmd } of this.entries) {
      if (cmd.t !== UNDO) continue;
      const target = (cmd.p as UndoPayload | undefined)?.target;
      const targetEntry = typeof target === 'string' ? this.byId.get(target) : undefined;
      if (!targetEntry) continue;
      if (targetEntry.cmd.t === UNDO) {
        for (const id of victims.get(target!) ?? []) suppressed.delete(id);
        victims.delete(target!);
        undone.add(target!);
        continue;
      }
      const added: string[] = [];
      const stack = [target!];
      while (stack.length) {
        const id = stack.pop()!;
        if (suppressed.has(id)) continue;
        suppressed.add(id);
        added.push(id);
        for (const d of this.dependents.get(id) ?? []) stack.push(d);
      }
      victims.set(cmd.id, added);
    }
    return { suppressed, undone };
  }

  private scopeOfCommand(cmd: Command, depth = 0): string | undefined {
    if (cmd.t === UNDO) {
      const target = (cmd.p as UndoPayload | undefined)?.target;
      const entry = typeof target === 'string' ? this.byId.get(target) : undefined;
      return entry && depth < 16 ? this.scopeOfCommand(entry.cmd, depth + 1) : undefined;
    }
    if (cmd.t === BATCH) {
      const first = (cmd.p as BatchPayload | undefined)?.cmds?.[0];
      return first ? this.registry.moduleIdFor(first.t) : undefined;
    }
    return this.registry.moduleIdFor(cmd.t);
  }

  private isUndoable(cmd: Command): boolean {
    if (cmd.t === UNDO) return false;
    if (cmd.t === BATCH) {
      const subs = (cmd.p as BatchPayload | undefined)?.cmds;
      return Array.isArray(subs) && subs.length > 0 && subs.every((s) => this.registry.lookup(s.t)?.def.undoable === true);
    }
    return this.registry.lookup(cmd.t)?.def.undoable === true;
  }

  /** Applied and in effect: not undone, not rejected, understood by this build. */
  private isActive(id: string): boolean {
    return !this.suppressed.has(id) && !this.rejected.has(id) && !this.unknown.has(id) && !this.newer.has(id);
  }

  private targets(scope: string): { undo?: string; redo?: string } {
    const cached = this.targetCache.get(scope);
    if (cached && cached.version === this._version) return cached;
    const computed = { version: this._version, undo: this.findUndoTarget(scope), redo: this.findRedoTarget(scope) };
    this.targetCache.set(scope, computed);
    return computed;
  }

  private findUndoTarget(scope: string): string | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const { cmd } = this.entries[i]!;
      if (cmd.t === UNDO || !this.isActive(cmd.id)) continue;
      if (this.scopeOfCommand(cmd) !== scope || !this.isUndoable(cmd)) continue;
      for (const d of this.dependents.get(cmd.id) ?? []) {
        if (this.isActive(d)) return undefined;
      }
      return cmd.id;
    }
    return undefined;
  }

  private findRedoTarget(scope: string): string | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const { cmd } = this.entries[i]!;
      if (this.scopeOfCommand(cmd) !== scope) continue;
      if (cmd.t === UNDO) {
        if (this.undoneUndos.has(cmd.id)) continue;
        const target = this.byId.get((cmd.p as UndoPayload).target);
        if (!target || target.cmd.t === UNDO) continue;
        return cmd.id;
      }
      // A newer, still-active undoable action discards the redo branch.
      if (this.isActive(cmd.id) && this.isUndoable(cmd)) return undefined;
    }
    return undefined;
  }
}

function mergeSorted(a: Entry[], b: Entry[]): Entry[] {
  const out: Entry[] = new Array(a.length + b.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.length && j < b.length) out[k++] = entryOrder(a[i]!, b[j]!) <= 0 ? a[i++]! : b[j++]!;
  while (i < a.length) out[k++] = a[i++]!;
  while (j < b.length) out[k++] = b[j++]!;
  return out;
}
