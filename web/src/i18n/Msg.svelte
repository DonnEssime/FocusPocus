<script lang="ts">
  import type { MessageParams } from '@focuspocus/core/i18n/types';
  import type { AppMessageKey } from '@focuspocus/registry';
  import { msg } from './msg';

  let { key, params }: { key: AppMessageKey; params?: MessageParams } = $props();
  const resolved = $derived(msg(key, params));
</script>

{#if import.meta.env.DEV && (resolved.fallback || resolved.missing)}<span class="i18n-fallback" title={key}
    >{resolved.text}</span
  >{:else}{resolved.text}{/if}
