import HistoryPanel from '../../shell/HistoryPanel.svelte';
import type { PanelDefinition } from '../../shell/panels';
import QuickPanel from './QuickPanel.svelte';
import TimersPanel from './TimersPanel.svelte';

export const timersPanels: PanelDefinition[] = [
  { id: 'timers.list', module: 'timers', titleKey: 'timers.panel.list', component: TimersPanel, showTitle: false },
  { id: 'timers.quick', module: 'timers', titleKey: 'timers.panel.quick', component: QuickPanel },
  { id: 'timers.history', module: 'timers', titleKey: 'shell.panel.history', component: HistoryPanel, props: { module: 'timers' } },
];
