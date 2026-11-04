import type { PanelDefinition } from '../../shell/panels';
import SettingsPanel from './SettingsPanel.svelte';
import TimerPanel from './TimerPanel.svelte';

export const focusPanels: PanelDefinition[] = [
  { id: 'focus.timer', module: 'focus', titleKey: 'focus.panel.timer', component: TimerPanel },
  { id: 'focus.settings', module: 'focus', titleKey: 'focus.panel.settings', component: SettingsPanel },
];
