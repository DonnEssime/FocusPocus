import type { MessageKey } from './command/types';
import type { MessageCatalog, MessageParams } from './i18n/types';

export type ApplyResult<S> =
  | { ok: true; state: S }
  | { ok: false; reason: MessageKey; params?: MessageParams };

export interface ApplyContext {
  /** Id of the command being applied (useful as a default entity id). */
  id: string;
  /** The command's timestamp: the only notion of "now" an apply function may use. */
  at: number;
}

/**
 * One command type of a module.
 *
 * `apply` must be pure and deterministic, and must not mutate `state`: return a new state
 * object (structural sharing is fine). The kernel keeps references to old states as
 * checkpoints for cheap undo and merge rebuilds.
 */
export interface CommandDef<S, P = unknown> {
  /** Current payload schema version. */
  v: number;
  /** Whether the command appears on its module's undo stack. */
  undoable: boolean;
  /** `upcast[n]` converts a version-n payload to version n+1. */
  upcast?: Record<number, (payload: unknown) => unknown>;
  apply(state: S, payload: P, ctx: ApplyContext): ApplyResult<S>;
}

export interface ModuleDefinition<S = unknown> {
  /** Module id, also the undo scope and the state slice key. */
  id: string;
  /** Command type prefix, e.g. `tt` for `tt.CreateBlock`. */
  ns: string;
  initialState(): S;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  commands: Record<string, CommandDef<S, any>>;
  catalog: MessageCatalog;
}

export function defineModule<S>(definition: ModuleDefinition<S>): ModuleDefinition<S> {
  return definition;
}

export function defineCommand<S, P>(definition: CommandDef<S, P>): CommandDef<S, P> {
  return definition;
}

export function applied<S>(state: S): ApplyResult<S> {
  return { ok: true, state };
}

export function rejected<S>(reason: MessageKey, params?: MessageParams): ApplyResult<S> {
  return params ? { ok: false, reason, params } : { ok: false, reason };
}

export interface ResolvedCommandType {
  module: ModuleDefinition;
  name: string;
  def: CommandDef<unknown>;
}

const RESERVED_NAMESPACES = new Set(['core']);

/** Routes command types to modules by namespace prefix. The kernel never imports modules directly. */
export class ModuleRegistry {
  private readonly byNs = new Map<string, ModuleDefinition>();
  readonly modules: readonly ModuleDefinition[];

  constructor(modules: readonly ModuleDefinition[]) {
    const ids = new Set<string>();
    for (const m of modules) {
      if (RESERVED_NAMESPACES.has(m.ns)) throw new Error(`Module namespace "${m.ns}" is reserved`);
      if (this.byNs.has(m.ns)) throw new Error(`Duplicate module namespace "${m.ns}"`);
      if (ids.has(m.id)) throw new Error(`Duplicate module id "${m.id}"`);
      ids.add(m.id);
      this.byNs.set(m.ns, m);
    }
    this.modules = modules;
  }

  lookup(type: string): ResolvedCommandType | undefined {
    const dot = type.indexOf('.');
    if (dot <= 0) return undefined;
    const module = this.byNs.get(type.slice(0, dot));
    const name = type.slice(dot + 1);
    if (!module || !Object.hasOwn(module.commands, name)) return undefined;
    return { module, name, def: module.commands[name] as CommandDef<unknown> };
  }

  moduleIdFor(type: string): string | undefined {
    const dot = type.indexOf('.');
    if (dot <= 0) return undefined;
    return this.byNs.get(type.slice(0, dot))?.id;
  }

  initialStates(): Map<string, unknown> {
    return new Map(this.modules.map((m) => [m.id, m.initialState()]));
  }
}
