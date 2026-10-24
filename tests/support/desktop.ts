import { launchElectron } from './electron.ts';
import { PollingRoutes } from './ui.ts';
import { measure } from '../../scripts/dev/telemetry.ts';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { buildMain } from '../../scripts/dev/build.ts';
import { atomic, childEnvironment, json } from '../../scripts/dev/io.ts';
import { runtime } from '../../scripts/dev/lifecycle.ts';
import { ServerConfig, type Instance } from '../../packages/shared/src/index.ts';

export async function request(instance: Instance, path: string, body?: object, tokenOverride?: string) {
  const current = await runtime(instance);
  const cfg = ServerConfig.parse(await json(join(instance.root, 'server.json')));
  return fetch(`${current!.serverUrl}${path}`, {
    method: body ? 'PATCH' : 'GET',
    headers: { authorization: `Bearer ${tokenOverride ?? cfg.token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
  });
}

export async function desktop(instance: Instance) {
  return measure('desktop.ready', () => launchDesktop(instance), instance.id);
}
async function launchDesktop(instance: Instance) {
  const running = await runtime(instance);
  const entry = await buildMain(instance.checkout, join(instance.root, 'build'));
  const configPath = join(instance.root, 'test-client.json');
  await atomic(configPath, { root: instance.root, label: instance.label, instanceId: instance.id, url: running!.webUrl, windowed: true, background: true });
  const require = createRequire(join(instance.checkout, 'package.json'));
  // A per-process Cocoa preference keeps native scrollbar geometry stable without changing user defaults.
  const args = [entry, ...(process.platform === 'darwin' ? ['-AppleShowScrollBars','Always'] : [])];
  const app = await launchElectron({ executablePath: require('electron'), args, cwd: instance.checkout,
    env: { ...childEnvironment(join(instance.root, 'tmp')), ASH_CLIENT_CONFIG: configPath } as Record<string, string>, timeout: 30_000 });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await measure('desktop.connected', () => page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 15_000 }), instance.id);
    const network = new PollingRoutes(page);
    const close = async () => { try { await network.dispose(); } finally { await app.close(); } };
    return { app, page, errors, network, close };
  } catch (error) { await app.close(); throw error; }
}
