import HistoryPanel from '../../shell/HistoryPanel.svelte';
import type { PanelDefinition } from '../../shell/panels';
import SettingsPanel from './SettingsPanel.svelte';
import TagsPanel from './TagsPanel.svelte';
import TimeViewPanel from './TimeViewPanel.svelte';

export const timetrackPanels: PanelDefinition[] = [
  { id: 'timetrack.timeView', module: 'timetrack', titleKey: 'timetrack.panel.timeView', component: TimeViewPanel },
  {
    id: 'timetrack.history',
    module: 'timetrack',
    titleKey: 'shell.panel.history',
    component: HistoryPanel,
    props: { module: 'timetrack' },
  },
  { id: 'timetrack.tags', module: 'timetrack', titleKey: 'timetrack.panel.tags', component: TagsPanel },
  { id: 'timetrack.settings', module: 'timetrack', titleKey: 'timetrack.panel.settings', component: SettingsPanel },
];
