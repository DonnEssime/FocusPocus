<script lang="ts">
  import { blockTags, type Block, type TimetrackState } from '@focuspocus/modules/timetrack';
  import { blocksInRange, effectiveEnd } from '@focuspocus/modules/timetrack/blocks';
  import { hourMarks, windowRange, type DayKey } from '@focuspocus/modules/timetrack/time';
  import { getLocale } from '../../i18n/locale.svelte';
  import { msgText } from '../../i18n/msg';
  import { blockBackground, blockInk } from './colors';
  import { formatDay, formatHour, formatTime } from './format';
  import type { TimetrackUi } from './ui.svelte';

  /** Day columns (one for Day view, seven for Week view) over the visible day window. */
  let { ui, state }: { ui: TimetrackUi; state: TimetrackState } = $props();

  interface Placed {
    block: Block;
    top: number;
    height: number;
    from: number;
    to: number;
    running: boolean;
  }

  const columns = $derived(
    ui.timelineDays.map((day) => {
      const range = windowRange(day, ui.zone, state.dayWindow);
      const span = range.to - range.from;
      const blocks = blocksInRange(state.blocks, range.from, range.to, ui.now);
      const placed: Placed[] = blocks.map((block, i) => {
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
      });
      const marks = hourMarks(day, ui.zone, state.dayWindow).map((m) => ({ ...m, top: ((m.ms - range.from) / span) * 100 }));
      const nowTop = ui.now >= range.from && ui.now < range.to ? ((ui.now - range.from) / span) * 100 : null;
      return { day, placed, marks, nowTop };
    }),
  );

  const axis = $derived(columns[0]?.marks ?? []);
  const locale = $derived(getLocale());
  const defaultTitle = $derived(msgText('timetrack.block.defaultTitle'));
</script>

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
      <div class="tl-col" class:today={col.day === ui.today} data-day={col.day}>
        {#each col.marks as m, i (i)}<div class="tl-line" style:top="{m.top}%"></div>{/each}
        {#each col.placed as p (p.block.id)}
          {@const tags = blockTags(state, p.block)}
          <div
            class="tl-block"
            class:running={p.running}
            data-testid="tt-block"
            data-block-id={p.block.id}
            style:top="{p.top}%"
            style:height="{p.height}%"
            style:background={blockBackground(tags)}
            style:color={blockInk(tags)}
            title={`${p.block.title || defaultTitle} · ${formatTime(p.from, ui.zone, locale)}–${formatTime(p.to, ui.zone, locale)}`}
          >
            <span class="tl-block-title">{p.block.title || defaultTitle}</span>
            <span class="tl-block-time">
              {formatTime(p.from, ui.zone, locale)}–{p.running ? msgText('timetrack.block.now') : formatTime(p.to, ui.zone, locale)}
            </span>
            {#if tags.length}<span class="tl-block-tags">{tags.map((t) => t.name).join(', ')}</span>{/if}
          </div>
        {/each}
        {#if col.nowTop !== null}<div class="tl-now" data-testid="tt-now" style:top="{col.nowTop}%"></div>{/if}
      </div>
    {/each}
  </div>
</div>
