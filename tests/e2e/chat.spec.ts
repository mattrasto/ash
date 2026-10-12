import { test, expect } from '../support/fixtures.ts';
import { desktop } from '../support/desktop.ts';
import { fileURLToPath } from 'node:url';

test('chat-persistence: Keyboard messages and drafts survive desktop reopening', async ({ ash, instance }, testInfo) => {
  const { page } = ash;
  const message = page.getByLabel('Message', { exact: true });
  await message.fill('Saved by the acceptance scenario');
  await message.press('Tab');
  await expect(page.getByRole('button', { name: 'Attach images', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('run-status')).toHaveText('completed');
  await expect(page.getByTestId('message')).toHaveCount(2);
  await message.fill('A draft for the next visit');
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await page.reload();
  await expect(message).toHaveValue('A draft for the next visit');
  await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeVisible();
  await testInfo.attach('before-reopen', { body: await page.screenshot(), contentType: 'image/png' });
  const trace = testInfo.outputPath('before-reopen.zip');
  await ash.app.context().tracing.stop({ path: trace });
  await testInfo.attach('before-reopen-trace', { path: trace, contentType: 'application/zip' });
  await ash.app.close();
  const reopened = await desktop(instance);
  try {
    await expect(reopened.page.getByLabel('Message', { exact: true })).toHaveValue('A draft for the next visit');
    await expect(reopened.page.getByTestId('message')).toHaveCount(2);
    await expect(reopened.page.getByTestId('run-status')).toHaveText('completed');
    await expect(reopened.page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeVisible();
    await reopened.page.getByRole('button', { name: 'Inspect Ash response', exact: true }).click();
    await expect(reopened.page.getByRole('heading', { name: 'Captured model request' })).toBeVisible();
    expect(reopened.errors).toEqual([]);
  } finally {
    try { await testInfo.attach('after-reopen', { body: await reopened.page.screenshot(), contentType: 'image/png' }); }
    finally { await reopened.app.close(); }
  }
});

test('chat-layout: Conversation layout at normal and minimum window sizes', async ({ ash }) => {
  const { page, app } = ash;
  await page.getByLabel('Message', { exact: true }).fill('Hello Ash.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('run-status')).toHaveText('completed');
  await expect(page.getByTestId('message')).toHaveCount(2);
  await page.getByLabel('Message', { exact: true }).fill('A saved draft');
  await page.mouse.move(1, 1);
  for (const [width, height] of [[1040, 830], [740, 650]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot(`chat-${width}.png`, {
      stylePath: fileURLToPath(new URL('../support/visual.css', import.meta.url)),
    });
  }
});
