import { expect, test, type Page } from '@playwright/test';

function vaultUrl(name: string): string {
  return `./?opfs=${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A fixed local wall-clock start, so clock times in the tests are predictable. */
const START = new Date(2026, 10, 17, 10, 0, 0);

async function openTimers(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.getByRole('tab', { name: 'Timers' }).click();
  await expect(page.getByTestId('timers-panel')).toBeVisible();
}

function undo(page: Page) {
  return page.locator('[data-panel="timers.history"]').getByTestId('undo').click();
}

async function startTimer(page: Page, when: string, label = ''): Promise<void> {
  await page.getByTestId('timer-when').fill(when);
  if (label) await page.getByTestId('timer-label').fill(label);
  await page.getByTestId('timer-when').press('Enter');
}

test('a length timer counts down, rings once at zero and stays until dismissed', async ({ page }) => {
  await page.clock.install({ time: START });
  await openTimers(page, vaultUrl('length'));
  const panel = page.getByTestId('timers-panel');
  await expect(page.getByTestId('timers-empty')).toBeVisible();

  await page.getByTestId('timer-when').fill('5x');
  await expect(page.getByTestId('timer-preview')).toHaveText('Not a length or a time I can read.');
  await expect(page.getByTestId('timer-start')).toBeDisabled();
  await page.getByTestId('timer-when').fill('1h30');
  await expect(page.getByTestId('timer-preview')).toHaveText('Rings in 1h 30m, at 11:30');

  await startTimer(page, '5m', 'Pasta');
  await expect(page.getByTestId('timer-when')).toHaveValue('');
  await expect(page.getByTestId('timer-label')).toHaveValue('');
  const timer = page.getByTestId('timer');
  await expect(timer.getByTestId('timer-name')).toHaveText('Pasta');
  await expect(timer.getByTestId('timer-countdown')).toHaveText('05:00');
  await expect(timer.getByTestId('timer-ends')).toHaveText('rings 10:05');
  await expect(panel).toHaveAttribute('data-alarm', 'leader');

  await page.clock.fastForward('02:00');
  await expect(timer.getByTestId('timer-countdown')).toHaveText('03:00');
  await expect(panel).toHaveAttribute('data-rings', '0');
  await page.clock.fastForward('03:01');
  await expect(timer).toHaveAttribute('data-state', 'finished');
  await expect(timer.getByTestId('timer-ends')).toHaveText('Finished 10:05');
  await expect(panel).toHaveAttribute('data-rings', '1');

  // It stays, and rings only once.
  await page.clock.fastForward('05:00');
  await expect(timer).toHaveAttribute('data-state', 'finished');
  await expect(panel).toHaveAttribute('data-rings', '1');

  await timer.getByTestId('timer-dismiss').click();
  await expect(page.getByTestId('timers-empty')).toBeVisible();
  // Undo brings it back, finished and silent.
  await undo(page);
  await expect(timer).toHaveAttribute('data-state', 'finished');
  await expect(panel).toHaveAttribute('data-rings', '1');
});

test('clock times ring at the given time, timers list soonest first, cancel removes one', async ({ page }) => {
  await page.clock.install({ time: START });
  await openTimers(page, vaultUrl('clock'));
  await page.getByTestId('timer-when').fill('1:00 am');
  await expect(page.getByTestId('timer-preview')).toHaveText('Rings at tomorrow 01:00, in 15h');
  await page.getByTestId('timer-when').fill('9:00 today');
  await expect(page.getByTestId('timer-preview')).toHaveText('That time has already passed.');

  await startTimer(page, '10:20', 'Call');
  await startTimer(page, '10m');
  await startTimer(page, '13:30 20/11');
  const timers = page.getByTestId('timer');
  await expect(timers).toHaveCount(3);
  await expect(timers.nth(0).getByTestId('timer-ends')).toHaveText('rings 10:10');
  await expect(timers.nth(1).getByTestId('timer-ends')).toHaveText('rings 10:20');
  await expect(timers.nth(1).getByTestId('timer-countdown')).toHaveText('20:00');
  await expect(timers.nth(2).getByTestId('timer-ends')).toHaveText('rings Fri, Nov 20 13:30');
  await expect(timers.nth(2).getByTestId('timer-countdown')).toHaveText('3d 03:30:00');

  await timers.nth(1).getByTestId('timer-cancel').click();
  await expect(timers).toHaveCount(2);
  await expect(page.getByTestId('timer-name')).toHaveCount(0);
});

test('quick timers: save a length with its name and sound, start it with one click, remove it', async ({ page }) => {
  await page.clock.install({ time: START });
  await openTimers(page, vaultUrl('quick'));
  await expect(page.getByTestId('quick-empty')).toBeVisible();

  // Only lengths can be saved.
  await page.getByTestId('timer-when').fill('13:30');
  await expect(page.getByTestId('timer-save')).toBeDisabled();
  await page.getByTestId('timer-when').fill('3m');
  await page.getByTestId('timer-label').fill('Egg');
  await page.getByTestId('timer-sound').selectOption('chime-soft');
  await page.getByTestId('timer-save').click();
  await expect(page.getByTestId('timer-save')).toHaveText('On the quick list');
  await expect(page.getByTestId('timer-save')).toBeDisabled();
  await page.getByTestId('timer-when').fill('1m');
  await page.getByTestId('timer-label').fill('');
  await page.getByTestId('timer-save').click();
  // Saving does not start anything.
  await expect(page.getByTestId('timer')).toHaveCount(0);

  const quick = page.getByTestId('quick-timer');
  const quickNames = page.getByTestId('quick-start');
  await expect(quickNames).toHaveText(['1m', '3m Egg']);
  await quick.nth(1).getByTestId('quick-start').click();
  const timer = page.getByTestId('timer');
  await expect(timer.getByTestId('timer-name')).toHaveText('Egg');
  await expect(timer.getByTestId('timer-countdown')).toHaveText('03:00');

  await quick.nth(1).hover();
  await quick.nth(1).getByTestId('quick-delete').click();
  await expect(quickNames).toHaveText(['1m']);
  // Removing a quick timer leaves its running timer alone; undo brings it back.
  await expect(timer).toHaveCount(1);
  await undo(page);
  await expect(quickNames).toHaveText(['1m', '3m Egg']);
});

test('only one window per browser rings, and another takes over when it closes', async ({ context }) => {
  const url = vaultUrl('windows');
  const a = await context.newPage();
  await a.clock.install({ time: START });
  await openTimers(a, url);
  await startTimer(a, '1m', 'First');
  await expect(a.getByTestId('timers-panel')).toHaveAttribute('data-alarm', 'leader');

  const b = await context.newPage();
  await b.clock.install({ time: START });
  await openTimers(b, url);
  await expect(b.getByTestId('timer-name')).toHaveText('First');
  await expect(b.getByTestId('timers-audio-locked')).toHaveCount(0);
  await expect(b.getByTestId('timers-panel')).toHaveAttribute('data-alarm', 'follower');

  await a.clock.fastForward('01:01');
  await b.clock.fastForward('01:01');
  await expect(a.getByTestId('timer')).toHaveAttribute('data-state', 'finished');
  await expect(b.getByTestId('timer')).toHaveAttribute('data-state', 'finished');
  await expect(a.getByTestId('timers-panel')).toHaveAttribute('data-rings', '1');
  await expect(b.getByTestId('timers-panel')).toHaveAttribute('data-rings', '0');

  await a.close();
  await expect(b.getByTestId('timers-panel')).toHaveAttribute('data-alarm', 'leader');
  await startTimer(b, '30s', 'Second');
  await b.clock.fastForward('00:31');
  await expect(b.getByTestId('timers-panel')).toHaveAttribute('data-rings', '1');
});
