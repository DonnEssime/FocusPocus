import { expect, test, type Page } from '@playwright/test';

/**
 * The native folder dialog cannot be automated, so `showDirectoryPicker` is replaced by a stub
 * that returns a fresh directory in the browser's private file system (same handle type).
 */
async function stubPicker(page: Page, mode: 'empty' | 'nonEmpty' | 'cancel'): Promise<void> {
  await page.addInitScript((mode) => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => {
      if (mode === 'cancel') throw new DOMException('The user aborted a request.', 'AbortError');
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(`picked-${Date.now()}-${Math.random().toString(36).slice(2)}`, { create: true });
      if (mode === 'nonEmpty') {
        const file = await dir.getFileHandle('notes.txt', { create: true });
        const w = await file.createWritable();
        await w.write('hello');
        await w.close();
      }
      return dir;
    };
  }, mode);
  await page.goto('./');
  await page.getByRole('button', { name: /Open or create a vault folder/ }).click();
}

test('picking an empty folder creates and opens a vault', async ({ page }) => {
  await stubPicker(page, 'empty');
  await expect(page.getByTestId('tt-timeline')).toBeVisible();
  await expect(page.getByTestId('vault-name')).toContainText('picked-');
});

test('picking a non-empty folder explains why it cannot be used', async ({ page }) => {
  await stubPicker(page, 'nonEmpty');
  await expect(page.getByRole('alert')).toHaveText(/not empty and is not a FocusPocus vault/);
});

test('cancelling the picker says so instead of doing nothing', async ({ page }) => {
  await stubPicker(page, 'cancel');
  await expect(page.getByRole('alert')).toHaveText(/No folder was opened/);
});

test('inside an embedded frame (e.g. VS Code Simple Browser) it says to open the page in Chrome', async ({ page }) => {
  await page.goto('./');
  await page.setContent(`<iframe src="${page.url()}" style="width:800px;height:600px"></iframe>`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByTestId('picker-embedded')).toBeVisible();
  await expect(frame.getByRole('button', { name: /Open or create/ })).toHaveCount(0);
});
