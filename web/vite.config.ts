import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const buildInfo = {
  version: rootPackage.version,
  commit: git('rev-parse --short=7 HEAD') ?? 'dev',
  date: (git('log -1 --format=%cI') ?? '').slice(0, 10),
};

export default defineConfig({
  // Served from https://<user>.github.io/FocusPocus/
  base: '/FocusPocus/',
  plugins: [svelte()],
  resolve: {
    alias: { '@focuspocus': fileURLToPath(new URL('../src', import.meta.url)) },
  },
  define: { __BUILD_INFO__: JSON.stringify(buildInfo) },
  server: { fs: { allow: ['..'] } },
});
