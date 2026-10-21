import { test, expect } from '../support/fixtures.ts';
import { ServerConfig } from '../../packages/shared/src/index.ts';
import { runtime } from '../../scripts/dev/lifecycle.ts';
import { json } from '../../scripts/dev/io.ts';
import { join } from 'node:path';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => resolve = done);
  return { promise, resolve };
}

test('decisions-response-retry-desktop: Failed responses retry the current choice, text and comment', async ({ ash, instance }) => {
  const { page } = ash, cfg = ServerConfig.parse(await json(join(instance.root, 'server.json'))), running = await runtime(instance);
  const request = async (path: string, body?: object) => fetch(`${running!.serverUrl}/api/${path}`, {
    method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const create = async (question: string, permission = false) => {
    const id = crypto.randomUUID();
    const response = await request('decisions', { id, request: permission ? {
      kind: 'permission', form: 'approval', question, reason: 'Synthetic response retry check.', binding: 'fixture-only',
      action: { operation: 'fixture.send', effects: ['send'], resources: [{ kind: 'contact', id: 'alex@example.com', label: 'Alex' }] },
      options: [{ id: 'approve', label: 'Approve this action' }, { id: 'decline', label: 'Decline' }],
    } : { kind: 'question', form: 'text', question, reason: 'Synthetic response retry check.' } });
    expect(response.status).toBe(200);
    return id;
  };
  let failures = 2;
  const submitted: { submissionId: string; value: unknown; comment?: string }[] = [];
  await page.route('**/api/decisions/*/answer', async route => {
    submitted.push(route.request().postDataJSON());
    if (failures-- > 0) await route.fulfill({ status: 503, json: { error: 'Synthetic response failure.' } });
    else await route.continue();
  });
  const failed = async () => {
    await expect(panel.getByRole('alert')).toHaveText('Synthetic response failure.');
    await expect.poll(() => ash.errors.some(error => error.includes('status of 503'))).toBe(true);
    ash.errors.splice(ash.errors.findIndex(error => error.includes('status of 503')), 1);
  };
  const saved = async (id: string) => (await (await request('decisions')).json() as any[]).find(decision => decision.id === id).resolution;
  const approval = await create('Approve the retry fixture?', true);
  await page.getByRole('button', { name: /^Decisions/ }).click();
  const panel = page.getByRole('main', { name: 'Decisions', exact: true });
  await panel.getByRole('button', { name: 'Approve this action', exact: true }).click(); await failed();
  await panel.getByRole('button', { name: 'Approve this action', exact: true }).click(); await failed();
  expect(submitted[1]).toEqual(submitted[0]);
  await panel.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(panel.getByTestId('decision-card')).toHaveCount(0);
  expect(submitted[2].value).toBe('decline'); expect(submitted[2].submissionId).not.toBe(submitted[0].submissionId);
  expect((await saved(approval)).value).toBe('decline');

  failures = 2;
  const text = await create('Explain the retry fixture?');
  await panel.getByLabel('Answer', { exact: true }).fill('Original answer');
  await panel.getByText('Add comment', { exact: true }).click();
  await panel.getByLabel('Optional comment', { exact: true }).fill('Original comment');
  await panel.getByRole('button', { name: 'Submit answer', exact: true }).click(); await failed();
  await panel.getByLabel('Answer', { exact: true }).fill('Revised answer');
  await panel.getByRole('button', { name: 'Submit answer', exact: true }).click(); await failed();
  await panel.getByLabel('Optional comment', { exact: true }).fill('Revised comment');
  await panel.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await expect(panel.getByTestId('decision-card')).toHaveCount(0);
  expect(submitted.slice(3).map(({ value, comment }) => ({ value, comment }))).toEqual([
    { value: 'Original answer', comment: 'Original comment' }, { value: 'Revised answer', comment: 'Original comment' }, { value: 'Revised answer', comment: 'Revised comment' },
  ]);
  expect(new Set(submitted.slice(3).map(response => response.submissionId)).size).toBe(3);
  expect(await saved(text)).toMatchObject({ value: 'Revised answer', comment: 'Revised comment' });

  failures = 1;
  const skipped = await create('Skip the retry fixture?');
  await panel.getByLabel('Answer', { exact: true }).fill('Unsent answer');
  await panel.getByRole('button', { name: 'Submit answer', exact: true }).click(); await failed();
  await panel.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(panel.getByTestId('decision-card')).toHaveCount(0);
  expect(submitted.at(-1)!.value).toEqual({ skipped: true });
  expect(submitted.at(-1)!.submissionId).not.toBe(submitted.at(-2)!.submissionId);
  expect((await saved(skipped)).value).toEqual({ skipped: true });
});

test('permissions-save-navigation-desktop: In-flight saves block leaving or discarding until completion', async ({ ash, instance }) => {
  const { page } = ash, cfg = ServerConfig.parse(await json(join(instance.root, 'server.json'))), running = await runtime(instance);
  const saved = async () => (await (await fetch(`${running!.serverUrl}/api/permissions`, { headers: { authorization: `Bearer ${cfg.token}` } })).json()) as any[];
  const reviews = [false, true].map(fail => ({ fail, started: deferred(), release: deferred() }));
  const commit = { started: deferred(), release: deferred() }; let reviewIndex = 0, commits = 0;
  await page.route('**/api/permissions/review', async route => {
    const review = reviews[reviewIndex++]; review.started.resolve(); await review.release.promise;
    if (review.fail) await route.fulfill({ status: 503, json: { error: 'Synthetic permission review failure.' } });
    else await route.continue();
  });
  await page.route('**/api/permissions/commit', async route => {
    commits++; commit.started.resolve(); await commit.release.promise; await route.continue();
  });
  const settings = page.getByRole('dialog', { name: 'Settings' }), permissions = settings.getByRole('region', { name: 'Permissions', exact: true });
  const openDraft = async (path: string) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await settings.getByRole('tab', { name: 'Permissions', exact: true }).click();
    await permissions.getByRole('button', { name: 'New permission', exact: true }).click();
    await permissions.getByRole('button', { name: 'Choose action', exact: true }).click();
    await permissions.getByLabel('Resource', { exact: true }).fill(path);
  };
  const locked = async () => {
    await expect(settings.getByRole('button', { name: 'Close Settings' })).toBeDisabled();
    await expect(settings.getByRole('tab', { name: 'Instructions', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(settings).toBeVisible();
    await expect(settings.getByRole('tab', { name: 'Permissions', exact: true })).toHaveAttribute('aria-selected', 'true');
  };
  try {
    await openDraft('/example/save-navigation/');
    await permissions.getByRole('button', { name: 'Save permission', exact: true }).click();
    await reviews[0].started.promise; await locked();
    await expect(settings.getByRole('button', { name: 'Discard changes', exact: true })).toHaveCount(0);
    reviews[0].release.resolve(); await commit.started.promise; await locked();
    commit.release.resolve(); await expect(permissions.getByRole('status')).toHaveText('Permission saved');
    expect(commits).toBe(1);
    expect((await saved()).filter(permission => permission.policy.resource?.path === '/example/save-navigation')).toHaveLength(1);
    await settings.getByRole('button', { name: 'Close Settings' }).click(); await expect(settings).toHaveCount(0);

    // Save-and-continue also locks the already-visible discard prompt; a failed save preserves it.
    await openDraft('/example/failed-navigation/');
    await settings.getByRole('button', { name: 'Close Settings' }).click();
    await settings.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await reviews[1].started.promise; await locked();
    for (const name of ['Save and continue', 'Discard changes', 'Keep editing']) await expect(settings.getByRole('button', { name, exact: true })).toBeDisabled();
    reviews[1].release.resolve(); await expect(permissions.getByRole('alert')).toHaveText('Synthetic permission review failure.');
    await expect.poll(() => ash.errors.some(error => error.includes('status of 503'))).toBe(true);
    ash.errors.splice(ash.errors.findIndex(error => error.includes('status of 503')), 1);
    await expect(permissions.getByLabel('Resource', { exact: true })).toHaveValue('/example/failed-navigation/');
    await settings.getByRole('button', { name: 'Discard changes', exact: true }).click(); await expect(settings).toHaveCount(0);
    expect((await saved()).some(permission => permission.policy.resource?.path === '/example/failed-navigation')).toBe(false);
    expect(commits).toBe(1);
    expect(await ash.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible() && !window.isFocusable()))).toBe(true);
  } finally {
    for (const review of reviews) review.release.resolve();
    commit.release.resolve();
  }
});
