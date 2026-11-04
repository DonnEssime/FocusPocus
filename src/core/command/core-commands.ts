/** Kernel-level command types (not owned by any module). */

export const UNDO = 'core.Undo';
export const BATCH = 'core.Batch';
export const CORE_COMMAND_VERSION = 1;

/** Undo `target`. Targeting an earlier Undo reverts that undo, which is how redo works. */
export interface UndoPayload {
  target: string;
}

/** Several commands of one module applied atomically and undone as one step. */
export interface BatchPayload {
  cmds: Array<{ t: string; v: number; p: unknown }>;
}
