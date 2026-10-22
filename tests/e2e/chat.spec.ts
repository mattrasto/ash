import { test, expect } from '../support/fixtures.ts';
import { desktop, request } from '../support/desktop.ts';
import type { PreviewInfo } from '../../packages/shared/src/index.ts';
import { fileURLToPath } from 'node:url';

test('chat-persistence: Keyboard messages and drafts survive desktop reopening', async ({ ash, instance }, testInfo) => {
  const { page } = ash;
  const message = page.getByLabel('Message', { exact: true });
  await message.fill('Saved by the acceptance scenario');
  await message.press('Tab');
  await expect(page.getByRole('button', { name: 'Record screen', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Attach images or videos', exact: true })).toBeFocused();
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

test('chat-layout: Thread layout at normal and minimum window sizes', async ({ ash }) => {
  const { page, app } = ash;
  // Static baselines exclude entry/stream animation timing; integration tests cover motion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('Message', { exact: true }).fill('Hello Ash.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('run-status')).toHaveText('completed');
  await expect(page.getByTestId('message')).toHaveCount(2);
  await page.getByLabel('Message', { exact: true }).fill('A saved draft');
  await expect(page.getByRole('heading',{name:'Hello Ash.',exact:true})).toBeVisible();
  await expect(page.getByTestId('thread-event')).toHaveCount(1);
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


test('desktop-background: Hidden windows support interaction without native focus', async ({ ash, instance }, testInfo) => {
  const { app, page } = ash;
  const info = await (await request(instance, '/api/info')).json() as PreviewInfo;
  const branch = info.source!.branch ?? `Detached · ${info.source!.revision}`;
  await expect(page.getByLabel('Preview identity')).toBeVisible();
  await expect(page.getByTestId('preview-branch')).toHaveText(branch);
  await expect(page.getByTestId('preview-worktree')).toHaveText(instance.checkout.split('/').slice(-2).join('/'));
  await expect(page.getByTestId('preview-worktree')).toHaveAttribute('title', new RegExp(instance.workspaceId));
  const nativeState = () => app.evaluate(({ app, BrowserWindow }) => ({
    windows: BrowserWindow.getAllWindows().map(win => ({
      visible: win.isVisible(), focused: win.isFocused(), focusable: win.isFocusable(), fullscreen: win.isFullScreen(),
    })),
    dockVisible: process.platform === 'darwin' ? app.dock!.isVisible() : false,
  }));
  const expected = { windows: [{ visible: false, focused: false, focusable: false, fullscreen: false }], dockVisible: false };
  expect(await nativeState()).toEqual(expected);
  await page.getByLabel('Message', { exact: true }).fill('Sent from a hidden test window');
  await page.getByLabel('Message', { exact: true }).press('Enter');
  await expect(page.getByTestId('run-status')).toHaveText('completed');
  await page.getByRole('button', { name: 'Inspect Ash response', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Captured model request' })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 700));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(900);
  await testInfo.attach('hidden-window', { body: await page.screenshot(), contentType: 'image/png' });
  await page.reload();
  await expect(page.getByTestId('message')).toHaveCount(2);
  await expect(page.getByTestId('preview-branch')).toHaveText(branch);
  expect(await nativeState()).toEqual(expected);
});
