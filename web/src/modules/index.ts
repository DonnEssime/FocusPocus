import type { AppMessageKey } from '@focuspocus/registry';
import type { PanelDefinition } from '../shell/panels';
import { focusPanels } from './focus/panels';
import { timetrackPanels } from './timetrack/panels';

export const PANELS: ReadonlyMap<string, PanelDefinition> = new Map(
  [...timetrackPanels, ...focusPanels].map((p) => [p.id, p]),
);

export const MODULE_TITLES: Readonly<Record<string, AppMessageKey>> = {
  timetrack: 'timetrack.title',
  focus: 'focus.title',
};
