<script lang="ts">
  import { runningBlock, timetrackActions, type TimetrackState } from '@focuspocus/modules/timetrack';
  import { addDays, monthStart, weekStart } from '@focuspocus/modules/timetrack/time';
  import { getLocale } from '../../i18n/locale.svelte';
  import Msg from '../../i18n/Msg.svelte';
  import { msgText } from '../../i18n/msg';
  import { getSessionStore, getShell } from '../../shell/context';
  import Modal from '../../shell/ui/Modal.svelte';
  import Popover from '../../shell/ui/Popover.svelte';
  import BlockDialog from './BlockDialog.svelte';
  import DatePicker from './DatePicker.svelte';
  import TargetPopover from './TargetPopover.svelte';
  import { dayTargetView } from './targetView';
  import { formatBalance, formatClock } from '@focuspocus/modules/timetrack/targets';
  import type { DayKey } from '@focuspocus/modules/timetrack/time';
  import { formatDay, formatDayRange } from './format';
  import MonthGrid from './MonthGrid.svelte';
  import Timeline from './Timeline.svelte';
  import { timetrackUiFor, type ViewKind } from './ui.svelte';

  const store = getSessionStore();
  const ui = timetrackUiFor(store);
  const shell = getShell();
  const tt = $derived(store.moduleState<TimetrackState>('timetrack'));
  const running = $derived(runningBlock(tt));

  /** Start opens the pop-up; the block starts when the button was pressed, not when saved. */
  function startTracking(): void {
    ui.refresh();
    ui.dialog = { kind: 'start', startMs: Date.now() };
  }

  function stopTracking(): void {
    if (running) shell.run(timetrackActions.stopTracking(running.id, Date.now()));
    ui.refresh();
  }
  const VIEWS: ViewKind[] = ['day', 'week', 'month'];
  let picker: Popover;

  // Target hours (hidden entirely while switched off).
  const targetsOn = $derived(tt.targets.enabled);
  const dayView = $derived(targetsOn && ui.view === 'day' ? dayTargetView(tt, ui.anchor, ui) : null);
  let targetPopover: Popover;
  let targetDay = $state<DayKey | null>(null);

  function editTarget(day: DayKey, anchor: HTMLElement): void {
    targetDay = day;
    targetPopover.show(anchor);
  }

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
    {#if dayView}
      <button
        type="button"
        class="target-chip"
        class:over={dayView.balanceMs > 0}
        class:under={dayView.balanceMs < 0}
        data-testid="tt-target-chip"
        onclick={(e) => editTarget(dayView.day, e.currentTarget)}
      >
        {#if dayView.future}
          <Msg key="timetrack.targets.chipFuture" params={{ target: formatClock(dayView.targetMs) }} />
        {:else}
          <Msg
            key="timetrack.targets.chip"
            params={{ target: formatClock(dayView.targetMs), tracked: formatClock(dayView.trackedMs), balance: formatBalance(dayView.balanceMs) }}
          />
        {/if}
      </button>
    {/if}
    <span class="spacer"></span>
    {#if running}
      <button type="button" class="tracking" data-testid="tt-track" onclick={stopTracking}><Msg key="timetrack.track.stop" /></button>
    {:else}
      <button type="button" class="primary" data-testid="tt-track" onclick={startTracking}><Msg key="timetrack.track.start" /></button>
    {/if}
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
    <MonthGrid {ui} {tt} />
  {:else}
    <Timeline {ui} {tt} ontarget={targetsOn && ui.view === 'week' ? editTarget : undefined} />
  {/if}
  <Popover id="tt-target-popover" bind:this={targetPopover} onclose={() => (targetDay = null)}>
    {#if targetDay}<TargetPopover day={targetDay} {tt} ondone={() => targetPopover.hide()} />{/if}
  </Popover>
  {#if ui.dialog}
    <BlockDialog mode={ui.dialog} {tt} zone={ui.zone} onclose={() => (ui.dialog = null)} />
  {/if}
  <Modal
    open={ui.confirmDelete !== null}
    titleKey="timetrack.confirmDelete.title"
    oncancel={() => (ui.confirmDelete = null)}
    onsubmit={() => {
      const block = ui.confirmDelete;
      ui.confirmDelete = null;
      if (block) shell.run(timetrackActions.deleteBlock(block.id));
    }}
    testid="tt-confirm-delete"
  >
    <p class="muted">
      <Msg key={ui.confirmDelete?.endMs === null ? 'timetrack.confirmDelete.running' : 'timetrack.confirmDelete.body'} />
    </p>
    {#snippet actions()}
      <button type="button" data-testid="tt-confirm-cancel" onclick={() => (ui.confirmDelete = null)}><Msg key="timetrack.dialog.cancel" /></button>
      <button type="submit" class="danger-button" data-testid="tt-confirm-delete-button"><Msg key="timetrack.dialog.delete" /></button>
    {/snippet}
  </Modal>
</div>
