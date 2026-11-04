<script lang="ts">
  import Msg from '../i18n/Msg.svelte';
  import { PANELS } from '../modules';
  import { getShell } from './context';
  import LayoutHost from './LayoutHost.svelte';
  import { firstPanel, type LayoutNode } from './layout';

  let { node }: { node: LayoutNode } = $props();
  const shell = getShell();
  let selected = $state(0);

  function select(index: number, tab: { node: LayoutNode }): void {
    selected = index;
    const id = firstPanel(tab.node);
    const def = id ? PANELS.get(id) : undefined;
    if (def) shell.setActiveModule(def.module);
  }

  function tabTitle(tab: { title?: string; node: LayoutNode }) {
    if (tab.title) return tab.title;
    const id = firstPanel(tab.node);
    return (id && PANELS.get(id)?.titleKey) || 'shell.unknownPanel';
  }
</script>

{#if node.kind === 'panel'}
  {@const def = PANELS.get(node.panel)}
  {#if def}
    <section
      class="panel"
      data-panel={def.id}
      onpointerdowncapture={() => shell.setActiveModule(def.module)}
      onfocusincapture={() => shell.setActiveModule(def.module)}
    >
      <h2 class="panel-title"><Msg key={def.titleKey} /></h2>
      <div class="panel-body"><def.component /></div>
    </section>
  {:else}
    <section class="panel"><Msg key="shell.unknownPanel" params={{ id: node.panel }} /></section>
  {/if}
{:else if node.kind === 'tabs'}
  <div class="tabs">
    <div class="tab-bar" role="tablist">
      {#each node.tabs as tab, i (i)}
        <button
          type="button"
          role="tab"
          class="tab"
          aria-selected={i === selected}
          onclick={() => select(i, tab)}
        >
          <Msg key={tabTitle(tab) as never} />
        </button>
      {/each}
    </div>
    <!-- All tabs stay mounted so module UI keeps running while hidden. -->
    {#each node.tabs as tab, i (i)}
      <div class="tab-body" role="tabpanel" hidden={i !== selected}>
        <LayoutHost node={tab.node} />
      </div>
    {/each}
  </div>
{:else}
  <div class="split" style:flex-direction={node.direction}>
    {#each node.children as child, i (i)}
      <div class="split-cell" style:flex-grow={child.weight ?? 1}>
        <LayoutHost node={child.node} />
      </div>
    {/each}
  </div>
{/if}
