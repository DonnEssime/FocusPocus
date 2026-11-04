import { expect, test } from '@playwright/test';
import { createBlock, createTag, dispatch, H, NOW, openTracker } from './helpers/timetrack';

test.use({ timezoneId: 'Europe/Brussels' });

/** 4 Nov 2026 07:00 in Brussels, the start of the default day window. */
const DAY_START = Date.UTC(2026, 10, 4, 6);

test('week view places blocks in their day column, at their time, in their tag colours', async ({ page }) => {
  await openTracker(page, 'week');
  await expect(page.getByTestId('tt-date-label')).toHaveText('Nov 2 – 8, 2026');
  const tag = await createTag(page, 'Deep work', '#1b9e77');
  await createBlock(page, DAY_START + 2 * H, DAY_START + 4 * H, 'Report', [tag]);
  await createBlock(page, DAY_START - 24 * H + 11 * H, DAY_START - 24 * H + 12 * H); // Tuesday, untagged

  const report = page.getByTestId('tt-block').filter({ hasText: 'Report' });
  await expect(report).toContainText('09:00–11:00');
  await expect(report).toContainText('Deep work');
  await expect(page.locator('.tl-col[data-day="2026-11-04"]').getByTestId('tt-block')).toHaveCount(1);
  // 2 h into a 22 h window: 9.09 %; 2 h long.
  const [top, height] = await report.evaluate((el) => [parseFloat(el.style.top), parseFloat(el.style.height)]);
  expect(top).toBeCloseTo((2 / 22) * 100, 3);
  expect(height).toBeCloseTo((2 / 22) * 100, 3);
  await expect(report).toHaveCSS('background-color', 'rgb(27, 158, 119)');
  const untagged = page.locator('.tl-col[data-day="2026-11-03"]').getByTestId('tt-block');
  await expect(untagged).toContainText('Working');
  await expect(page.locator('.tl-dayhead.today')).toContainText('4');
});

test('a running block grows to the now line, which shows only today', async ({ page }) => {
  await openTracker(page, 'running');
  await dispatch(page, 'tt.StartTracking', { startMs: NOW - H, title: 'Live', tagIds: [] });
  const live = page.getByTestId('tt-block').filter({ hasText: 'Live' });
  await expect(live).toContainText('13:30–now');
  await expect(live).toHaveClass(/running/);
  await expect(page.getByTestId('tt-now')).toHaveCount(1);
  await expect(page.locator('.tl-col[data-day="2026-11-04"]').getByTestId('tt-now')).toHaveCount(1);
});

test('navigates by day, week and month, jumps far with the date picker, and back to today', async ({ page }) => {
  await openTracker(page, 'nav');
  await page.getByTestId('tt-view-day').click();
  await expect(page.getByTestId('tt-date-label')).toHaveText('Wednesday, November 4, 2026');
  await page.getByTestId('tt-next').click();
  await expect(page.getByTestId('tt-date-label')).toHaveText('Thursday, November 5, 2026');
  await page.getByTestId('tt-view-week').click();
  await page.getByTestId('tt-prev').click();
  await expect(page.getByTestId('tt-date-label')).toHaveText('Oct 26 – Nov 1, 2026');

  await page.getByTestId('tt-date-label').click();
  const picker = page.getByTestId('tt-datepicker');
  await expect(picker).toBeVisible();
  for (let i = 0; i < 3; i++) await picker.getByRole('button', { name: 'Previous year' }).click();
  await expect(page.getByTestId('tt-datepicker-month')).toHaveText('October 2023');
  await picker.locator('[data-day="2023-10-18"]').click();
  await expect(picker).toBeHidden();
  await expect(page.getByTestId('tt-date-label')).toHaveText('Oct 16 – 22, 2023');

  await page.getByTestId('tt-today').click();
  await expect(page.getByTestId('tt-date-label')).toHaveText('Nov 2 – 8, 2026');
  // Esc closes the picker without changing anything.
  await page.getByTestId('tt-date-label').click();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
});

test('month view shows totals and tag pies per logical day, and opens a day on click', async ({ page }) => {
  await openTracker(page, 'month');
  const a = await createTag(page, 'A', '#1b9e77');
  const b = await createTag(page, 'B', '#d95f02');
  await createBlock(page, DAY_START + H, DAY_START + 4 * H, 'x', [a]);
  await createBlock(page, DAY_START + 5 * H, DAY_START + 6 * H, 'y', [b]);
  // 02:00 on 6 Nov still belongs to the 5 Nov logical day.
  await createBlock(page, DAY_START + 43 * H, DAY_START + 44 * H, 'late');
  await page.getByTestId('tt-view-month').click();
  await expect(page.getByTestId('tt-date-label')).toHaveText('November 2026');
  const wed = page.locator('[data-testid="tt-month-day"][data-day="2026-11-04"]');
  await expect(wed.getByTestId('tt-month-total')).toHaveText('4h 00m');
  await expect(wed.locator('[data-slice]')).toHaveCount(2);
  await expect(page.locator('[data-day="2026-11-05"]').getByTestId('tt-month-total')).toHaveText('1h 00m');
  await expect(page.locator('[data-day="2026-11-06"]').getByTestId('tt-month-total')).toHaveCount(0);
  await expect(page.getByTestId('tt-month-day')).toHaveCount(30);
  await wed.click();
  await expect(page.getByTestId('tt-date-label')).toHaveText('Wednesday, November 4, 2026');
  await expect(page.getByTestId('tt-timeline')).toHaveAttribute('data-days', '1');
});

test('a daylight-saving day shows the repeated hour', async ({ page }) => {
  await openTracker(page, 'dst');
  await page.getByTestId('tt-view-day').click();
  await page.getByTestId('tt-date-label').click();
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.locator('[data-testid="tt-datepicker"] [data-day="2026-10-24"]').click();
  // 07:00 on 24 Oct to 05:00 on 25 Oct: 22 wall-clock hours, 23 real ones (02:00 twice).
  await expect(page.locator('.tl-hour')).toHaveCount(23);
  await expect(page.locator('.tl-hour', { hasText: '02:00' })).toHaveCount(2);
});
