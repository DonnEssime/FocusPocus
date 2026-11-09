import { expect, test } from '@playwright/test';
import { createBlock, H, openTracker, waitSaved } from './helpers/timetrack';

test.use({ timezoneId: 'Europe/Brussels' });

const DAY_START = Date.UTC(2026, 10, 4, 6);

test('adds tags with Dark2 defaults, refuses duplicate names, renames and describes them', async ({ page }) => {
  await openTracker(page, 'tags');
  const tags = page.getByTestId('tt-tag');
  await page.getByTestId('tt-tag-new').fill('Deep work');
  await page.getByTestId('tt-tag-new').press('Enter');
  await page.getByTestId('tt-tag-new').fill('Admin');
  await page.getByTestId('tt-tag-add').click();
  await expect(tags).toHaveCount(2);
  await expect(tags.nth(0).getByTestId('tt-tag-color')).toHaveCSS('background-color', 'rgb(27, 158, 119)');
  await expect(tags.nth(1).getByTestId('tt-tag-color')).toHaveCSS('background-color', 'rgb(217, 95, 2)');

  await page.getByTestId('tt-tag-new').fill(' deep WORK ');
  await page.getByTestId('tt-tag-new').press('Enter');
  await expect(page.getByTestId('tt-tag-error')).toContainText('already exists');
  await expect(tags).toHaveCount(2);

  const name = tags.nth(1).getByTestId('tt-tag-name');
  await name.fill('Deep work');
  await name.press('Enter');
  await expect(page.locator('.toast')).toContainText('already exists');
  await expect(name).toHaveValue('Admin');
  await name.fill('Email');
  await name.press('Enter');
  await tags.nth(1).getByTestId('tt-tag-description').fill('Inbox zero');
  await tags.nth(1).getByTestId('tt-tag-description').press('Enter');

  await waitSaved(page);
  await page.reload();
  await expect(tags.nth(1).getByTestId('tt-tag-name')).toHaveValue('Email');
  await expect(tags.nth(1).getByTestId('tt-tag-description')).toHaveValue('Inbox zero');
});

test('changes a colour with a quick pick or the hex field, committing once on close', async ({ page }) => {
  await openTracker(page, 'colors');
  await page.getByTestId('tt-tag-new').fill('A');
  await page.getByTestId('tt-tag-new').press('Enter');
  const swatch = page.getByTestId('tt-tag-color');
  await swatch.click();
  const picker = page.getByTestId('tt-colorpicker');
  await expect(picker).toBeVisible();
  await picker.locator('[data-color="#e7298a"]').click();
  await expect(swatch).toHaveCSS('background-color', 'rgb(231, 41, 138)'); // live preview
  await picker.getByTestId('tt-color-hex').fill('#123456');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(swatch).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  // Several changes in one popover visit are one undo step.
  await page.getByTestId('undo').filter({ visible: true }).click();
  await expect(swatch).toHaveCSS('background-color', 'rgb(27, 158, 119)');
});

test('the colour wheel picks a hue and saturation', async ({ page }) => {
  await openTracker(page, 'wheel');
  await page.getByTestId('tt-tag-new').fill('A');
  await page.getByTestId('tt-tag-new').press('Enter');
  await page.getByTestId('tt-tag-color').click();
  const canvas = page.locator('.colorwheel canvas');
  const box = (await canvas.boundingBox())!;
  // Straight up at full radius is pure red (hue 0), at full brightness.
  await page.getByRole('slider', { name: 'Brightness' }).fill('100');
  await page.mouse.click(box.x + box.width / 2, box.y + 1);
  await expect(page.getByTestId('tt-color-hex')).toHaveValue(/^#f[0-9a-f]0[0-9a-f]0[0-9a-f]$/);
});

test('deleting a tag removes it from blocks; undo brings it back everywhere', async ({ page }) => {
  await openTracker(page, 'delete');
  await page.getByTestId('tt-tag-new').fill('Deep work');
  await page.getByTestId('tt-tag-new').press('Enter');
  const tagId = await page.getByTestId('tt-tag').getAttribute('data-tag-id');
  await createBlock(page, DAY_START + 2 * H, DAY_START + 3 * H, 'Report', [tagId!]);
  const block = page.getByTestId('tt-block');
  await expect(block).toContainText('Deep work');
  await page.getByTestId('tt-tag-delete').click();
  await expect(page.getByTestId('tt-tag')).toHaveCount(0);
  await expect(block).not.toContainText('Deep work');
  await page.getByTestId('undo').filter({ visible: true }).click();
  await expect(page.getByTestId('tt-tag')).toHaveCount(1);
  await expect(block).toContainText('Deep work');
});
