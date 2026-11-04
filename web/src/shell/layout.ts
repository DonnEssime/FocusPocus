import type { AppMessageKey } from '@focuspocus/registry';

/**
 * Layout tree the shell renders. Today it is a fixed default; later it will be vault state
 * (`app.SetLayout`) so users can rearrange panels.
 *
 * Convention: tabs switch between modules only. Within a module, all its panels are composed
 * onto one page with `split` nodes.
 */
export type LayoutNode =
  | { kind: 'panel'; panel: string }
  | { kind: 'tabs'; tabs: Array<{ title?: AppMessageKey; node: LayoutNode }> }
  | { kind: 'split'; direction: 'row' | 'column'; children: SplitChild[] };

/** `weight` shares the free space; `fit` sizes the child to its content instead (small panels). */
export interface SplitChild {
  node: LayoutNode;
  weight?: number;
  fit?: boolean;
}

export const panel = (id: string): LayoutNode => ({ kind: 'panel', panel: id });

export const DEFAULT_LAYOUT: LayoutNode = {
  kind: 'tabs',
  tabs: [
    {
      // Calendar on the left; the side column will also hold statistics and tags (§10.2).
      title: 'timetrack.title',
      node: {
        kind: 'split',
        direction: 'row',
        children: [
          { node: panel('timetrack.timeView'), weight: 3 },
          {
            node: {
              kind: 'split',
              direction: 'column',
              children: [{ node: panel('timetrack.history'), fit: true }, { node: panel('timetrack.settings') }],
            },
            weight: 1,
          },
        ],
      },
    },
    {
      // Timer large on the left, settings beside it. No history panel: undo/redo stays
      // available through keyboard shortcuts only.
      title: 'focus.title',
      node: {
        kind: 'split',
        direction: 'row',
        children: [
          { node: panel('focus.timer'), weight: 2 },
          { node: panel('focus.settings'), weight: 1 },
        ],
      },
    },
  ],
};

export function firstPanel(node: LayoutNode): string | undefined {
  switch (node.kind) {
    case 'panel':
      return node.panel;
    case 'tabs':
      return node.tabs[0] ? firstPanel(node.tabs[0].node) : undefined;
    case 'split':
      return node.children[0] ? firstPanel(node.children[0].node) : undefined;
  }
}
