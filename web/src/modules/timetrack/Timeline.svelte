<script lang="ts">
  import { blockTags, timetrackModule, type Block, type TimetrackState } from '@focuspocus/modules/timetrack';
  import { blocksInRange, effectiveEnd } from '@focuspocus/modules/timetrack/blocks';
  import { hourMarks, windowRange, type DayKey, type Range } from '@focuspocus/modules/timetrack/time';
  import { getLocale } from '../../i18n/locale.svelte';
  import { getShell } from '../../shell/context';
  import { msgText } from '../../i18n/msg';
  import { blockBackground, blockInk } from './colors';
  import { formatDay, formatHour, formatTime } from './format';
  import type { TimetrackUi } from './ui.svelte';

  /**
   * Day columns (one for Day view, seven for Week view) over the visible day window. Dragging on
   * empty space creates a block (preview first, pop-up on release); clicking a block edits it.
   */
  let { ui, tt }: { ui: TimetrackUi; tt: TimetrackState } = $props();
  const shell = getShell();

  const SNAP_MS = 5 * 60_000;
  /** A press that moves less than this is a click, not a drag. */
  const CLICK_SLOP_PX = 4;
  const PREVIEW_ID = '~preview';

  interface Drag {
    day: DayKey;
    range: Range;
    el: HTMLElement;
    pointerId: number;
    startY: number;
    anchorMs: number;
    currentMs: number;
    moved: boolean;
  }
  let drag = $state<Drag | null>(null);

  const snap = (ms: number, range: Range) => Math.min(range.to, Math.max(range.from, Math.round(ms / SNAP_MS) * SNAP_MS));

  function msAt(el: HTMLElement, range: Range, clientY: number): number {
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return snap(range.from + frac * (range.to - range.from), range);
  }

  /** The span being created: the live drag, or the one waiting in the open pop-up. */
  const pending = $derived.by((): { startMs: number; endMs: number } | null => {
    if (drag?.moved) {
      const a = Math.min(drag.anchorMs, drag.currentMs);
      const b = Math.max(drag.anchorMs, drag.currentMs);
      return b > a ? { startMs: a, endMs: b } : null;
    }
    if (ui.dialog?.kind === 'create') return { startMs: ui.dialog.startMs, endMs: ui.dialog.endMs };
    return null;
  });

  /**
   * The state as it will be after the create, computed by the real command, so the preview shows
   * exactly the truncation that will happen. `null` state means the block would be fully covered.
   */
  const preview = $derived.by(() => {
    if (!pending) return null;
    const r = timetrackModule.commands.CreateBlock!.apply(
      tt,
      { ...pending, title: '', tagIds: [] },
      { id: PREVIEW_ID, at: ui.now },
    );
    return { ...pending, state: r.ok ? (r.state as TimetrackState) : null };
  });

  const shown = $derived(preview?.state ?? tt);

  interface Placed {
    block: Block;
    top: number;
    height: number;
    from: number;
    to: number;
    running: boolean;
  }

  function place(blocks: Block[], i: number, range: Range): Placed {
    const block = blocks[i]!;
    const span = range.to - range.from;
    // A running block grows until now, but is never drawn over the block after it.
    let end = effectiveEnd(block, ui.now);
    const next = blocks[i + 1];
    if (block.endMs === null && next) end = Math.min(end, next.startMs);
    const from = Math.max(block.startMs, range.from);
    const to = Math.min(end, range.to);
    return {
      block,
      from: block.startMs,
      to: end,
      top: ((from - range.from) / span) * 100,
      height: (Math.max(0, to - from) / span) * 100,
      running: block.endMs === null,
    };
  }

  const columns = $derived(
    ui.timelineDays.map((day) => {
      const range = windowRange(day, ui.zone, shown.dayWindow);
      const span = range.to - range.from;
      const blocks = blocksInRange(shown.blocks, range.from, range.to, ui.now);
      const placed = blocks.map((_, i) => place(blocks, i, range));
      const marks = hourMarks(day, ui.zone, shown.dayWindow).map((m) => ({ ...m, top: ((m.ms - range.from) / span) * 100 }));
      const nowTop = ui.now >= range.from && ui.now < range.to ? ((ui.now - range.from) / span) * 100 : null;
      // A covered (rejected) preview is drawn on its own, as invalid.
      let invalid: { top: number; height: number } | null = null;
      if (preview && !preview.state && preview.startMs < range.to && preview.endMs > range.from) {
        const from = Math.max(preview.startMs, range.from);
        const to = Math.min(preview.endMs, range.to);
        invalid = { top: ((from - range.from) / span) * 100, height: ((to - from) / span) * 100 };
      }
      return { day, range, placed, marks, nowTop, invalid };
    }),
  );

  const axis = $derived(columns[0]?.marks ?? []);
  const locale = $derived(getLocale());
  const defaultTitle = $derived(msgText('timetrack.block.defaultTitle'));

  function onPointerDown(e: PointerEvent, day: DayKey, range: Range): void {
    if (e.button !== 0 || ui.dialog || (e.target as HTMLElement).closest('.tl-block')) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const ms = msAt(el, range, e.clientY);
    drag = { day, range, el, pointerId: e.pointerId, startY: e.clientY, anchorMs: ms, currentMs: ms, moved: false };
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.currentMs = msAt(drag.el, drag.range, e.clientY);
    if (Math.abs(e.clientY - drag.startY) >= CLICK_SLOP_PX) drag.moved = true;
  }

  function onPointerUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const span = pending;
    const covered = preview !== null && preview.state === null;
    drag = null;
    if (covered) shell.notify('timetrack.error.blockCovered');
    else if (span) {
      ui.refresh();
      ui.dialog = { kind: 'create', ...span };
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      drag = null;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="timeline" data-testid="tt-timeline" data-days={columns.length}>
  <div class="tl-head">
    <div class="tl-gutter"></div>
    {#each columns as col (col.day)}
      <button
        type="button"
        class="tl-dayhead"
        class:today={col.day === ui.today}
        data-testid="tt-dayhead"
        onclick={() => ui.openDay(col.day)}
      >
        {formatDay(col.day, locale, { weekday: 'short', day: 'numeric', month: columns.length === 1 ? 'long' : undefined })}
      </button>
    {/each}
  </div>
  <div class="tl-body">
    <div class="tl-axis" aria-hidden="true">
      {#each axis as m, i (i)}
        <span class="tl-hour" style:top="{m.top}%">{formatHour(m.hour)}</span>
      {/each}
    </div>
    {#each columns as col (col.day)}
      <div
        class="tl-col"
        class:today={col.day === ui.today}
        data-day={col.day}
        role="presentation"
        onpointerdown={(e) => onPointerDown(e, col.day, col.range)}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={() => (drag = null)}
      >
        {#each col.marks as m, i (i)}<div class="tl-line" style:top="{m.top}%"></div>{/each}
        {#each col.placed as p (p.block.id)}
          {@const tags = blockTags(shown, p.block)}
          {@const isPreview = p.block.id === PREVIEW_ID}
          <button
            type="button"
            class="tl-block"
            class:running={p.running}
            class:preview={isPreview}
            data-testid={isPreview ? 'tt-preview' : 'tt-block'}
            data-block-id={p.block.id}
            style:top="{p.top}%"
            style:height="{p.height}%"
            style:background={blockBackground(tags)}
            style:color={blockInk(tags)}
            title={`${p.block.title || defaultTitle} · ${formatTime(p.from, ui.zone, locale)}–${formatTime(p.to, ui.zone, locale)}`}
            onclick={() => {
              if (isPreview || ui.dialog) return;
              ui.refresh();
              ui.dialog = { kind: 'edit', block: p.block };
            }}
          >
            <span class="tl-block-title">{p.block.title || defaultTitle}</span>
            <span class="tl-block-time">
              {formatTime(p.from, ui.zone, locale)}–{p.running ? msgText('timetrack.block.now') : formatTime(p.to, ui.zone, locale)}
            </span>
            {#if tags.length}<span class="tl-block-tags">{tags.map((t) => t.name).join(', ')}</span>{/if}
          </button>
        {/each}
        {#if col.invalid}
          <div class="tl-block preview invalid" data-testid="tt-preview-invalid" style:top="{col.invalid.top}%" style:height="{col.invalid.height}%">
            <span class="tl-block-title">{msgText('timetrack.error.blockCovered')}</span>
          </div>
        {/if}
        {#if col.nowTop !== null}<div class="tl-now" data-testid="tt-now" style:top="{col.nowTop}%"></div>{/if}
      </div>
    {/each}
  </div>
</div>
