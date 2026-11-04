import { expect, test, type Page } from '@playwright/test';

/** Each test gets its own vault in the browser's private file system (dev-only `?opfs=`). */
function vaultUrl(name: string): string {
  return `./?opfs=${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
}

test('shows both modules as tabs with their placeholder panels', async ({ page }) => {
  await page.goto(vaultUrl('tabs'));
  await expect(page.getByRole('tab', { name: 'Time tracking' })).toBeVisible();
  await expect(page.getByText('The calendar is coming soon.')).toBeVisible();
  await expect(page.getByTestId('day-window-summary')).toHaveText('Days are shown from 07:00 to 05:00 the next day.');

  await page.getByRole('tab', { name: 'Focus' }).click();
  await expect(page.getByTestId('focus-countdown')).toHaveText('25:00');
  await expect(page.getByTestId('undo-scope')).toHaveText('Undo and redo apply to: Focus');
});

test('commands persist across reloads and undo/redo is per module', async ({ page }) => {
  const url = vaultUrl('persist');
  await page.goto(url);
  await page.getByTestId('tt-day-start').selectOption('8');
  await expect(page.getByTestId('day-window-summary')).toContainText('from 08:00');

  await page.getByRole('tab', { name: 'Focus' }).click();
  await page.getByTestId('focus-duration').fill('50');
  await page.getByTestId('focus-duration').press('Enter');
  await expect(page.getByTestId('focus-countdown')).toHaveText('50:00');

  // Undo in the Focus scope leaves time tracking alone.
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('focus-countdown')).toHaveText('25:00');
  await expect(page.getByTestId('undo')).toBeDisabled();
  await page.getByTestId('redo').click();
  await expect(page.getByTestId('focus-countdown')).toHaveText('50:00');

  await waitSaved(page);
  await page.reload();
  await expect(page.getByTestId('day-window-summary')).toContainText('from 08:00');
  await page.getByRole('tab', { name: 'Focus' }).click();
  await expect(page.getByTestId('focus-countdown')).toHaveText('50:00');
  // Undo history survives the reload, because it is part of the log.
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('focus-countdown')).toHaveText('25:00');
});

test('two windows on the same vault stay in sync', async ({ context }) => {
  const url = vaultUrl('windows');
  const a = await context.newPage();
  await a.goto(url);
  await expect(a.getByTestId('day-window-summary')).toBeVisible();
  const b = await context.newPage();
  await b.goto(url);
  await expect(b.getByTestId('day-window-summary')).toBeVisible();

  await a.getByTestId('tt-day-end').selectOption('23');
  await expect(b.getByTestId('day-window-summary')).toHaveText('Days are shown from 07:00 to 23:00.');
  await b.getByTestId('undo').click();
  await expect(a.getByTestId('day-window-summary')).toHaveText('Days are shown from 07:00 to 05:00 the next day.');
});
