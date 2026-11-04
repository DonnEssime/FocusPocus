<script lang="ts">
  import { liveTags, TITLE_MAX, timetrackActions, type Block, type TimetrackState } from '@focuspocus/modules/timetrack';
  import { getLocale } from '../../i18n/locale.svelte';
  import Msg from '../../i18n/Msg.svelte';
  import { msgText } from '../../i18n/msg';
  import { getShell } from '../../shell/context';
  import Modal from '../../shell/ui/Modal.svelte';
  import { displayTitle } from './blockTitle';
  import { formatTime } from './format';
  import type { BlockDialogMode } from './ui.svelte';

  let {
    mode,
    tt,
    zone,
    onclose,
  }: { mode: BlockDialogMode; tt: TimetrackState; zone: string; onclose: () => void } = $props();

  const shell = getShell();
  // The dialog is mounted per opening, so the draft starts from the props once.
  // svelte-ignore state_referenced_locally
  const original = mode.kind === 'edit' ? mode.block : null;
  let title = $state(original?.title ?? '');
  let tagIds = $state<string[]>(original ? [...original.tagIds] : []);
  const tags = $derived(liveTags(tt));

  const titleKey = $derived(
    mode.kind === 'edit' ? 'timetrack.dialog.editTitle' : mode.kind === 'start' ? 'timetrack.dialog.startTitle' : 'timetrack.dialog.createTitle',
  );

  const when = $derived.by(() => {
    const locale = getLocale();
    if (mode.kind === 'start') return msgText('timetrack.dialog.startsAt', { time: formatTime(mode.startMs, zone, locale) });
    const start = mode.kind === 'edit' ? mode.block.startMs : mode.startMs;
    const end = mode.kind === 'edit' ? mode.block.endMs : mode.endMs;
    return `${formatTime(start, zone, locale)}–${end === null ? msgText('timetrack.block.now') : formatTime(end, zone, locale)}`;
  });

  function toggle(id: string): void {
    tagIds = tagIds.includes(id) ? tagIds.filter((t) => t !== id) : [...tagIds, id];
  }

  /** Deleted tags stay on a block (hidden) unless the user changes its tags. */
  function sameTags(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((x) => b.includes(x));
  }

  function save(): void {
    const live = new Set(tags.map((t) => t.id));
    const chosen = tagIds.filter((id) => live.has(id));
    let ok = true;
    if (mode.kind === 'create') {
      ok = shell.run(timetrackActions.createBlock({ startMs: mode.startMs, endMs: mode.endMs, title, tagIds: chosen })).ok;
    } else if (mode.kind === 'start') {
      ok = shell.run(timetrackActions.startTracking({ startMs: mode.startMs, title, tagIds: chosen })).ok;
    } else {
      const b = mode.block;
      const liveBefore = b.tagIds.filter((id) => live.has(id));
      const patch = {
        ...(title !== b.title ? { title } : {}),
        ...(!sameTags(chosen, liveBefore) ? { tagIds: chosen } : {}),
      };
      if (Object.keys(patch).length) ok = shell.run(timetrackActions.editBlock({ blockId: b.id, ...patch })).ok;
    }
    if (ok) onclose();
  }

  function remove(): void {
    if (mode.kind !== 'edit') return;
    if (shell.run(timetrackActions.deleteBlock(mode.block.id)).ok) onclose();
  }
</script>

<Modal open={true} {titleKey} oncancel={onclose} onsubmit={save} testid="tt-block-dialog">
  <p class="muted" data-testid="tt-dialog-when">{when}</p>
  <label class="field">
    <span><Msg key="timetrack.dialog.title" /></span>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      data-testid="tt-dialog-title"
      maxlength={TITLE_MAX}
      placeholder={displayTitle('', tags.filter((t) => tagIds.includes(t.id)), msgText('timetrack.block.defaultTitle'))}
      bind:value={title}
      autofocus
    />
  </label>
  <div class="field">
    <span><Msg key="timetrack.dialog.tags" /></span>
    {#if tags.length === 0}
      <p class="muted small"><Msg key="timetrack.dialog.noTags" /></p>
    {:else}
      <div class="tag-toggles" data-testid="tt-dialog-tags">
        {#each tags as tag (tag.id)}
          <button
            type="button"
            class="tag-toggle"
            aria-pressed={tagIds.includes(tag.id)}
            data-tag-id={tag.id}
            onclick={() => toggle(tag.id)}
          >
            <span class="tag-dot" style:background={tag.color}></span>{tag.name}
          </button>
        {/each}
      </div>
    {/if}
  </div>
  {#snippet actions()}
    {#if mode.kind === 'edit'}
      <button type="button" class="danger-button" data-testid="tt-dialog-delete" onclick={remove}><Msg key="timetrack.dialog.delete" /></button>
      <span class="spacer"></span>
    {/if}
    <button type="button" data-testid="tt-dialog-cancel" onclick={onclose}><Msg key="timetrack.dialog.cancel" /></button>
    <button type="submit" class="primary" data-testid="tt-dialog-save">
      <Msg key={mode.kind === 'start' ? 'timetrack.dialog.start' : 'timetrack.dialog.save'} />
    </button>
  {/snippet}
</Modal>
