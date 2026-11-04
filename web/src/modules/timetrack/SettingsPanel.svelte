<script lang="ts">
  import { timetrackActions, type DayWindow, type TimetrackState } from '@focuspocus/modules/timetrack';
  import { formatClock, fulltimeOn, parseClock } from '@focuspocus/modules/timetrack/targets';
  import { getLocale } from '../../i18n/locale.svelte';
  import Msg from '../../i18n/Msg.svelte';
  import { msgText } from '../../i18n/msg';
  import { getSessionStore, getShell } from '../../shell/context';
  import Modal from '../../shell/ui/Modal.svelte';
  import { formatDay, formatHour, HOURS } from './format';
  import { timetrackUiFor } from './ui.svelte';

  const store = getSessionStore();
  const shell = getShell();
  const ui = timetrackUiFor(store);
  const tt = $derived(store.moduleState<TimetrackState>('timetrack'));
  const dayWindow = $derived(tt.dayWindow);
  const targets = $derived(tt.targets);

  const params = $derived({ start: formatHour(dayWindow.startHour), end: formatHour(dayWindow.endHour) });

  function update(patch: Partial<DayWindow>): void {
    shell.run(timetrackActions.setDayWindow({ ...dayWindow, ...patch }));
  }

  // Full-time hours: the value in force today, and since when (when it was set going forward).
  const fulltimeToday = $derived(fulltimeOn(targets, ui.today));
  const fulltimeSince = $derived(targets.fulltime.findLast((e) => e.from <= ui.today)?.from || null);

  /** A changed value waiting for "going forward / retroactively"; the command is issued after. */
  let pendingFulltime = $state<number | null>(null);
  let fulltimeInput = $state<HTMLInputElement>();

  function onFulltimeChange(input: HTMLInputElement): void {
    const ms = parseClock(input.value);
    if (ms === null) {
      shell.notify('timetrack.error.invalidFulltime');
      input.value = formatClock(fulltimeToday);
      return;
    }
    input.value = formatClock(ms);
    if (ms !== fulltimeToday) pendingFulltime = ms;
  }

  function applyFulltime(applyFrom: string | null): void {
    const ms = pendingFulltime;
    pendingFulltime = null;
    if (ms !== null) shell.run(timetrackActions.setTargetSettings({ fulltimeMs: ms, applyFrom }));
  }

  function cancelFulltime(): void {
    pendingFulltime = null;
    if (fulltimeInput) fulltimeInput.value = formatClock(fulltimeToday);
  }
</script>

<!-- Not a form: it is shown inside the settings pop-up, which is one. -->
<div class="settings">
  <label>
    <span><Msg key="timetrack.dayWindow.start" /></span>
    <select
      data-testid="tt-day-start"
      value={dayWindow.startHour}
      onchange={(e) => update({ startHour: Number(e.currentTarget.value) })}
    >
      {#each HOURS as h (h)}<option value={h}>{formatHour(h)}</option>{/each}
    </select>
  </label>
  <label>
    <span><Msg key="timetrack.dayWindow.end" /></span>
    <select
      data-testid="tt-day-end"
      value={dayWindow.endHour}
      onchange={(e) => update({ endHour: Number(e.currentTarget.value) })}
    >
      {#each HOURS as h (h)}<option value={h}>{formatHour(h)}</option>{/each}
    </select>
  </label>
  <p class="muted small" data-testid="day-window-summary">
    <Msg
      key={dayWindow.endHour <= dayWindow.startHour ? 'timetrack.dayWindow.summaryNextDay' : 'timetrack.dayWindow.summary'}
      {params}
    />
  </p>

  <label class="checkbox">
    <input
      type="checkbox"
      data-testid="tt-targets-enabled"
      checked={targets.enabled}
      onchange={(e) => shell.run(timetrackActions.setTargetSettings({ enabled: e.currentTarget.checked }))}
    />
    <span><Msg key="timetrack.targets.enable" /></span>
  </label>
  {#if targets.enabled}
    <label>
      <span><Msg key="timetrack.targets.fulltime" /></span>
      <input
        bind:this={fulltimeInput}
        class="clock-input"
        data-testid="tt-fulltime"
        inputmode="numeric"
        placeholder="8:00"
        value={formatClock(fulltimeToday)}
        onchange={(e) => onFulltimeChange(e.currentTarget)}
        onkeydown={(e) => {
          // Enter commits this field instead of submitting (closing) the settings pop-up.
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    </label>
    {#if fulltimeSince}
      <p class="muted small" data-testid="tt-fulltime-since">
        <Msg key="timetrack.targets.fulltimeSince" params={{ date: formatDay(fulltimeSince, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) }} />
      </p>
    {/if}
    <p class="muted small"><Msg key="timetrack.targets.hint" /></p>
  {:else}
    <p class="muted small"><Msg key="timetrack.targets.disabledHint" /></p>
  {/if}
</div>

<Modal
  open={pendingFulltime !== null}
  titleKey="timetrack.targets.applyTitle"
  oncancel={cancelFulltime}
  testid="tt-fulltime-apply"
>
  <p>
    <Msg
      key="timetrack.targets.applyBody"
      params={{ from: formatClock(fulltimeToday), to: formatClock(pendingFulltime ?? 0) }}
    />
  </p>
  {#snippet actions()}
    <div class="choice-actions">
      <button type="button" class="primary" data-testid="tt-apply-forward" onclick={() => applyFulltime(ui.today)}>
        <Msg key="timetrack.targets.applyForward" />
      </button>
      <button type="button" data-testid="tt-apply-all" onclick={() => applyFulltime(null)}>
        <Msg key="timetrack.targets.applyAll" />
      </button>
      <button type="button" data-testid="tt-apply-cancel" onclick={cancelFulltime}>{msgText('timetrack.dialog.cancel')}</button>
    </div>
  {/snippet}
</Modal>
