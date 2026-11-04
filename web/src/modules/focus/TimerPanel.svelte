<script lang="ts">
  import type { FocusState } from '@focuspocus/modules/focus';
  import Msg from '../../i18n/Msg.svelte';
  import { getSessionStore } from '../../shell/context';

  const store = getSessionStore();
  const minutes = $derived(store.moduleState<FocusState>('focus').settings.durationMin);
</script>

<div class="placeholder timer">
  <div class="countdown" data-testid="focus-countdown">{String(minutes).padStart(2, '0')}:00</div>
  <button type="button" class="primary" disabled><Msg key="focus.start" /></button>
  <p class="muted"><Msg key="focus.placeholder" /></p>
</div>
