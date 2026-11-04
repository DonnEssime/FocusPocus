import type { Page } from '@playwright/test';

export const H = 3_600_000;

/** Wednesday 4 November 2026, 14:30 in Brussels (UTC+1). */
export const NOW = Date.UTC(2026, 10, 4, 13, 30);

export function vaultUrl(name: string): string {
  return `./?opfs=${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Fixed clock and zone, then open a fresh vault on the Time tracking tab. */
export async function openTracker(page: Page, name: string, now = NOW): Promise<void> {
  await page.clock.setFixedTime(now);
  await page.goto(vaultUrl(name));
  await page.getByTestId('tt-timeline').waitFor();
}

interface Hook {
  dispatch(a: { t: string; p: unknown; deps?: string[] }): { ok: boolean };
  commands(): { id: string }[];
}

/** Dispatch through the dev-only hook; returns the new command's id (block or tag id). */
export async function dispatch(page: Page, t: string, p: unknown, deps: string[] = []): Promise<string> {
  return page.evaluate(
    ({ t, p, deps }) => {
      const hook = (window as unknown as { __focuspocus: Hook }).__focuspocus;
      const r = hook.dispatch({ t, p, deps });
      if (!r.ok) throw new Error(`${t} rejected: ${JSON.stringify(r)}`);
      return hook.commands().at(-1)!.id;
    },
    { t, p, deps },
  );
}

export async function createTag(page: Page, name: string, color: string): Promise<string> {
  return dispatch(page, 'tt.CreateTag', { name, color, description: '' });
}

export async function createBlock(page: Page, startMs: number, endMs: number, title = '', tagIds: string[] = []): Promise<string> {
  return dispatch(page, 'tt.CreateBlock', { startMs, endMs, title, tagIds }, tagIds);
}
