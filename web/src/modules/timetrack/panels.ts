import HistoryPanel from '../../shell/HistoryPanel.svelte';
import type { PanelDefinition } from '../../shell/panels';
import SettingsPanel from './SettingsPanel.svelte';
import StatsPanel from './StatsPanel.svelte';
import TagsPanel from './TagsPanel.svelte';
import TimeViewPanel from './TimeViewPanel.svelte';

export const timetrackPanels: PanelDefinition[] = [
  { id: 'timetrack.timeView', module: 'timetrack', titleKey: 'timetrack.panel.timeView', component: TimeViewPanel },
  {
    id: 'timetrack.history',
    module: 'timetrack',
    titleKey: 'shell.panel.history',
    component: HistoryPanel,
    // Settings live in a pop-up behind the gear button of the History panel.
    props: { module: 'timetrack', settings: SettingsPanel, settingsTitle: 'timetrack.panel.settings' },
  },
  { id: 'timetrack.stats', module: 'timetrack', titleKey: 'timetrack.panel.stats', component: StatsPanel },
  { id: 'timetrack.tags', module: 'timetrack', titleKey: 'timetrack.panel.tags', component: TagsPanel },
];
