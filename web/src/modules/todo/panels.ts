import HistoryPanel from '../../shell/HistoryPanel.svelte';
import type { PanelDefinition } from '../../shell/panels';
import TodoPanel from './TodoPanel.svelte';

export const todoPanels: PanelDefinition[] = [
  { id: 'todo.list', module: 'todo', titleKey: 'todo.panel.list', component: TodoPanel, showTitle: false },
  { id: 'todo.history', module: 'todo', titleKey: 'shell.panel.history', component: HistoryPanel, props: { module: 'todo' } },
];
