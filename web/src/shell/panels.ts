import type { AppMessageKey } from '@focuspocus/registry';
import type { Component } from 'svelte';

/** A unit of UI a module contributes. Panels never assume they fill the screen. */
export interface PanelDefinition {
  id: string;
  /** Owning module id: the undo/redo scope while the user works in this panel. */
  module: string;
  titleKey: AppMessageKey;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: Component<any>;
  /** `false` hides the small header, e.g. when it would only repeat the tab's title. */
  showTitle?: boolean;
  /** Props passed to the component (lets one component serve several modules). */
  props?: Record<string, unknown>;
}
