import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../src/core/vault/format';
import { resolveTheme, THEMES } from '../web/src/theme/registry';
import { THEME_TOKENS } from '../web/src/theme/tokens';

const ROOT = join(import.meta.dirname, '..');
const WEB_SRC = join(ROOT, 'web', 'src');
const THEMES_DIR = join(WEB_SRC, 'theme', 'themes');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('theming', () => {
  it('uses no hard-coded colours outside theme definitions', () => {
    const offenders: string[] = [];
    for (const file of walk(WEB_SRC)) {
      if (file.startsWith(THEMES_DIR) || !/\.(svelte|css|ts)$/.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g)) {
        offenders.push(`${relative(ROOT, file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('defines every token in every theme and falls back to dark', () => {
    for (const theme of Object.values(THEMES)) {
      for (const token of THEME_TOKENS) expect(theme.tokens[token], `${theme.id}.${token}`).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
    }
    expect(resolveTheme('nope').id).toBe('dark');
    expect(resolveTheme(undefined).id).toBe('dark');
  });
});

describe('versions', () => {
  it('keeps APP_VERSION in sync with both package.json files', () => {
    for (const pkg of ['package.json', 'web/package.json']) {
      expect(JSON.parse(readFileSync(join(ROOT, pkg), 'utf8')).version, pkg).toBe(APP_VERSION);
    }
  });
});

describe('focus sounds', () => {
  const SOUND_DIR = join(WEB_SRC, 'modules', 'focus', 'sounds');

  it('ships a file and a licence row for every registered sound, within the size budget', async () => {
    const { SOUNDS, DEFAULT_SOUND_IDS, resolveSound } = await import('../web/src/modules/focus/sounds');
    const licences = readFileSync(join(SOUND_DIR, 'LICENSES.md'), 'utf8');
    let total = 0;
    for (const sound of SOUNDS) {
      const file = join(SOUND_DIR, `${sound.id}.ogg`);
      total += statSync(file).size;
      expect(licences, sound.id).toContain(`\`${sound.id}.ogg\``);
    }
    expect(total).toBeLessThan(400 * 1024);
    expect(readdirSync(SOUND_DIR).filter((f) => f.endsWith('.ogg'))).toHaveLength(SOUNDS.length);
    expect(resolveSound('ticking', DEFAULT_SOUND_IDS.ticking).id).toBe('clock-tick');
    expect(resolveSound('finishing', 'from-a-newer-build').id).toBe('bell-single');
    expect(resolveSound('finishing', 'clock-tick').id).toBe('bell-single'); // wrong kind falls back too
  });
});
