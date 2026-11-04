import { expect, test, type Page } from '@playwright/test';
import { createBlock, dispatch, H, openTracker } from './helpers/timetrack';

test.use({ timezoneId: 'Europe/Brussels' });

/** 07:00 Brussels on Wednesday 4 Nov 2026 (today in these tests; now is 14:30). */
const D4 = Date.UTC(2026, 10, 4, 6);

async function enableTargets(page: Page): Promise<void> {
  await page.getByTestId('module-settings').click();
  await page.getByTestId('tt-targets-enabled').check();
  await page.getByTestId('settings-close').click();
}

async function setTarget(page: Page, opener: ReturnType<Page['getByTestId']>, text: string): Promise<void> {
  await opener.click();
  const input = page.getByTestId('tt-target-input');
  await input.fill(text);
  await input.press('Enter');
  await expect(page.getByTestId('tt-target-popover')).toBeHidden();
}

const weekBalance = (page: Page, day: string) => page.locator(`[data-testid="tt-day-balance"][data-day="${day}"]`);

test('targets are hidden until switched on; switching off hides but keeps them', async ({ page }) => {
  await openTracker(page, 'targets-toggle');
  await expect(page.getByTestId('tt-day-balance')).toHaveCount(0);
  await expect(page.getByTestId('tt-target-stats')).toHaveCount(0);
  await enableTargets(page);
  await expect(page.getByTestId('tt-day-balance')).toHaveCount(7);
  await expect(page.getByTestId('tt-target-stats')).toBeVisible();
  await setTarget(page, weekBalance(page, '2026-11-03'), '100%');
  await expect(weekBalance(page, '2026-11-03')).toHaveText('−8:00');

  await page.getByTestId('module-settings').click();
  await page.getByTestId('tt-targets-enabled').uncheck();
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('tt-day-balance')).toHaveCount(0);
  await expect(page.getByTestId('tt-target-stats')).toHaveCount(0);
  await enableTargets(page);
  await expect(weekBalance(page, '2026-11-03')).toHaveText('−8:00');
});

test('the Day view chip sets targets by shortcut or typed hh:mm / %, and refuses nonsense', async ({ page }) => {
  await openTracker(page, 'targets-day');
  await createBlock(page, D4 + H, D4 + 3 * H, 'Work'); // 2 h tracked today
  await enableTargets(page);
  await page.getByTestId('tt-view-day').click();
  const chip = page.getByTestId('tt-target-chip');
  await expect(chip).toHaveText('Target 0:00 · 2:00 tracked · +2:00');

  await chip.click();
  await page.getByTestId('tt-target-100').click();
  await expect(chip).toHaveText('Target 8:00 · 2:00 tracked · −6:00');
  await chip.click();
  await page.getByTestId('tt-target-50').click();
  await expect(chip).toContainText('Target 4:00');
  await setTarget(page, chip, '6:30');
  await expect(chip).toContainText('Target 6:30');
  await setTarget(page, chip, '62.5%');
  await expect(chip).toContainText('Target 5:00');

  await chip.click();
  await expect(page.getByTestId('tt-target-input')).toHaveValue('62.5%');
  await page.getByTestId('tt-target-input').fill('lots');
  await page.getByTestId('tt-target-input').press('Enter');
  await expect(page.getByTestId('tt-target-error')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chip).toContainText('Target 5:00');

  await chip.click();
  await page.getByTestId('tt-target-0').click();
  await expect(chip).toContainText('Target 0:00');
  await page.getByTestId('undo').click();
  await expect(chip).toContainText('Target 5:00');

  // A future day shows only its target.
  await page.getByTestId('tt-next').click();
  await expect(chip).toHaveText('Target 0:00');
});

test('changing full-time hours asks: going forward keeps the past, retroactively changes it', async ({ page }) => {
  await openTracker(page, 'targets-fulltime');
  await dispatch(page, 'tt.SetTargetSettings', { enabled: true });
  await dispatch(page, 'tt.SetDayTarget', { day: '2026-11-02', target: { percent: 100 } });
  await dispatch(page, 'tt.SetDayTarget', { day: '2026-11-03', target: { ms: 3 * H } });
  await dispatch(page, 'tt.SetDayTarget', { day: '2026-11-04', target: { percent: 100 } });
  const settings = async () => page.getByTestId('module-settings').click();
  const fulltime = page.getByTestId('tt-fulltime');

  await settings();
  await fulltime.fill('6:00');
  await fulltime.press('Enter');
  await expect(page.getByTestId('tt-fulltime-apply')).toContainText('from 8:00 to 6:00');
  await page.getByTestId('tt-apply-cancel').click();
  await expect(fulltime).toHaveValue('8:00');
  await expect(page.getByTestId('settings-dialog')).toBeVisible(); // only the question closed

  await fulltime.fill('6:00');
  await fulltime.press('Enter');
  await page.getByTestId('tt-apply-forward').click();
  await expect(page.getByTestId('tt-fulltime-since')).toContainText('Nov 4, 2026');
  await page.getByTestId('settings-close').click();
  await expect(weekBalance(page, '2026-11-02')).toHaveText('−8:00');
  await expect(weekBalance(page, '2026-11-03')).toHaveText('−3:00');
  await expect(weekBalance(page, '2026-11-04')).toHaveText('−6:00');

  await settings();
  await fulltime.fill('7:00');
  await fulltime.press('Enter');
  await page.getByTestId('tt-apply-all').click();
  await expect(page.getByTestId('tt-fulltime-since')).toHaveCount(0);
  await page.getByTestId('settings-close').click();
  await expect(weekBalance(page, '2026-11-02')).toHaveText('−7:00');
  await expect(weekBalance(page, '2026-11-03')).toHaveText('−3:00'); // hh:mm: never changes
  await expect(weekBalance(page, '2026-11-04')).toHaveText('−7:00');
  await page.getByTestId('undo').click();
  await expect(weekBalance(page, '2026-11-02')).toHaveText('−8:00');
});

test('statistics: balance of the shown range (up to today) and over the chosen interval', async ({ page }) => {
  await openTracker(page, 'targets-stats');
  await dispatch(page, 'tt.SetTargetSettings', { enabled: true });
  await dispatch(page, 'tt.SetDayTarget', { day: '2026-10-30', target: { percent: 100 } }); // last week
  await dispatch(page, 'tt.SetDayTarget', { day: '2026-11-02', target: { percent: 100 } });
  await dispatch(page, 'tt.SetDayTarget', { day: '2026-11-06', target: { percent: 100 } }); // future
  await createBlock(page, D4 - 48 * H + H, D4 - 48 * H + 10 * H); // Monday: 9 h
  await createBlock(page, D4 + H, D4 + 2 * H); // today: 1 h

  const range = page.getByTestId('tt-range-balance');
  await expect(range).toContainText('10:00 of 8:00');
  await expect(page.getByTestId('tt-range-balance-value')).toHaveText('+2:00');
  const overall = page.getByTestId('tt-overall-balance');
  await expect(overall).toHaveText('−6:00'); // since 30 Oct: 10 h tracked, 16 h target
  await expect(page.getByTestId('tt-interval-days')).toHaveText('Counting Oct 30, 2026 to Nov 4, 2026.');

  // Move the start ("zero out" the older deficit), then look at a past interval only.
  await page.getByTestId('tt-interval-from').click();
  await page.locator('#tt-interval-from-popover [data-day="2026-11-01"]').click();
  await expect(overall).toHaveText('+2:00');
  await page.getByTestId('tt-interval-to').click();
  await page.locator('#tt-interval-to-popover [data-day="2026-11-02"]').click();
  await expect(overall).toHaveText('+1:00');
  await expect(page.getByTestId('tt-interval-to')).toHaveText('Nov 2, 2026');
  await page.getByTestId('tt-interval-to').click();
  await page.getByTestId('tt-interval-now').click();
  await page.getByTestId('tt-interval-from').click();
  await page.getByTestId('tt-interval-beginning').click();
  await expect(overall).toHaveText('−6:00');

  // A wholly future range has nothing to count.
  await page.getByTestId('tt-next').click();
  await expect(range).toContainText('still ahead');
});
