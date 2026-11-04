import type { PanelDefinition } from '../../shell/panels';
import SettingsPanel from './SettingsPanel.svelte';
import TimeViewPanel from './TimeViewPanel.svelte';

export const timetrackPanels: PanelDefinition[] = [
  { id: 'timetrack.timeView', module: 'timetrack', titleKey: 'timetrack.panel.timeView', component: TimeViewPanel },
  { id: 'timetrack.settings', module: 'timetrack', titleKey: 'timetrack.panel.settings', component: SettingsPanel },
];
