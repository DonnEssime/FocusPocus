<script lang="ts">
  import Shell from './shell/Shell.svelte';
  import VaultPicker from './shell/VaultPicker.svelte';
  import type { OpenedVault } from './shell/vaultOpening';

  let opened = $state<OpenedVault | null>(null);
  let autoOpen = $state(true);

  async function closeVault(): Promise<void> {
    const current = opened;
    opened = null;
    autoOpen = false;
    await current?.vs.close();
  }
</script>

{#if opened}
  {#key opened}
    <Shell {opened} onclose={closeVault} />
  {/key}
{:else}
  <VaultPicker {autoOpen} onopen={(o) => (opened = o)} />
{/if}
