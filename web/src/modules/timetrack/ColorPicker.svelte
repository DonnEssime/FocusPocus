<script lang="ts">
  import { DARK2, isColor } from '@focuspocus/modules/timetrack';
  import { msgText } from '../../i18n/msg';
  import { hexToHsv, hsvToHex, hsvToRgb, type Hsv } from './colors';

  /**
   * HSV colour wheel (hue around, saturation outwards) with a brightness slider, a hex field and
   * the Dark2 swatches as quick picks. Reports every change through `onchange`; the caller decides
   * when to commit (the tags panel commits when the popover closes).
   */
  let { value, onchange }: { value: string; onchange: (hex: string) => void } = $props();

  const SIZE = 168;
  // svelte-ignore state_referenced_locally
  let hsv = $state<Hsv>(hexToHsv(value));
  // svelte-ignore state_referenced_locally
  let hexText = $state(value);
  let canvas: HTMLCanvasElement;

  function set(next: Hsv): void {
    hsv = next;
    hexText = hsvToHex(next);
    onchange(hexText);
  }

  function pick(hex: string): void {
    hsv = hexToHsv(hex);
    hexText = hex;
    onchange(hex);
  }

  function draw(v: number): void {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(SIZE, SIZE);
    const r = SIZE / 2;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x + 0.5 - r;
        const dy = y + 0.5 - r;
        const d = Math.hypot(dx, dy) / r;
        const i = (y * SIZE + x) * 4;
        if (d > 1) continue;
        const h = (Math.atan2(dx, -dy) * 180) / Math.PI + 360;
        const [cr, cg, cb] = hsvToRgb({ h: h % 360, s: d, v });
        img.data[i] = cr;
        img.data[i + 1] = cg;
        img.data[i + 2] = cb;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  $effect(() => draw(hsv.v));

  function fromPointer(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    const s = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    set({ h, s, v: hsv.v || 1 });
  }

  const marker = $derived({
    left: 50 + 50 * hsv.s * Math.sin((hsv.h * Math.PI) / 180),
    top: 50 - 50 * hsv.s * Math.cos((hsv.h * Math.PI) / 180),
  });
  const valueTrack = $derived(`linear-gradient(to right, ${hsvToHex({ ...hsv, v: 0 })}, ${hsvToHex({ ...hsv, v: 1 })})`);
</script>

<div class="colorpicker" data-testid="tt-colorpicker">
  <div class="colorwheel">
    <canvas
      bind:this={canvas}
      width={SIZE}
      height={SIZE}
      aria-label={msgText('timetrack.color.wheel')}
      onpointerdown={(e) => {
        canvas.setPointerCapture(e.pointerId);
        fromPointer(e);
      }}
      onpointermove={(e) => {
        if (canvas.hasPointerCapture(e.pointerId)) fromPointer(e);
      }}
    ></canvas>
    <span class="colorwheel-marker" style:left="{marker.left}%" style:top="{marker.top}%"></span>
  </div>
  <input
    type="range"
    class="colorvalue"
    min="0"
    max="100"
    aria-label={msgText('timetrack.color.brightness')}
    value={Math.round(hsv.v * 100)}
    style:background={valueTrack}
    oninput={(e) => set({ ...hsv, v: Number(e.currentTarget.value) / 100 })}
  />
  <div class="colorswatches">
    {#each DARK2 as c (c)}
      <button
        type="button"
        class="swatch"
        class:selected={hexText.toLowerCase() === c}
        style:background={c}
        data-color={c}
        aria-label={c}
        onclick={() => pick(c)}
      ></button>
    {/each}
  </div>
  <input
    type="text"
    class="colorhex"
    data-testid="tt-color-hex"
    aria-label={msgText('timetrack.color.hex')}
    bind:value={hexText}
    oninput={() => {
      if (isColor(hexText)) {
        hsv = hexToHsv(hexText);
        onchange(hexText.toLowerCase());
      }
    }}
  />
</div>
