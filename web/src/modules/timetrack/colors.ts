import type { Tag } from '@focuspocus/modules/timetrack';

/** CSS colour of a tag, or the theme's untagged grey. */
export function tagColor(tag: Tag | undefined): string {
  return tag ? tag.color : 'var(--tag-none)';
}

/** Equal vertical stripes, one per tag, side by side (§10.2 *Tags*). */
export function blockBackground(tags: readonly Tag[]): string {
  if (tags.length === 0) return 'var(--tag-none)';
  if (tags.length === 1) return tags[0]!.color;
  const step = 100 / tags.length;
  const stops = tags.map((t, i) => `${t.color} ${i * step}% ${(i + 1) * step}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Relative luminance (WCAG) of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Dark or light text for a block, judged on its first tag's colour. */
export function blockInk(tags: readonly Tag[]): string {
  const first = tags[0];
  if (!first) return 'var(--ink-on-dark)';
  // Contrast against white vs. against near-black: pick whichever is higher.
  const l = luminance(first.color);
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? 'var(--ink-on-light)' : 'var(--ink-on-dark)';
}

export interface Hsv {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
}

export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)].map((c) => Math.round(c * 255)) as [number, number, number];
}

export function hsvToHex(hsv: Hsv): string {
  return `#${hsvToRgb(hsv)
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
