import type { AppMessageKey } from '@focuspocus/registry';
import type { Component } from 'svelte';

/** A unit of UI a module contributes. Panels never assume they fill the screen. */
export interface PanelDefinition {
  id: string;
  /** Owning module id: the undo/redo scope while the user works in this panel. */
  module: string;
  titleKey: AppMessageKey;
  component: Component;
}
