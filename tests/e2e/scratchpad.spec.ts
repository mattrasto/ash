import { test, expect } from '../support/fixtures.ts';
import { desktop } from '../support/desktop.ts';
import { fileURLToPath } from 'node:url';

test('scratchpad-persistence: Keyboard edits survive desktop reopening', async ({ ash, instance }, testInfo) => {
  const { page } = ash;
  const note = page.getByLabel('A note for this preview');
  await note.focus();
  await note.fill('Saved by the acceptance scenario');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Save note', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Saved in this preview', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add a marker' }).click();
  await expect(page.getByTestId('count')).toHaveText('1');
  await page.getByText('File and client storage checks', { exact: true }).click();
  await page.getByLabel('Local file note').fill('File storage also survives');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await expect(page.getByText('Saved in this preview', { exact: true })).toBeVisible();
  await page.getByLabel('Compact scratchpad', { exact: false }).check();
  await expect.poll(() => page.evaluate(() => window.ashPreferences.getCompact())).toBe(true);
  await page.reload();
  await expect(note).toHaveValue('Saved by the acceptance scenario');
  // Closing the first client exercises actual client state persistence, not DOM state.
  await testInfo.attach('before-reopen', { body: await page.screenshot(), contentType: 'image/png' });
  const trace = testInfo.outputPath('before-reopen.zip');
  await ash.app.context().tracing.stop({ path: trace });
  await testInfo.attach('before-reopen-trace', { path: trace, contentType: 'application/zip' });
  await ash.app.close();
  const reopened = await desktop(instance);
  try {
    await expect(reopened.page.getByLabel('A note for this preview')).toHaveValue('Saved by the acceptance scenario');
    await expect(reopened.page.getByTestId('count')).toHaveText('1');
    await reopened.page.getByText('File and client storage checks', { exact: true }).click();
    await expect(reopened.page.getByLabel('Local file note')).toHaveValue('File storage also survives');
    await expect(reopened.page.getByLabel('Compact scratchpad', { exact: false })).toBeChecked();
    expect(reopened.errors).toEqual([]);
  } finally {
    try { await testInfo.attach('after-reopen', { body: await reopened.page.screenshot(), contentType: 'image/png' }); }
    finally { await reopened.app.close(); }
  }
});

test('scratchpad-layout: Scratchpad layout at normal and minimum window sizes', async ({ ash }) => {
  const { page, app } = ash;
  for (const [width, height] of [[1040, 830], [740, 650]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Save note', exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot(`scratchpad-${width}.png`, {
      // Hide only workspace identity; normalize its derived accent in the screenshot stylesheet.
      stylePath: fileURLToPath(new URL('../support/visual.css', import.meta.url)),
    });
  }
});
