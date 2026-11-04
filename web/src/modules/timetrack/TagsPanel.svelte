<script lang="ts">
  import {
    duplicateTagIds,
    findTagByName,
    liveTags,
    nextTagColor,
    TAG_NAME_MAX,
    timetrackActions,
    type Tag,
    type TimetrackState,
  } from '@focuspocus/modules/timetrack';
  import Msg from '../../i18n/Msg.svelte';
  import { msgText } from '../../i18n/msg';
  import { getSessionStore, getShell } from '../../shell/context';
  import Popover from '../../shell/ui/Popover.svelte';
  import ColorPicker from './ColorPicker.svelte';

  const store = getSessionStore();
  const shell = getShell();
  const tt = $derived(store.moduleState<TimetrackState>('timetrack'));
  const tags = $derived(liveTags(tt));
  const duplicates = $derived(duplicateTagIds(tt));

  let newName = $state('');
  let addError = $state<string | null>(null);

  function add(): void {
    const name = newName.trim();
    if (!name) return;
    if (findTagByName(tt, name)) {
      addError = msgText('timetrack.tag.duplicate', { name });
      return;
    }
    const r = shell.run(timetrackActions.createTag({ name, color: nextTagColor(tt), description: '' }));
    if (r.ok) {
      newName = '';
      addError = null;
    }
  }

  /** Inline rename: empty or duplicate names are refused and the field reverts. */
  function rename(tag: Tag, input: HTMLInputElement): void {
    const name = input.value.trim();
    if (name === tag.name) return;
    if (!name || findTagByName(tt, name, tag.id)) {
      if (name) shell.notify('timetrack.tag.duplicate', { name });
      input.value = tag.name;
      return;
    }
    shell.run(timetrackActions.editTag({ tagId: tag.id, name }));
  }

  function describe(tag: Tag, input: HTMLInputElement): void {
    if (input.value !== tag.description) shell.run(timetrackActions.editTag({ tagId: tag.id, description: input.value }));
  }

  // Colour editing: one shared popover, anchored at the clicked swatch, committing on close.
  let colorPopover: Popover;
  let editing = $state<{ tagId: string; original: string; draft: string } | null>(null);

  function openColor(tag: Tag, anchor: HTMLElement): void {
    editing = { tagId: tag.id, original: tag.color, draft: tag.color };
    colorPopover.show(anchor);
  }

  function commitColor(): void {
    const e = editing;
    editing = null;
    if (e && e.draft !== e.original) shell.run(timetrackActions.editTag({ tagId: e.tagId, color: e.draft }));
  }
</script>

<div class="tags" data-testid="tt-tags">
  {#if tags.length === 0}
    <p class="muted small"><Msg key="timetrack.tag.empty" /></p>
  {/if}
  <ul class="tag-list">
    {#each tags as tag (tag.id)}
      <li class="tag-row" data-testid="tt-tag" data-tag-id={tag.id}>
        <button
          type="button"
          class="swatch"
          data-testid="tt-tag-color"
          aria-label={msgText('timetrack.tag.changeColor', { name: tag.name })}
          style:background={editing?.tagId === tag.id ? editing.draft : tag.color}
          onclick={(e) => openColor(tag, e.currentTarget)}
        ></button>
        <div class="tag-fields">
          <input
            class="tag-name"
            data-testid="tt-tag-name"
            maxlength={TAG_NAME_MAX}
            aria-label={msgText('timetrack.tag.name')}
            value={tag.name}
            onchange={(e) => rename(tag, e.currentTarget)}
            onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <input
            class="tag-description"
            data-testid="tt-tag-description"
            placeholder={msgText('timetrack.tag.descriptionPlaceholder')}
            aria-label={msgText('timetrack.tag.description')}
            value={tag.description}
            onchange={(e) => describe(tag, e.currentTarget)}
            onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          {#if duplicates.has(tag.id)}
            <span class="warning small" data-testid="tt-tag-duplicate"><Msg key="timetrack.tag.duplicateMarker" /></span>
          {/if}
        </div>
        <button
          type="button"
          class="icon"
          data-testid="tt-tag-delete"
          aria-label={msgText('timetrack.tag.delete', { name: tag.name })}
          onclick={() => shell.run(timetrackActions.deleteTag(tag.id))}>✕</button
        >
      </li>
    {/each}
  </ul>
  <form
    class="tag-add"
    onsubmit={(e) => {
      e.preventDefault();
      add();
    }}
  >
    <input
      data-testid="tt-tag-new"
      maxlength={TAG_NAME_MAX}
      placeholder={msgText('timetrack.tag.newPlaceholder')}
      aria-label={msgText('timetrack.tag.newPlaceholder')}
      bind:value={newName}
      oninput={() => (addError = null)}
    />
    <button type="submit" data-testid="tt-tag-add" disabled={!newName.trim()}><Msg key="timetrack.tag.add" /></button>
  </form>
  {#if addError}<p class="error small" data-testid="tt-tag-error">{addError}</p>{/if}
  <Popover id="tt-color-popover" bind:this={colorPopover} onclose={commitColor}>
    {#if editing}
      <ColorPicker value={editing.draft} onchange={(hex) => editing && (editing.draft = hex)} />
    {/if}
  </Popover>
</div>
