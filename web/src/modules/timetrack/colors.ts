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
