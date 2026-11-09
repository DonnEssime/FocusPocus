import { expect, test, type Page } from '@playwright/test';
import { vaultUrl, waitSaved } from './helpers/timetrack';

async function openTodos(page: Page, name: string): Promise<void> {
  await page.goto(vaultUrl(name));
  await page.getByRole('tab', { name: 'To-dos' }).click();
  await page.getByTestId('todo-panel').waitFor();
}

/** The Undo button of the visible tab (hidden tabs stay mounted). */
const undo = (page: Page) => page.getByTestId('undo').filter({ visible: true }).click();

/** The `<li>` of the item with this exact title. */
const item = (page: Page, title: string) =>
  page.getByTestId('todo-item').filter({ has: page.getByTestId('todo-title').getByText(title, { exact: true }) }).last();

/** Titles of the direct children of `parent` (or the top level), in order. */
async function titles(page: Page, parent?: string): Promise<string[]> {
  const scope = parent ? item(page, parent).locator('> ul > li > .todo-row') : page.locator('.todo-roots > li > .todo-row');
  return scope.locator('.todo-title-text').allTextContents();
}

test('builds a tree with new items on top, keeps it after a reload, and shows no duplicate header', async ({ page }) => {
  await openTodos(page, 'todo-tree');
  await expect(page.getByTestId('todo-empty')).toBeVisible();
  // The tab already says "To-dos": the list panel has no header of its own.
  await expect(page.locator('[data-panel="todo.list"] .panel-title')).toHaveCount(0);
  const add = page.getByTestId('todo-new');
  await add.fill('Groceries');
  await add.press('Enter');
  await add.fill('Taxes');
  await page.getByTestId('todo-add').click();
  expect(await titles(page)).toEqual(['Taxes', 'Groceries']);

  // "+" opens an inline field; Enter adds and keeps it open for the next one.
  await item(page, 'Groceries').hover();
  await item(page, 'Groceries').getByTestId('todo-add-child').first().click();
  const child = page.getByTestId('todo-new-child');
  await expect(child).toBeFocused();
  await child.fill('Milk');
  await child.press('Enter');
  await child.fill('Bread');
  await child.press('Enter');
  await child.press('Escape');
  await expect(child).toHaveCount(0);
  expect(await titles(page, 'Groceries')).toEqual(['Bread', 'Milk']);

  // A leaf becomes a parent; blurring the field keeps what was typed.
  await item(page, 'Milk').hover();
  await item(page, 'Milk').getByTestId('todo-add-child').click();
  await page.getByTestId('todo-new-child').fill('Oat milk');
  await page.getByTestId('todo-new').click();
  expect(await titles(page, 'Milk')).toEqual(['Oat milk']);

  await waitSaved(page);
  await page.reload();
  await page.getByRole('tab', { name: 'To-dos' }).click();
  expect(await titles(page)).toEqual(['Taxes', 'Groceries']);
  expect(await titles(page, 'Milk')).toEqual(['Oat milk']);
});

test('collapses, finishes, deletes a subtree and undoes', async ({ page }) => {
  await openTodos(page, 'todo-actions');
  const add = page.getByTestId('todo-new');
  await add.fill('Project');
  await add.press('Enter');
  await item(page, 'Project').hover();
  await item(page, 'Project').getByTestId('todo-add-child').click();
  for (const t of ['Design', 'Build']) {
    await page.getByTestId('todo-new-child').fill(t);
    await page.getByTestId('todo-new-child').press('Enter');
  }
  await page.getByTestId('todo-new-child').press('Escape');

  const toggle = item(page, 'Project').getByTestId('todo-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(item(page, 'Design')).toHaveCount(0);
  await expect(item(page, 'Project')).toContainText('2 hidden');
  await toggle.click();
  await expect(item(page, 'Design')).toBeVisible();
  // Leaves have no arrow.
  await expect(item(page, 'Design').getByTestId('todo-toggle')).toHaveCount(0);

  const done = item(page, 'Design').getByTestId('todo-done');
  await item(page, 'Design').hover();
  await done.click();
  await expect(done).toHaveAttribute('aria-pressed', 'true');
  await expect(item(page, 'Design').locator('.todo-title-text')).toHaveCSS('text-decoration-line', 'line-through');

  await item(page, 'Project').locator('> .todo-row').hover();
  await item(page, 'Project').locator('> .todo-row').getByTestId('todo-delete').click();
  await expect(page.getByTestId('todo-item')).toHaveCount(0);
  await undo(page);
  await expect(page.getByTestId('todo-item')).toHaveCount(3);
  await expect(item(page, 'Design').getByTestId('todo-done')).toHaveAttribute('aria-pressed', 'true');
});

test('clicking a to-do opens its notes; save is one undo step, cancel changes nothing', async ({ page }) => {
  await openTodos(page, 'todo-notes');
  await page.getByTestId('todo-new').fill('Write report');
  await page.getByTestId('todo-new').press('Enter');

  await item(page, 'Write report').getByTestId('todo-title').click();
  const dialog = page.getByTestId('todo-dialog');
  await expect(dialog).toBeVisible();
  const notes = dialog.getByTestId('todo-dialog-notes');
  await expect(notes).toBeFocused();
  await notes.fill('Intro\nResults');
  await dialog.getByTestId('todo-dialog-title').fill('Write the report');
  await notes.press('Control+Enter');
  await expect(dialog).toBeHidden();
  await expect(item(page, 'Write the report').getByTestId('todo-has-notes')).toBeVisible();

  await item(page, 'Write the report').getByTestId('todo-title').click();
  await expect(notes).toHaveValue('Intro\nResults');
  await notes.fill('discard me');
  await dialog.getByTestId('todo-dialog-cancel').click();
  await expect(dialog).toBeHidden();

  await undo(page);
  await expect(item(page, 'Write report')).toBeVisible();
  await expect(item(page, 'Write report').getByTestId('todo-has-notes')).toHaveCount(0);
});

/** Seeds top-level items through the dev hook; returns their ids by title. */
async function seed(page: Page, items: Array<[title: string, parent?: string]>): Promise<Record<string, string>> {
  return page.evaluate((items) => {
    const hook = (window as unknown as { __focuspocus: { dispatch(a: unknown): { ok: boolean }; commands(): { id: string }[] } })
      .__focuspocus;
    const ids: Record<string, string> = {};
    for (const [title, parent] of items) {
      const parentId = parent ? ids[parent]! : null;
      if (!hook.dispatch({ t: 'todo.Create', p: { parentId, title }, deps: parentId ? [parentId] : [] }).ok) throw new Error(title);
      ids[title] = hook.commands().at(-1)!.id;
    }
    return ids;
  }, items);
}

test('reorders siblings by dragging and with Alt+arrows, one undo step each', async ({ page }) => {
  await openTodos(page, 'todo-reorder');
  await seed(page, [['d'], ['c'], ['b'], ['a'], ['a2', 'a'], ['a1', 'a']]);
  expect(await titles(page)).toEqual(['a', 'b', 'c', 'd']);

  const row = (t: string) => item(page, t).locator('> .todo-row');
  // Drop on the lower half of "c": lands after it.
  await row('a').dragTo(row('c'), { targetPosition: { x: 40, y: 24 } });
  expect(await titles(page)).toEqual(['b', 'c', 'a', 'd']);
  // Drop on the upper half of "b": lands before it.
  await row('d').dragTo(row('b'), { targetPosition: { x: 40, y: 4 } });
  expect(await titles(page)).toEqual(['d', 'b', 'c', 'a']);
  // A child cannot be dropped among its parent's siblings.
  await row('a1').dragTo(row('d'), { targetPosition: { x: 40, y: 4 } });
  expect(await titles(page)).toEqual(['d', 'b', 'c', 'a']);
  expect(await titles(page, 'a')).toEqual(['a1', 'a2']);

  // Keyboard: focus stays on the moved item, so it can be pushed several places.
  await row('d').getByTestId('todo-title').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  expect(await titles(page)).toEqual(['b', 'c', 'd', 'a']);
  await expect(row('d').getByTestId('todo-title')).toBeFocused();

  await undo(page);
  expect(await titles(page)).toEqual(['b', 'd', 'c', 'a']);
  await waitSaved(page);
  await page.reload();
  await page.getByRole('tab', { name: 'To-dos' }).click();
  expect(await titles(page)).toEqual(['b', 'd', 'c', 'a']);
});

test('undo opens exactly the collapsed parents that hide the changed item', async ({ page }) => {
  await openTodos(page, 'todo-reveal');
  await seed(page, [['Other'], ['Top'], ['Middle', 'Top'], ['Leaf', 'Middle'], ['Sibling', 'Other'], ['Deep', 'Sibling']]);
  await item(page, 'Leaf').getByTestId('todo-title').click();
  await page.getByTestId('todo-dialog-notes').fill('note');
  await page.getByTestId('todo-dialog-save').click();
  // Hide Leaf two levels deep; also collapse an unrelated branch.
  for (const t of ['Middle', 'Top', 'Sibling']) await item(page, t).locator('> .todo-row').getByTestId('todo-toggle').click();
  await expect(item(page, 'Leaf')).toHaveCount(0);

  await undo(page);
  await expect(item(page, 'Leaf')).toBeVisible();
  await expect(item(page, 'Leaf').getByTestId('todo-has-notes')).toHaveCount(0);
  // Only the parents in the way were opened.
  await expect(item(page, 'Sibling').locator('> .todo-row').getByTestId('todo-toggle')).toHaveAttribute('aria-expanded', 'false');

  // Redo works through the same path, and the collapse changes did not cut off the redo.
  await item(page, 'Top').locator('> .todo-row').getByTestId('todo-toggle').click();
  await page.getByTestId('redo').filter({ visible: true }).click();
  await expect(item(page, 'Leaf').getByTestId('todo-has-notes')).toBeVisible();
});
