import type { AppMessageKey } from '@focuspocus/registry';

/**
 * Layout tree the shell renders. Today it is a fixed default; later it will be vault state
 * (`app.SetLayout`) so users can rearrange panels.
 */
export type LayoutNode =
  | { kind: 'panel'; panel: string }
  | { kind: 'tabs'; tabs: Array<{ title?: AppMessageKey; node: LayoutNode }> }
  | { kind: 'split'; direction: 'row' | 'column'; children: Array<{ node: LayoutNode; weight?: number }> };

export const panel = (id: string): LayoutNode => ({ kind: 'panel', panel: id });

export const DEFAULT_LAYOUT: LayoutNode = {
  kind: 'tabs',
  tabs: [
    {
      title: 'timetrack.title',
      node: {
        kind: 'split',
        direction: 'row',
        children: [
          { node: panel('timetrack.timeView'), weight: 3 },
          { node: { kind: 'tabs', tabs: [{ node: panel('timetrack.settings') }] }, weight: 1 },
        ],
      },
    },
    {
      title: 'focus.title',
      node: { kind: 'tabs', tabs: [{ node: panel('focus.timer') }, { node: panel('focus.settings') }] },
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
