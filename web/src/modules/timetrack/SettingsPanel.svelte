<script lang="ts">
  import { timetrackActions, type DayWindow, type TimetrackState } from '@focuspocus/modules/timetrack';
  import Msg from '../../i18n/Msg.svelte';
  import { getSessionStore, getShell } from '../../shell/context';
  import { formatHour, HOURS } from './format';

  const store = getSessionStore();
  const shell = getShell();
  const dayWindow = $derived(store.moduleState<TimetrackState>('timetrack').dayWindow);

  function update(patch: Partial<DayWindow>): void {
    shell.run(timetrackActions.setDayWindow({ ...dayWindow, ...patch }));
  }
</script>

<form class="settings" onsubmit={(e) => e.preventDefault()}>
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
</form>
