import { expect, test, type Page } from '@playwright/test';

function vaultUrl(name: string): string {
  return `./?opfs=${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function openFocus(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.getByRole('tab', { name: 'Focus' }).click();
  await expect(page.getByTestId('focus-countdown')).toBeVisible();
}

test('bundled sounds decode in the browser with their exact lengths', async ({ page }) => {
  await page.goto(vaultUrl('decode'));
  const durations = await page.evaluate(async () => {
    const ids = ['clock-tick', 'rainforest-rain', 'bell-single', 'bell-triple', 'chime-soft'];
    const out: Record<string, number> = {};
    for (const id of ids) {
      const bytes = await (await fetch(`/FocusPocus/src/modules/focus/sounds/${id}.ogg`)).arrayBuffer();
      out[id] = (await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(bytes)).duration;
    }
    return out;
  });
  expect(durations['clock-tick']).toBeCloseTo(2, 2);
  expect(durations['rainforest-rain']).toBeCloseTo(24, 2);
  for (const id of ['bell-single', 'bell-triple', 'chime-soft']) expect(durations[id]).toBeCloseTo(4.5, 2);
});

test('start counts down with sound, stop resets silently', async ({ page }) => {
  await page.clock.install();
  await openFocus(page, vaultUrl('startstop'));
  const countdown = page.getByTestId('focus-countdown');
  const toggle = page.getByTestId('focus-toggle');
  const timer = page.locator('.timer');

  await expect(countdown).toHaveText('25:00');
  await toggle.click();
  await expect(toggle).toHaveText('Stop');
  await expect(timer).toHaveAttribute('data-audio', 'playing');
  await page.clock.fastForward('01:01');
  await expect(countdown).toHaveText('23:59');
  // Start/Stop are not undoable.
  await expect(page.getByTestId('undo')).toBeDisabled();

  await toggle.click();
  await expect(toggle).toHaveText('Start');
  await expect(countdown).toHaveText('25:00');
  await expect(timer).toHaveAttribute('data-audio', 'idle');
});

test('the timer resets at zero, and other windows show it silently', async ({ context }) => {
  const url = vaultUrl('finish');
  const a = await context.newPage();
  await a.clock.install();
  await openFocus(a, url);
  await a.getByRole('tab', { name: 'Settings' }).last().click();
  await a.getByTestId('focus-duration').fill('1');
  await a.getByTestId('focus-duration').press('Enter');
  await a.getByRole('tab', { name: 'Timer' }).click();
  await expect(a.getByTestId('focus-countdown')).toHaveText('01:00');
  await a.getByTestId('focus-toggle').click();

  const b = await context.newPage();
  await openFocus(b, url);
  await expect(b.getByTestId('focus-toggle')).toHaveText('Stop');
  await expect(b.getByTestId('focus-silent')).toBeVisible();
  await expect(b.locator('.timer')).toHaveAttribute('data-audio', 'silent');

  await a.clock.fastForward('00:30');
  await expect(a.getByTestId('focus-countdown')).toHaveText('00:30');
  await a.clock.fastForward('00:31');
  await expect(a.getByTestId('focus-toggle')).toHaveText('Start');
  await expect(a.getByTestId('focus-countdown')).toHaveText('01:00');
});

test('settings: choosing sounds is saved and undoable, settings changes do not affect a running timer', async ({ page }) => {
  await page.clock.install();
  await openFocus(page, vaultUrl('settings'));
  await page.getByRole('tab', { name: 'Settings' }).last().click();
  await page.getByTestId('focus-ticking').selectOption('rainforest-rain');
  await page.getByTestId('focus-finishing').selectOption('chime-soft');
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('focus-finishing')).toHaveValue('bell-single');
  await expect(page.getByTestId('focus-ticking')).toHaveValue('rainforest-rain');

  await page.getByRole('tab', { name: 'Timer' }).click();
  await page.getByTestId('focus-toggle').click();
  await page.getByRole('tab', { name: 'Settings' }).last().click();
  await page.getByTestId('focus-duration').fill('5');
  await page.getByTestId('focus-duration').press('Enter');
  await page.getByRole('tab', { name: 'Timer' }).click();
  await page.clock.fastForward('00:10');
  await expect(page.getByTestId('focus-countdown')).toHaveText('24:50');
});
