<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A floating panel on the native Popover API: light dismiss (outside click, Esc) and top-layer
   * stacking come from the browser. It is anchored below its opener with CSS anchor positioning
   * and flips above when there is no room.
   *
   * Open it with a `popovertarget={id}` button (the browser toggles it and sets the anchor), or
   * call `show(anchor)` / `hide()` through `bind:this`.
   */
  let {
    id,
    children,
    onclose,
    testid,
  }: { id: string; children: Snippet; onclose?: () => void; testid?: string } = $props();

  let el: HTMLDivElement;
  let isOpen = $state(false);

  export function show(anchor?: HTMLElement): void {
    if (!el.matches(':popover-open')) el.showPopover(anchor ? { source: anchor } : undefined);
  }

  export function hide(): void {
    if (el.matches(':popover-open')) el.hidePopover();
  }
</script>

<div
  bind:this={el}
  {id}
  popover="auto"
  class="popover"
  data-testid={testid}
  onbeforetoggle={(e) => {
    // Fires before the popover shows, so the content is there on the first frame.
    if ((e as ToggleEvent).newState === 'open') isOpen = true;
  }}
  ontoggle={(e) => {
    if ((e as ToggleEvent).newState === 'closed') {
      isOpen = false;
      onclose?.();
    }
  }}
>
  {#if isOpen}{@render children()}{/if}
</div>
