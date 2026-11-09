import type { PanelDefinition } from '../shell/panels';
import { focusPanels } from './focus/panels';
import { timetrackPanels } from './timetrack/panels';
import { todoPanels } from './todo/panels';

export const PANELS: ReadonlyMap<string, PanelDefinition> = new Map(
  [...timetrackPanels, ...focusPanels, ...todoPanels].map((p) => [p.id, p]),
);
