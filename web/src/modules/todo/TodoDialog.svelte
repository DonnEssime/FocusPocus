<script lang="ts">
  import { TODO_NOTES_MAX, TODO_TITLE_MAX, todoActions, type TodoItem } from '@focuspocus/modules/todo';
  import Msg from '../../i18n/Msg.svelte';
  import { getShell } from '../../shell/context';
  import Modal from '../../shell/ui/Modal.svelte';

  /** The notes pop-up of one to-do: its title and plain-text notes. One save is one command. */
  let { item, onclose }: { item: TodoItem; onclose: () => void } = $props();

  const shell = getShell();
  // Mounted per opening, so the draft starts from the props once.
  // svelte-ignore state_referenced_locally
  let title = $state(item.title);
  // svelte-ignore state_referenced_locally
  let notes = $state(item.notes);

  function save(): void {
    const t = title.trim();
    if (!t) return;
    const patch = { ...(t !== item.title ? { title: t } : {}), ...(notes !== item.notes ? { notes } : {}) };
    if (Object.keys(patch).length === 0 || shell.run(todoActions.edit({ itemId: item.id, ...patch })).ok) onclose();
  }
</script>

<Modal open={true} titleKey="todo.dialog.title" oncancel={onclose} onsubmit={save} testid="todo-dialog">
  <label class="field">
    <span><Msg key="todo.dialog.name" /></span>
    <input data-testid="todo-dialog-title" maxlength={TODO_TITLE_MAX} bind:value={title} />
  </label>
  <label class="field">
    <span><Msg key="todo.dialog.notes" /></span>
    <!-- svelte-ignore a11y_autofocus -->
    <textarea
      class="todo-notes"
      data-testid="todo-dialog-notes"
      rows="10"
      maxlength={TODO_NOTES_MAX}
      bind:value={notes}
      autofocus
      onkeydown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          save();
        }
      }}
    ></textarea>
    <span class="muted small"><Msg key="todo.dialog.saveHint" /></span>
  </label>
  {#snippet actions()}
    <button type="button" data-testid="todo-dialog-cancel" onclick={onclose}><Msg key="todo.dialog.cancel" /></button>
    <button type="submit" class="primary" data-testid="todo-dialog-save" disabled={!title.trim()}>
      <Msg key="todo.dialog.save" />
    </button>
  {/snippet}
</Modal>
