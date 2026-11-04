import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { applyTheme } from './theme/applyTheme';
import { resolveTheme } from './theme/registry';

// Default theme before any vault is open (vault settings may switch it later).
applyTheme(resolveTheme(undefined));

// Current Chromium has Temporal built in; load the polyfill only where it is missing.
const ready = 'Temporal' in globalThis ? Promise.resolve() : import('temporal-polyfill/global');
void ready.then(() => mount(App, { target: document.getElementById('app')! }));
