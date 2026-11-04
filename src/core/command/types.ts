import type { MessageParams } from '../i18n/types';

/** Catalog key. Kept as a plain string in the kernel; the composition root types the full catalog. */
export type MessageKey = string;

/**
 * The command envelope as stored on disk (one JSON object per line).
 * Keys are deliberately short: a vault can hold millions of these.
 */
export interface Command<P = unknown> {
  /** `<writer>.<seq base36>`: unique without coordination (see ids.ts). */
  id: string;
  /** Namespaced type, `<module ns>.<Name>` or `core.<Name>`. */
  t: string;
  /** Payload schema version of this command type. */
  v: number;
  /** Epoch ms (UTC), produced by the writer's hybrid clock. */
  at: number;
  /** Ids of commands this one depends on (dependency-aware undo). */
  deps?: string[];
  p: P;
}

export type CommandResult =
  | { ok: true }
  | { ok: false; reason: MessageKey; params?: MessageParams };

export const OK: CommandResult = Object.freeze({ ok: true });

export function fail(reason: MessageKey, params?: MessageParams): CommandResult {
  return params ? { ok: false, reason, params } : { ok: false, reason };
}

/** Structural check for anything read from disk or received from another window. */
export function isCommandShape(value: unknown): value is Command {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  if (typeof c.id !== 'string' || typeof c.t !== 'string') return false;
  if (typeof c.v !== 'number' || !Number.isInteger(c.v) || c.v < 1) return false;
  if (typeof c.at !== 'number' || !Number.isFinite(c.at)) return false;
  if (c.deps !== undefined && !(Array.isArray(c.deps) && c.deps.every((d) => typeof d === 'string'))) {
    return false;
  }
  return true;
}
