<script lang="ts">
  import { childrenOf, collapsedAround, todoActions, type TodoState } from '@focuspocus/modules/todo';
  import { onMount } from 'svelte';
  import Msg from '../../i18n/Msg.svelte';
  import { getSessionStore, getShell } from '../../shell/context';
  import TodoAdd from './TodoAdd.svelte';
  import TodoDialog from './TodoDialog.svelte';
  import TodoNode from './TodoNode.svelte';
  import { TodoUi } from './ui.svelte';
  import './todo.css';

  const store = getSessionStore();
  const shell = getShell();
  const todos = $derived(store.moduleState<TodoState>('todo'));
  const roots = $derived(childrenOf(todos, null));
  const ui = new TodoUi();
  // Closes by itself when the item disappears (deleted here, in another window, or undone).
  const openItem = $derived(ui.openId ? todos.items[ui.openId] : undefined);

  // An undo or redo that changes a hidden item opens just the collapsed parents hiding it.
  onMount(() =>
    shell.onUndoRedo('todo', (subject) => {
      const before = store.moduleState<TodoState>('todo');
      return () => {
        for (const id of collapsedAround(subject, before, store.moduleState<TodoState>('todo'))) {
          shell.run(todoActions.setCollapsed(id, false));
        }
      };
    }),
  );
</script>

<div class="todos" data-testid="todo-panel">
  <!-- New to-dos go to the top, so the field sits above the list. -->
  <TodoAdd parentId={null} />
  {#if roots.length === 0}
    <p class="muted small" data-testid="todo-empty"><Msg key="todo.empty" /></p>
  {:else}
    <ul class="todo-list todo-roots">
      {#each roots as item (item.id)}
        <TodoNode {item} {todos} {ui} />
      {/each}
    </ul>
  {/if}
  {#if openItem}
    {#key openItem.id}
      <TodoDialog item={openItem} onclose={() => (ui.openId = null)} />
    {/key}
  {/if}
</div>
