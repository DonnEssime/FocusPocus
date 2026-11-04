import type { ThemeDefinition } from '../types';

export const darkTheme: ThemeDefinition = {
  id: 'dark',
  labelKey: 'shell.theme.dark',
  colorScheme: 'dark',
  tokens: {
    bg: '#121418',
    surface: '#1a1d23',
    'surface-raised': '#232730',
    'surface-sunken': '#0e1013',
    border: '#2c313a',
    'border-strong': '#3d434e',
    text: '#e6e8eb',
    'text-muted': '#99a0aa',
    'text-on-accent': '#0b1512',
    accent: '#4fb59c',
    'accent-hover': '#66c7af',
    danger: '#e5675f',
    warning: '#e6ab02',
    success: '#66a61e',
    'focus-ring': '#7fd0bc',
    'tag-none': '#6b7078',
    // Text drawn on tag colours (user data, theme independent): picked per colour for contrast.
    'ink-on-light': '#111317',
    'ink-on-dark': '#ffffff',
    'now-line': '#e5675f',
    shadow: '#00000066',
  },
};
