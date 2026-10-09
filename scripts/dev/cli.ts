import { parseArgs } from 'node:util';
import { readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Fixture } from '../../packages/shared/src/index.ts';
import { assertEnvironment, devRoot, alive, exists, sleep } from './io.ts';
import { workspace, createInstance, readInstance } from './workspace.ts';
import { startInstance, stopInstance, resetInstance, disposeInstance, runtime } from './lifecycle.ts';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    workspace: { type: 'string' }, 'dev-root': { type: 'string' }, instance: { type: 'string' },
    fixture: { type: 'string' }, json: { type: 'boolean' }, headless: { type: 'boolean' }, windowed: { type: 'boolean' }, background: { type: 'boolean' }, detach: { type: 'boolean' },
  } });
  assertEnvironment();
  const root = await devRoot(values['dev-root']);
  const ws = await workspace(resolve(values.workspace ?? process.cwd()), root);
  const command = positionals[0];
  const instanceId = values.instance ?? ws.previewId;
  if (values.instance) await readInstance(ws, instanceId);
  if (values.instance && ['setup', 'explore'].includes(command)) throw new Error(`${command} does not accept --instance`);
  const fixture = Fixture.parse(values.fixture ?? 'scratchpad');
  let result: unknown;
  if (command === 'setup') result = await createInstance(ws, 'preview', fixture);
  else if (command === 'start' || command === 'explore') {
    const instance = command === 'explore' ? await createInstance(ws, 'verify', fixture) : values.instance ? await readInstance(ws, instanceId) : await createInstance(ws, 'preview', fixture);
    let cancelled = false;
    let cleaning = false;
    const cleanup = async () => {
      if (cleaning) return;
      cleaning = true;
      await stopInstance(ws, instance.id);
      if (command === 'explore') await disposeInstance(ws, instance.id);
      process.exit(0);
    };
    // Record cancellation while startup holds the instance lock; cleanup follows once it releases.
    const cancelStartup = () => { cancelled = true; };
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, cancelStartup);
    const state = await startInstance(ws, instance.id, values).catch(async error => {
      await stopInstance(ws, instance.id);
      if (command === 'explore') await disposeInstance(ws, instance.id);
      throw error;
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.off(signal, cancelStartup);
    if (cancelled) await cleanup();
    result = { workspace: ws.label, ...state };
    console.log(JSON.stringify(result, null, 2));
    if (!values.detach) {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, cleanup);
      while (await alive(state.supervisor)) await sleep(1000);
      if (command === 'explore' && await exists(join(instance.root, 'instance.json'))) await disposeInstance(ws, instance.id);
    }
    process.exit(0);
  } else if (command === 'status') {
    if (!await exists(join(root, 'workspaces', ws.id, 'preview/instance.json')) && !values.instance) result = { workspace: ws.label, phase: 'not-set-up' };
    else { const instance = await readInstance(ws, instanceId); const state = await runtime(instance); result = { workspace: ws.label, instanceId: instance.id, profile: instance.profile, fixture: instance.fixture, phase: state?.phase ?? 'stopped', running: state ? await alive(state.supervisor) : false, serverUrl: state?.serverUrl, webUrl: state?.webUrl, error: state?.error }; }
  } else if (command === 'stop') { await stopInstance(ws, instanceId); result = { stopped: instanceId }; }
  else if (command === 'reset') result = await resetInstance(ws, instanceId, fixture);
  else if (command === 'dispose') {
    const ids = values.instance ? [instanceId] : [ws.previewId, ...await readdir(join(root, 'workspaces', ws.id, 'verify')).catch(() => [])];
    for (const target of ids) if (await exists(join(root, 'workspaces', ws.id, target === ws.previewId ? 'preview' : `verify/${target}`, 'instance.json'))) await disposeInstance(ws, target);
    result = { disposed: ids };
  } else throw new Error('Expected setup, start, status, stop, reset, dispose or explore');
  console.log(JSON.stringify(result, null, 2));
} catch (e) { console.error((e as Error).message); process.exit(1); }
