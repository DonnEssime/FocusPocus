import { expect, test, type Page } from '@playwright/test';

/** Each test gets its own vault in the browser's private file system (dev-only `?opfs=`). */
function vaultUrl(name: string): string {
  return `./?opfs=${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Focus has no history panel: undo/redo there is keyboard-only. Click a panel title first so
 * no input has focus (inputs keep their native text undo). */
async function shortcut(page: Page, panelTitle: string, keys: string): Promise<void> {
  await page.locator('.panel-title', { hasText: panelTitle }).click();
  await page.keyboard.press(keys);
}

async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
}

/** Time tracking settings live in a pop-up behind the History panel's gear button. */
async function openSettings(page: Page): Promise<void> {
  await page.getByTestId('module-settings').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
}

async function closeSettings(page: Page): Promise<void> {
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('settings-dialog')).toBeHidden();
}

async function expectSummary(page: Page, text: string | RegExp): Promise<void> {
  await openSettings(page);
  await expect(page.getByTestId('day-window-summary')).toHaveText(text);
  await closeSettings(page);
}

test('shows the modules as tabs with their panels', async ({ page }) => {
  await page.goto(vaultUrl('tabs'));
  await expect(page.getByRole('tab', { name: 'Time tracking' })).toBeVisible();
  await expect(page.getByTestId('tt-timeline')).toBeVisible();
  await expect(page.getByTestId('settings-dialog')).toBeHidden();
  await expectSummary(page, 'Days are shown from 07:00 to 05:00 the next day.');

  await page.getByRole('tab', { name: 'Focus' }).click();
  await expect(page.getByTestId('focus-countdown')).toHaveText('25:00');
  // Focus has no undo/redo buttons; time tracking and to-dos each have their own.
  await expect(page.locator('[data-panel$=".history"]').filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('[data-panel$=".history"]')).toHaveCount(2);

  await page.getByRole('tab', { name: 'To-dos' }).click();
  await expect(page.getByTestId('todo-panel')).toBeVisible();
  await expect(page.locator('[data-panel="todo.history"]')).toBeVisible();
});

test('settings close with Esc, and keyboard undo waits until they are closed', async ({ page }) => {
  await page.goto(vaultUrl('settings'));
  await openSettings(page);
  await page.getByTestId('tt-day-start').selectOption('9');
  await page.locator('[data-testid="settings-dialog"] .modal-title').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('day-window-summary')).toContainText('from 09:00');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-dialog')).toBeHidden();
  await expect(page.locator('.tl-hour').first()).toHaveText('09:00');
});

test('commands persist across reloads and undo/redo is per module', async ({ page }) => {
  const url = vaultUrl('persist');
  await page.goto(url);
  await openSettings(page);
  await page.getByTestId('tt-day-start').selectOption('8');
  await expect(page.getByTestId('day-window-summary')).toContainText('from 08:00');
  await closeSettings(page);

  await page.getByRole('tab', { name: 'Focus' }).click();
  await page.getByTestId('focus-duration').fill('50');
  await page.getByTestId('focus-duration').press('Enter');
  await expect(page.getByTestId('focus-countdown')).toHaveText('50:00');

  // Undo in the Focus scope (keyboard) leaves time tracking alone.
  await shortcut(page, 'Timer', 'ControlOrMeta+z');
  await expect(page.getByTestId('focus-countdown')).toHaveText('25:00');
  await shortcut(page, 'Timer', 'ControlOrMeta+Shift+z');
  await expect(page.getByTestId('focus-countdown')).toHaveText('50:00');
  await page.getByRole('tab', { name: 'Time tracking' }).click();
  await expectSummary(page, /from 08:00/);
  await page.getByTestId('undo').filter({ visible: true }).click();
  await expectSummary(page, /from 07:00/);
  await expect(page.getByTestId('undo').filter({ visible: true })).toBeDisabled();
  await page.getByTestId('redo').filter({ visible: true }).click();

  await waitSaved(page);
  await page.reload();
  await expectSummary(page, /from 08:00/);
  await page.getByRole('tab', { name: 'Focus' }).click();
  await expect(page.getByTestId('focus-countdown')).toHaveText('50:00');
  // Undo history survives the reload, because it is part of the log.
  await shortcut(page, 'Timer', 'ControlOrMeta+z');
  await expect(page.getByTestId('focus-countdown')).toHaveText('25:00');
});

test('two windows on the same vault stay in sync', async ({ context }) => {
  const url = vaultUrl('windows');
  const a = await context.newPage();
  await a.goto(url);
  await expect(a.getByTestId('tt-timeline')).toBeVisible();
  const b = await context.newPage();
  await b.goto(url);
  await expect(b.getByTestId('tt-timeline')).toBeVisible();

  await openSettings(a);
  await a.getByTestId('tt-day-end').selectOption('23');
  await closeSettings(a);
  await expectSummary(b, 'Days are shown from 07:00 to 23:00.');
  await b.getByTestId('undo').filter({ visible: true }).click();
  await expectSummary(a, 'Days are shown from 07:00 to 05:00 the next day.');
});
