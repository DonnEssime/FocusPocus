<script lang="ts">
  import type { TimetrackState } from '@focuspocus/modules/timetrack';
  import { addDays, monthStart, weekStart } from '@focuspocus/modules/timetrack/time';
  import { getLocale } from '../../i18n/locale.svelte';
  import Msg from '../../i18n/Msg.svelte';
  import { msgText } from '../../i18n/msg';
  import { getSessionStore } from '../../shell/context';
  import Popover from '../../shell/ui/Popover.svelte';
  import DatePicker from './DatePicker.svelte';
  import { formatDay, formatDayRange } from './format';
  import MonthGrid from './MonthGrid.svelte';
  import Timeline from './Timeline.svelte';
  import { timetrackUiFor, type ViewKind } from './ui.svelte';

  const store = getSessionStore();
  const ui = timetrackUiFor(store);
  const state = $derived(store.moduleState<TimetrackState>('timetrack'));
  const VIEWS: ViewKind[] = ['day', 'week', 'month'];
  let picker: Popover;

  const label = $derived.by(() => {
    const locale = getLocale();
    if (ui.view === 'day') return formatDay(ui.anchor, locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (ui.view === 'week') {
      const first = weekStart(ui.anchor);
      return formatDayRange(first, addDays(first, 6), locale, { day: 'numeric', month: 'short', year: 'numeric' });
    }
    return formatDay(monthStart(ui.anchor), locale, { month: 'long', year: 'numeric' });
  });
</script>

<div class="timeview">
  <div class="tt-toolbar">
    <div class="segmented" role="group" aria-label={msgText('timetrack.nav.view')}>
      {#each VIEWS as v (v)}
        <button type="button" aria-pressed={ui.view === v} data-testid="tt-view-{v}" onclick={() => (ui.view = v)}>
          <Msg key={`timetrack.view.${v}`} />
        </button>
      {/each}
    </div>
    <button type="button" class="icon" data-testid="tt-prev" aria-label={msgText('timetrack.nav.prev')} onclick={() => ui.step(-1)}>‹</button>
    <button type="button" class="icon" data-testid="tt-next" aria-label={msgText('timetrack.nav.next')} onclick={() => ui.step(1)}>›</button>
    <button type="button" class="tt-date-label" data-testid="tt-date-label" popovertarget="tt-date-popover">{label}</button>
    <button type="button" data-testid="tt-today" onclick={() => ui.goToday()}><Msg key="timetrack.nav.today" /></button>
  </div>
  <Popover id="tt-date-popover" bind:this={picker}>
    <DatePicker
      value={ui.anchor}
      today={ui.today}
      onpick={(day) => {
        ui.anchor = day;
        picker.hide();
      }}
    />
  </Popover>
  {#if ui.view === 'month'}
    <MonthGrid {ui} {state} />
  {:else}
    <Timeline {ui} {state} />
  {/if}
</div>
