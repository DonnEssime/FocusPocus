<script lang="ts">
  import { TODO_TITLE_MAX, todoActions } from '@focuspocus/modules/todo';
  import Msg from '../../i18n/Msg.svelte';
  import { msgText } from '../../i18n/msg';
  import { getShell } from '../../shell/context';

  /**
   * A field that adds to-dos. Enter adds one and keeps the field open for the next, so a list can be
   * typed in one go. The inline (sub-task) variant closes on Esc or when it loses focus, adding what
   * was typed so nothing is lost.
   */
  let { parentId, onclose }: { parentId: string | null; onclose?: () => void } = $props();

  const shell = getShell();
  const inline = $derived(parentId !== null);
  let value = $state('');
  let input: HTMLInputElement;

  // `autofocus` does not apply to fields mounted later, so the inline field focuses itself.
  $effect(() => {
    if (inline) input.focus();
  });

  function submit(): void {
    const title = value.trim();
    if (!title) return;
    if (shell.run(todoActions.create({ parentId, title })).ok) value = '';
  }
</script>

<form
  class="todo-add"
  class:inline
  onsubmit={(e) => {
    e.preventDefault();
    submit();
  }}
>
  <input
    bind:this={input}
    data-testid={inline ? 'todo-new-child' : 'todo-new'}
    maxlength={TODO_TITLE_MAX}
    placeholder={msgText(inline ? 'todo.newChildPlaceholder' : 'todo.newPlaceholder')}
    aria-label={msgText(inline ? 'todo.newChildPlaceholder' : 'todo.newPlaceholder')}
    bind:value
    onkeydown={(e) => {
      if (e.key === 'Escape' && onclose) {
        e.preventDefault();
        value = '';
        onclose();
      }
    }}
    onblur={() => {
      if (!onclose) return;
      submit();
      onclose();
    }}
  />
  {#if !inline}
    <button type="submit" data-testid="todo-add" disabled={!value.trim()}><Msg key="todo.add" /></button>
  {/if}
</form>
