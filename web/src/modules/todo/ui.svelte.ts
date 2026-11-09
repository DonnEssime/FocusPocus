/**
 * Per-window UI state of the to-do list: which item has its "add a sub-task" field open, which
 * item's pop-up is open, and an ongoing drag. None of it changes the vault, so it is not a command
 * and is lost on reload.
 */
export class TodoUi {
  /** Item whose inline "add a sub-task" field is shown. */
  addingTo = $state<string | null>(null);
  /** Item whose notes pop-up is open. */
  openId = $state<string | null>(null);
  /** The item being dragged; it can only be dropped among its siblings. */
  dragging = $state<{ id: string; parentId: string | null } | null>(null);
  /** Where it would land: just before or just after this sibling. */
  dropAt = $state<{ id: string; after: boolean } | null>(null);

  endDrag(): void {
    this.dragging = null;
    this.dropAt = null;
  }
}
