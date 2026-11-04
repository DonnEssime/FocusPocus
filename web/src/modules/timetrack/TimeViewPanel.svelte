<script lang="ts">
  import type { TimetrackState } from '@focuspocus/modules/timetrack';
  import Msg from '../../i18n/Msg.svelte';
  import { getSessionStore } from '../../shell/context';
  import { formatHour } from './format';

  const store = getSessionStore();
  const dayWindow = $derived(store.moduleState<TimetrackState>('timetrack').dayWindow);
  const params = $derived({ start: formatHour(dayWindow.startHour), end: formatHour(dayWindow.endHour) });
</script>

<div class="placeholder">
  <p class="muted"><Msg key="timetrack.placeholder" /></p>
  <p data-testid="day-window-summary">
    <Msg
      key={dayWindow.endHour <= dayWindow.startHour ? 'timetrack.dayWindow.summaryNextDay' : 'timetrack.dayWindow.summary'}
      {params}
    />
  </p>
</div>
