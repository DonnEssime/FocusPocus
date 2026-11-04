import type { Tag } from '@focuspocus/modules/timetrack';

/**
 * What a block is called on screen: its own title; without one, its live tags (`Deep work / Admin`);
 * without those either, the catalog default ("Working"). Never written into the data, so it
 * follows tag renames and the language.
 */
export function displayTitle(title: string, tags: readonly Tag[], fallback: string): string {
  if (title) return title;
  if (tags.length) return tags.map((t) => t.name).join(' / ');
  return fallback;
}
