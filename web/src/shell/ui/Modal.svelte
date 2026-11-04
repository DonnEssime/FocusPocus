<script lang="ts">
  import type { AppMessageKey } from '@focuspocus/registry';
  import type { Snippet } from 'svelte';
  import Msg from '../../i18n/Msg.svelte';

  /**
   * A modal dialog on the native `<dialog>` element, which provides the backdrop, the focus trap
   * and inert content behind it. Esc and a click on the backdrop cancel; Enter in a field submits.
   * The parent owns `open` and decides what cancel and submit do.
   */
  let {
    open,
    titleKey,
    oncancel,
    onsubmit,
    children,
    actions,
    testid,
  }: {
    open: boolean;
    titleKey: AppMessageKey;
    oncancel: () => void;
    onsubmit?: () => void;
    children: Snippet;
    /** Buttons; a `type="submit"` button triggers `onsubmit`. */
    actions?: Snippet;
    testid?: string;
  } = $props();

  let dialog: HTMLDialogElement;

  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="modal"
  data-testid={testid}
  oncancel={(e) => {
    e.preventDefault();
    oncancel();
  }}
  onmousedown={(e) => {
    // The form fills the dialog, so only the backdrop has the dialog itself as target.
    if (e.target === dialog) oncancel();
  }}
>
  {#snippet content()}
    <h2 class="modal-title"><Msg key={titleKey} /></h2>
    <div class="modal-body">{@render children()}</div>
    {#if actions}<div class="modal-actions">{@render actions()}</div>{/if}
  {/snippet}
  {#if open}
    <!-- Only a modal with a submit action is a form, so a choice modal can open inside another one. -->
    {#if onsubmit}
      <form
        class="modal-form"
        onsubmit={(e) => {
          e.preventDefault();
          onsubmit();
        }}
      >
        {@render content()}
      </form>
    {:else}
      <div class="modal-form">{@render content()}</div>
    {/if}
  {/if}
</dialog>
