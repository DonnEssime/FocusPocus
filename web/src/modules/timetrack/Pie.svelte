<script lang="ts">
  /**
   * A plain-SVG pie. Slices start at 12 o'clock and go clockwise. `radius` is in the 100×100
   * view box (50 fills it), so callers scale pies against each other.
   */
  export interface PieSlice {
    key: string;
    color: string;
    share: number;
  }

  let { slices, radius = 50, label }: { slices: PieSlice[]; radius?: number; label?: string } = $props();

  const paths = $derived.by(() => {
    const total = slices.reduce((s, x) => s + x.share, 0) || 1;
    let angle = 0;
    return slices.map((s) => {
      const a0 = angle;
      angle += (s.share / total) * Math.PI * 2;
      return { ...s, a0, a1: angle };
    });
  });

  const point = (a: number) => `${(radius * Math.sin(a)).toFixed(3)} ${(-radius * Math.cos(a)).toFixed(3)}`;
</script>

<svg class="pie" viewBox="-50 -50 100 100" role="img" aria-label={label}>
  {#each paths as p (p.key)}
    {#if p.a1 - p.a0 >= Math.PI * 2 - 1e-9}
      <circle r={radius} style:fill={p.color} data-slice={p.key} />
    {:else if p.a1 > p.a0}
      <path
        d={`M0 0 L${point(p.a0)} A${radius} ${radius} 0 ${p.a1 - p.a0 > Math.PI ? 1 : 0} 1 ${point(p.a1)} Z`}
        style:fill={p.color}
        data-slice={p.key}
      />
    {/if}
  {/each}
</svg>
