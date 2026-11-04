import { expect, test, type Locator, type Page } from '@playwright/test';
import { createBlock, createTag, dispatch, H, NOW, openTracker } from './helpers/timetrack';

test.use({ timezoneId: 'Europe/Brussels' });

const DAY_START = Date.UTC(2026, 10, 4, 6);
const SPAN = 22 * H;
const at = (localHour: number) => DAY_START + (localHour - 7) * H;

async function dayView(page: Page): Promise<void> {
  await page.getByTestId('tt-view-day').click();
}

async function yOf(page: Page, ms: number): Promise<number> {
  const box = (await page.locator('.tl-col').first().boundingBox())!;
  return box.y + ((ms - DAY_START) / SPAN) * box.height;
}

/** Drag one edge handle of `block` to the instant `toMs`. */
async function dragEdge(page: Page, block: Locator, edge: 'start' | 'end', toMs: number, release = true): Promise<void> {
  const handle = block.getByTestId(edge === 'start' ? 'tt-handle-start' : 'tt-handle-end');
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, await yOf(page, toMs), { steps: 5 });
  if (release) await page.mouse.up();
}

const block = (page: Page, title: string) => page.getByTestId('tt-block').filter({ hasText: title });

test('dragging an edge changes start or end in one undo step', async ({ page }) => {
  await openTracker(page, 'resize');
  await createBlock(page, at(9), at(10), 'A');
  await dayView(page);
  await dragEdge(page, block(page, 'A'), 'end', at(10.5), false);
  await expect(block(page, 'A')).toContainText('09:00–10:30'); // live preview
  await page.mouse.up();
  await expect(block(page, 'A')).toContainText('09:00–10:30');
  await expect(page.getByTestId('tt-block-dialog')).toBeHidden();
  await dragEdge(page, block(page, 'A'), 'start', at(8.25));
  await expect(block(page, 'A')).toContainText('08:15–10:30');
  await page.getByTestId('undo').click();
  await expect(block(page, 'A')).toContainText('09:00–10:30');
  await page.getByTestId('undo').click();
  await expect(block(page, 'A')).toContainText('09:00–10:00');
});

test('edges stop at the neighbours, and Esc cancels a resize', async ({ page }) => {
  await openTracker(page, 'clamp');
  await createBlock(page, at(9), at(10), 'A');
  await createBlock(page, at(11), at(12), 'B');
  await dayView(page);
  await dragEdge(page, block(page, 'A'), 'end', at(11.5));
  await expect(block(page, 'A')).toContainText('09:00–11:00');
  await dragEdge(page, block(page, 'B'), 'start', at(9.5));
  await expect(block(page, 'B')).toContainText('11:00–12:00'); // A now ends at 11: nothing to gain
  await dragEdge(page, block(page, 'B'), 'end', at(13), false);
  await expect(block(page, 'B')).toContainText('11:00–13:00');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(block(page, 'B')).toContainText('11:00–12:00');
});

test('a press on an edge without moving opens the pop-up', async ({ page }) => {
  await openTracker(page, 'edgeclick');
  await createBlock(page, at(9), at(11), 'A');
  await dayView(page);
  const handle = block(page, 'A').getByTestId('tt-handle-end');
  await handle.click();
  await expect(page.getByTestId('tt-block-dialog')).toBeVisible();
});

test('resizing to zero length asks to delete: Cancel restores, Delete removes', async ({ page }) => {
  await openTracker(page, 'zero');
  await createBlock(page, at(9), at(10), 'A');
  await dayView(page);
  await dragEdge(page, block(page, 'A'), 'end', at(8));
  const confirm = page.getByTestId('tt-confirm-delete');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Delete this block?');
  await page.getByTestId('tt-confirm-cancel').click();
  await expect(confirm).toBeHidden();
  await expect(block(page, 'A')).toContainText('09:00–10:00');

  await dragEdge(page, block(page, 'A'), 'start', at(11));
  await page.getByTestId('tt-confirm-delete-button').click();
  await expect(block(page, 'A')).toHaveCount(0);
});

test('the running block: only its start can be dragged, not past now', async ({ page }) => {
  await openTracker(page, 'runresize');
  await dispatch(page, 'tt.StartTracking', { startMs: NOW - H, title: 'Live', tagIds: [] });
  await dayView(page);
  const live = block(page, 'Live');
  await expect(live.getByTestId('tt-handle-end')).toHaveCount(0);
  await dragEdge(page, live, 'start', NOW - 2 * H);
  await expect(live).toContainText('12:30–now');
  // Dragging the start to (or past) now is zero length: deleting it stops tracking.
  await dragEdge(page, live, 'start', NOW + H);
  await expect(page.getByTestId('tt-confirm-delete')).toContainText('also stops tracking');
  await page.getByTestId('tt-confirm-delete-button').click();
  await expect(page.getByTestId('tt-track')).toHaveText('Start tracking');
});

test('statistics cover the shown range, split shared time per tag and show a pie', async ({ page }) => {
  await openTracker(page, 'stats');
  const a = await createTag(page, 'A', '#1b9e77');
  const b = await createTag(page, 'B', '#d95f02');
  await createBlock(page, at(9), at(11), '', [a, b]);
  await createBlock(page, at(12), at(13), '', [a]);
  await createBlock(page, at(14), at(14.5));
  await createBlock(page, at(9) - 2 * 24 * H, at(10) - 2 * 24 * H, '', [b]); // Monday
  const stats = page.getByTestId('tt-stats');
  await expect(stats.getByTestId('tt-stats-total')).toHaveText('4h 30m'); // week
  await expect(stats.getByTestId('tt-stats-pie')).toBeVisible();
  const row = (key: string) => stats.locator(`[data-testid="tt-stats-row"][data-key="${key}"]`);
  await expect(row(a)).toContainText('2h 00m');
  await expect(row(b)).toContainText('2h 00m');
  await expect(row('')).toContainText('No tag');
  await expect(row('')).toContainText('30m');

  await page.getByTestId('tt-view-day').click();
  await expect(stats.getByTestId('tt-stats-total')).toHaveText('3h 30m');
  await page.getByTestId('tt-next').click();
  await expect(stats).toContainText('Nothing tracked');
  await expect(stats.getByTestId('tt-stats-pie')).toHaveCount(0);
});
