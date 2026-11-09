<script lang="ts">
  import {
    childrenOf,
    descendantCount,
    reorderTarget,
    todoActions,
    type TodoItem,
    type TodoState,
  } from '@focuspocus/modules/todo';
  import { tick } from 'svelte';
  import { msgText } from '../../i18n/msg';
  import { getShell } from '../../shell/context';
  import TodoAdd from './TodoAdd.svelte';
  import TodoNode from './TodoNode.svelte';
  import type { TodoUi } from './ui.svelte';

  /** One to-do and, recursively, its children. */
  let { item, todos, ui }: { item: TodoItem; todos: TodoState; ui: TodoUi } = $props();

  const shell = getShell();
  const children = $derived(childrenOf(todos, item.id));
  const hasChildren = $derived(children.length > 0);
  const expanded = $derived(hasChildren && !item.collapsed);
  const adding = $derived(ui.addingTo === item.id);
  const p = $derived({ title: item.title });
  const dropHere = $derived(ui.dropAt?.id === item.id ? ui.dropAt : null);

  function startAdding(): void {
    if (item.collapsed) shell.run(todoActions.setCollapsed(item.id, false));
    ui.addingTo = item.id;
  }

  /** Moves `itemId` before/after its sibling `targetId`, when that changes anything. */
  function moveNextTo(itemId: string, targetId: string, after: boolean): boolean {
    const beforeId = reorderTarget(todos, itemId, targetId, after);
    return beforeId !== undefined && shell.run(todoActions.reorder(itemId, beforeId)).ok;
  }

  /** Drop target only for a sibling of the dragged item; the half of the row picks before or after. */
  function onDragOver(e: DragEvent & { currentTarget: HTMLElement }): void {
    const d = ui.dragging;
    if (!d || d.id === item.id || d.parentId !== item.parentId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const box = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    if (dropHere?.after !== after) ui.dropAt = { id: item.id, after };
  }

  function onDrop(e: DragEvent): void {
    const d = ui.dragging;
    const at = ui.dropAt;
    ui.endDrag();
    if (!d || !at) return;
    e.preventDefault();
    moveNextTo(d.id, at.id, at.after);
  }

  /** Alt+↑/↓ moves the item past its previous/next sibling and keeps the keyboard focus on it. */
  async function onKeydown(e: KeyboardEvent): Promise<void> {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const siblings = childrenOf(todos, item.parentId);
    const i = siblings.findIndex((s) => s.id === item.id);
    const target = siblings[e.key === 'ArrowUp' ? i - 1 : i + 1];
    const focused = document.activeElement as HTMLElement | null;
    const testid = focused?.dataset.testid;
    if (!target || !moveNextTo(item.id, target.id, e.key === 'ArrowDown')) return;
    await tick();
    document.querySelector<HTMLElement>(`[data-todo-id="${item.id}"] > .todo-row [data-testid="${testid ?? 'todo-title'}"]`)?.focus();
  }
</script>

<li class="todo" class:done={item.done} data-testid="todo-item" data-todo-id={item.id}>
  <!-- svelte-ignore a11y_no_static_element_interactions (the buttons inside are the controls; this adds drag and Alt+arrows) -->
  <div
    class="todo-row"
    class:dragging={ui.dragging?.id === item.id}
    class:drop-before={dropHere && !dropHere.after}
    class:drop-after={dropHere?.after}
    draggable="true"
    title={msgText('todo.moveHint')}
    ondragstart={(e) => {
      ui.dragging = { id: item.id, parentId: item.parentId };
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.title);
      }
    }}
    ondragover={onDragOver}
    ondragleave={(e) => {
      if (dropHere && !e.currentTarget.contains(e.relatedTarget as Node | null)) ui.dropAt = null;
    }}
    ondrop={onDrop}
    ondragend={() => ui.endDrag()}
    onkeydown={onKeydown}
  >
    {#if hasChildren}
      <button
        type="button"
        class="todo-icon todo-twisty"
        data-testid="todo-toggle"
        aria-expanded={expanded}
        aria-label={msgText(expanded ? 'todo.collapse' : 'todo.expand', p)}
        onclick={() => shell.run(todoActions.setCollapsed(item.id, !item.collapsed))}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
      </button>
    {:else}
      <span class="todo-twisty-spacer"></span>
    {/if}

    <button
      type="button"
      class="todo-title"
      data-testid="todo-title"
      aria-label={msgText('todo.open', p)}
      onclick={() => (ui.openId = item.id)}
    >
      <span class="todo-title-text">{item.title}</span>
      {#if item.notes.trim()}
        <svg class="todo-notes-mark" data-testid="todo-has-notes" viewBox="0 0 16 16" role="img">
          <title>{msgText('todo.hasNotes')}</title>
          <path d="M3 4h10M3 8h10M3 12h6" />
        </svg>
      {/if}
      {#if hasChildren && item.collapsed}
        <span class="todo-hidden muted small">{msgText('todo.hiddenCount', { count: descendantCount(todos, item.id) })}</span>
      {/if}
    </button>

    <div class="todo-actions">
      <button type="button" class="todo-icon" data-testid="todo-add-child" aria-label={msgText('todo.addChild', p)} title={msgText('todo.addChild', p)} onclick={startAdding}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
      </button>
      <button
        type="button"
        class="todo-icon todo-check"
        data-testid="todo-done"
        aria-pressed={item.done}
        aria-label={msgText(item.done ? 'todo.markOpen' : 'todo.markDone', p)}
        title={msgText(item.done ? 'todo.markOpen' : 'todo.markDone', p)}
        onclick={() => shell.run(todoActions.setDone(item.id, !item.done))}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" /></svg>
      </button>
      <button
        type="button"
        class="todo-icon todo-delete"
        data-testid="todo-delete"
        aria-label={msgText('todo.delete', p)}
        title={msgText('todo.delete', p)}
        onclick={() => shell.run(todoActions.delete(item.id))}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.5h6.6l.7-8.5M6.8 7v3.8M9.2 7v3.8" />
        </svg>
      </button>
    </div>
  </div>

  {#if expanded || adding}
    <ul class="todo-list todo-children">
      <!-- New sub-tasks go first, so the field sits where they appear. -->
      {#if adding}
        <li class="todo-add-row">
          <TodoAdd parentId={item.id} onclose={() => ui.addingTo === item.id && (ui.addingTo = null)} />
        </li>
      {/if}
      {#if expanded}
        {#each children as child (child.id)}
          <TodoNode item={child} {todos} {ui} />
        {/each}
      {/if}
    </ul>
  {/if}
</li>
