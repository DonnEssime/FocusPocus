import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { applyTheme } from './theme/applyTheme';
import { resolveTheme } from './theme/registry';

// Default theme before any vault is open (vault settings may switch it later).
applyTheme(resolveTheme(undefined));

mount(App, { target: document.getElementById('app')! });
