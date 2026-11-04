import { expect, test, type Page } from '@playwright/test';
import { createBlock, createTag, H, NOW, openTracker, vaultUrl, waitSaved } from './helpers/timetrack';

test.use({ timezoneId: 'Europe/Brussels' });

/** 4 Nov 2026 07:00 in Brussels: the default day window runs 22 h from here. */
const DAY_START = Date.UTC(2026, 10, 4, 6);
const SPAN = 22 * H;
const at = (localHour: number) => DAY_START + (localHour - 7) * H;

async function dayView(page: Page): Promise<void> {
  await page.getByTestId('tt-view-day').click();
}

/** Screen y of an instant in the Day view column. */
async function yOf(page: Page, ms: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.tl-col').first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + ((ms - DAY_START) / SPAN) * box.height };
}

async function dragBetween(page: Page, fromMs: number, toMs: number, release = true): Promise<void> {
  const a = await yOf(page, fromMs);
  const b = await yOf(page, toMs);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, (a.y + b.y) / 2, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 3 });
  if (release) await page.mouse.up();
}

test('dragging on empty space previews the block, then the pop-up creates it in one undo step', async ({ page }) => {
  await openTracker(page, 'drag');
  await createTag(page, 'Deep work', '#1b9e77');
  await dayView(page);
  await dragBetween(page, at(9), at(10.5), false);
  await expect(page.getByTestId('tt-preview')).toContainText('09:00–10:30');
  await page.mouse.up();

  const dialog = page.getByTestId('tt-block-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('tt-dialog-when')).toHaveText('09:00–10:30');
  await expect(dialog.getByTestId('tt-dialog-title')).toBeFocused();
  await dialog.getByTestId('tt-dialog-title').fill('Report');
  await dialog.getByRole('button', { name: 'Deep work' }).click();
  await dialog.getByTestId('tt-dialog-title').press('Enter');
  await expect(dialog).toBeHidden();

  const block = page.getByTestId('tt-block');
  await expect(block).toHaveCount(1);
  await expect(block).toContainText('Report');
  await expect(block).toContainText('Deep work');
  await page.getByTestId('undo').click();
  await expect(block).toHaveCount(0);
  await expect(page.getByTestId('tt-tag')).toHaveCount(1); // the tag stays: separate step
});

test('the preview shows truncation; cancelling the pop-up changes nothing', async ({ page }) => {
  await openTracker(page, 'truncate');
  await createBlock(page, at(10), at(11), 'Later');
  await dayView(page);
  await dragBetween(page, at(9), at(10.5));
  // While the pop-up is open, the later block is shown as it will be.
  await expect(page.getByTestId('tt-block').filter({ hasText: 'Later' })).toContainText('10:30–11:00');
  await page.getByTestId('tt-dialog-cancel').click();
  await expect(page.getByTestId('tt-block').filter({ hasText: 'Later' })).toContainText('10:00–11:00');
  await expect(page.getByTestId('tt-preview')).toHaveCount(0);

  // Esc cancels a drag before release.
  await dragBetween(page, at(13), at(14), false);
  await expect(page.getByTestId('tt-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tt-preview')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByTestId('tt-block-dialog')).toBeHidden();
});

test('a drag inside an earlier block is shown as invalid and opens no pop-up', async ({ page }) => {
  await openTracker(page, 'covered');
  await createBlock(page, at(9), at(12), 'Long');
  await dayView(page);
  // Press just below its end (snaps to 12:00) and drag up into it: 10:00–12:00 lies inside "Long".
  await dragBetween(page, at(12) + 60_000, at(10), false);
  await expect(page.getByTestId('tt-preview-invalid')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId('tt-block-dialog')).toBeHidden();
  await expect(page.locator('.toast')).toContainText('completely covered');
});

test('clicking a block edits only what changed, and Delete removes it', async ({ page }) => {
  await openTracker(page, 'edit');
  const tag = await createTag(page, 'Admin', '#d95f02');
  await createBlock(page, at(9), at(10), '', [tag]);
  await dayView(page);
  const block = page.getByTestId('tt-block');
  await expect(block).toContainText('Working');
  await block.click();
  const dialog = page.getByTestId('tt-block-dialog');
  await expect(dialog.getByTestId('tt-dialog-title')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Admin' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByTestId('tt-dialog-title').fill('Inbox');
  await dialog.getByTestId('tt-dialog-save').click();
  await expect(block).toContainText('Inbox');
  await expect(block).toContainText('Admin');

  await block.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await block.click();
  await dialog.getByTestId('tt-dialog-delete').click();
  await expect(block).toHaveCount(0);
  await page.getByTestId('undo').click();
  await expect(block).toContainText('Inbox');
});

test('start tracking begins when pressed, survives a reload, shows in other windows, and stops', async ({ context }) => {
  await context.clock.setFixedTime(NOW);
  const page = await context.newPage();
  const url = vaultUrl('tracking');
  await page.goto(url);
  await page.getByTestId('tt-track').click();
  const dialog = page.getByTestId('tt-block-dialog');
  await expect(dialog.getByTestId('tt-dialog-when')).toHaveText('From 14:30, until you stop');
  await context.clock.setFixedTime(NOW + 10 * 60_000); // time passes while typing
  await dialog.getByTestId('tt-dialog-title').fill('Deep focus');
  await dialog.getByTestId('tt-dialog-save').click();
  await expect(page.getByTestId('tt-track')).toHaveText('Stop tracking');
  const running = page.getByTestId('tt-block').filter({ hasText: 'Deep focus' });
  await expect(running).toContainText('14:30–now');

  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByTestId('tt-track')).toHaveText('Stop tracking');

  await waitSaved(page);
  await page.reload();
  await expect(page.getByTestId('tt-track')).toHaveText('Stop tracking');
  await context.clock.setFixedTime(NOW + 45 * 60_000);
  await page.getByTestId('tt-track').click();
  await expect(page.getByTestId('tt-track')).toHaveText('Start tracking');
  await expect(running).toContainText('14:30–15:15');
  await expect(other.getByTestId('tt-track')).toHaveText('Start tracking');
});

test('a drag runs past midnight when the day window does, and stays in its own day', async ({ page }) => {
  await openTracker(page, 'midnight');
  await dayView(page);
  await dragBetween(page, at(23), at(25.5)); // 23:00 → 01:30 the next morning
  const dialog = page.getByTestId('tt-block-dialog');
  await expect(dialog.getByTestId('tt-dialog-when')).toHaveText('23:00–01:30');
  await dialog.getByTestId('tt-dialog-title').fill('Late');
  await dialog.getByTestId('tt-dialog-save').click();
  const late = page.getByTestId('tt-block').filter({ hasText: 'Late' });
  await expect(late).toContainText('23:00–01:30');

  // Resizing works across midnight too.
  const handle = late.getByTestId('tt-handle-end');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, (await yOf(page, at(26.5))).y, { steps: 5 });
  await page.mouse.up();
  await expect(late).toContainText('23:00–02:30');

  // It all belongs to the 4 Nov logical day, which starts at 07:00.
  await page.getByTestId('tt-view-month').click();
  await expect(page.locator('[data-day="2026-11-04"]').getByTestId('tt-month-total')).toHaveText('3h 30m');
  await expect(page.locator('[data-day="2026-11-05"]').getByTestId('tt-month-total')).toHaveCount(0);
});

test('with a window that ends before midnight, a drag stops at the window end', async ({ page }) => {
  await openTracker(page, 'evening');
  await page.getByTestId('module-settings').click();
  await page.getByTestId('tt-day-end').selectOption('23');
  await page.getByTestId('settings-close').click();
  await dayView(page);
  const box = (await page.locator('.tl-col').first().boundingBox())!;
  const y = (h: number) => box.y + ((h - 7) / 16) * box.height; // 07:00–23:00
  await page.mouse.move(box.x + box.width / 2, y(22));
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 80, { steps: 5 }); // far below
  await page.mouse.up();
  await expect(page.getByTestId('tt-dialog-when')).toHaveText('22:00–23:00');
});
