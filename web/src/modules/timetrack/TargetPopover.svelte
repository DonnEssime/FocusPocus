<script lang="ts">
  import { timetrackActions, type DayTarget, type TimetrackState } from '@focuspocus/modules/timetrack';
  import { formatClock, fulltimeOn, parseTarget } from '@focuspocus/modules/timetrack/targets';
  import type { DayKey } from '@focuspocus/modules/timetrack/time';
  import { getLocale } from '../../i18n/locale.svelte';
  import Msg from '../../i18n/Msg.svelte';
  import { msgText } from '../../i18n/msg';
  import { getShell } from '../../shell/context';
  import { formatDay } from './format';
  import { ownTarget, targetText } from './targetView';

  /** Sets one day's target: 0/50/100 % shortcuts, or `hh:mm` / `%` typed in. One command each. */
  let { day, tt, ondone }: { day: DayKey; tt: TimetrackState; ondone: () => void } = $props();

  const shell = getShell();
  // Mounted per opening: the field starts from the day's current target.
  // svelte-ignore state_referenced_locally
  let text = $state(targetText(ownTarget(tt, day)));
  let error = $state(false);
  const current = $derived(ownTarget(tt, day));
  const fulltime = $derived(fulltimeOn(tt.targets, day));

  function set(target: DayTarget | null): void {
    if (shell.run(timetrackActions.setDayTarget(day, target)).ok) ondone();
  }

  function submit(): void {
    if (!text.trim()) return set(null);
    const parsed = parseTarget(text);
    if (!parsed) {
      error = true;
      return;
    }
    set(parsed);
  }

  const isPercent = (p: number) => current !== null && 'percent' in current && current.percent === p;
</script>

<form
  class="target-popover"
  data-testid="tt-target-popover"
  onsubmit={(e) => {
    e.preventDefault();
    submit();
  }}
>
  <div class="target-popover-title">
    <Msg key="timetrack.targets.forDay" params={{ date: formatDay(day, getLocale(), { weekday: 'short', day: 'numeric', month: 'short' }) }} />
  </div>
  <div class="segmented target-shortcuts">
    {#each [0, 50, 100] as p (p)}
      <button
        type="button"
        data-testid="tt-target-{p}"
        aria-pressed={p === 0 ? current === null : isPercent(p)}
        onclick={() => set(p === 0 ? null : { percent: p })}
      >
        {p}%
      </button>
    {/each}
  </div>
  <label class="field">
    <span><Msg key="timetrack.targets.custom" params={{ fulltime: formatClock(fulltime) }} /></span>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      data-testid="tt-target-input"
      class:invalid={error}
      placeholder={msgText('timetrack.targets.placeholder')}
      bind:value={text}
      oninput={() => (error = false)}
      autofocus
    />
  </label>
  {#if error}<p class="error small" data-testid="tt-target-error"><Msg key="timetrack.error.invalidTarget" /></p>{/if}
  <div class="modal-actions">
    <button type="submit" class="primary" data-testid="tt-target-save"><Msg key="timetrack.dialog.save" /></button>
  </div>
</form>
