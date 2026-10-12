import { parseArgs } from 'node:util';
import { readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Fixture } from '../../packages/shared/src/index.ts';
import { assertEnvironment, devRoot, alive, exists, sleep } from './io.ts';
import { workspace, createInstance, readInstance, instancePath } from './workspace.ts';
import { startInstance, stopInstance, resetInstance, disposeInstance, runtime } from './lifecycle.ts';
import { configureLiveModel } from './live-model.ts';

let jsonOutput = false;
let logDirectory: string | undefined;
const color = (code: number, value: string) => process.stdout.isTTY && !('NO_COLOR' in process.env) ? `\x1b[${code}m${value}\x1b[0m` : value;
function note(message: string) { if (!jsonOutput) console.log(color(2, message)); }
function result(value: unknown, message: string, details: string[] = []) {
  if (jsonOutput) console.log(JSON.stringify(value, null, 2));
  else {
    console.log(`\n${color(32, '✓')} ${color(1, message)}`);
    for (const detail of details) console.log(`  ${detail}`);
    console.log();
  }
}

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    workspace: { type: 'string' }, 'dev-root': { type: 'string' }, instance: { type: 'string' },
    fixture: { type: 'string' }, json: { type: 'boolean' }, headless: { type: 'boolean' }, windowed: { type: 'boolean' }, background: { type: 'boolean' }, detach: { type: 'boolean' },
    'openai-model': {type:'string'}, 'live-session': {type:'string'}, 'live-calls': {type:'string'},
    'live-minutes': {type:'string'}, 'max-output-tokens': {type:'string'}, 'reasoning-effort': {type:'string'},
  } });
  jsonOutput = values.json ?? false;
  assertEnvironment();
  const root = await devRoot(values['dev-root']);
  const ws = await workspace(resolve(values.workspace ?? process.cwd()), root);
  const command = positionals[0];
  if (!['start','explore'].includes(command) && ['openai-model','live-session','live-calls','live-minutes','max-output-tokens','reasoning-effort'].some(key=>values[key as keyof typeof values] !== undefined)) throw new Error('Live model options require start or explore');
  const instanceId = values.instance ?? ws.previewId;
  const selected = values.instance ? await readInstance(ws, instanceId) : undefined;
  if (values.instance && ['setup', 'explore'].includes(command)) throw new Error(`${command} does not accept --instance`);
  const fixture = Fixture.parse(values.fixture ?? 'scratchpad');
  if (command === 'setup') {
    note(`Preparing preview · ${ws.label}…`);
    result(await createInstance(ws, 'preview', fixture), `Preview prepared · ${ws.label}`, ['Start: pnpm dev']);
  }
  else if (command === 'start' || command === 'explore') {
    note(`Starting ${command === 'explore' || (selected && selected.profile !== 'preview') ? 'verification' : 'preview'} · ${ws.label}…`);
    const instance = command === 'explore' ? await createInstance(ws, 'verify', fixture)
      : selected ?? (await exists(join(instancePath(ws, ws.previewId), 'instance.json'))
        ? await readInstance(ws) : await createInstance(ws, 'preview', fixture));
    logDirectory = join(instance.root, 'logs');
    const prior = await runtime(instance);
    if (prior && await alive(prior.supervisor) && (values['openai-model'] || prior.modelSessionId !== values['live-session'])) throw new Error('Stop the running instance before changing its model session');
    const modelSessionId = await configureLiveModel(instance,values).catch(async error => {
      if (command === 'explore') await disposeInstance(ws,instance.id);
      throw error;
    });
    let cancelled = false;
    let cleaning = false;
    const cleanup = async () => {
      if (cleaning) return;
      cleaning = true;
      await stopInstance(ws, instance.id);
      if (command === 'explore') await disposeInstance(ws, instance.id);
      note(command === 'explore' ? 'Verification stopped and discarded.' : `${instance.profile === 'preview' ? 'Preview' : 'Verification'} stopped. Data kept.`);
      process.exit(0);
    };
    // Record cancellation while startup holds the instance lock; cleanup follows once it releases.
    const cancelStartup = () => { cancelled = true; };
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, cancelStartup);
    const state = await startInstance(ws, instance.id, {...values,modelSessionId}).catch(async error => {
      await stopInstance(ws, instance.id);
      if (command === 'explore') await disposeInstance(ws, instance.id);
      throw error;
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.off(signal, cancelStartup);
    if (cancelled) await cleanup();
    const target = instance.profile === 'preview' ? '' : ` --instance ${instance.id}`;
    result({ workspace: ws.label, ...state }, `${instance.profile === 'preview' ? 'Preview' : 'Verification'} ready · ${instance.label}`, [
      instance.profile === 'preview' ? 'Persistent data · hot reload enabled' : 'Disposable data · preview unchanged',
      ...(values.headless ? [`Frontend: ${state.webUrl}`, `Backend:  ${state.serverUrl}`] : []),
      values.detach
        ? instance.profile === 'preview' ? 'Stop: pnpm dev:stop' : `Dispose: pnpm dev:dispose${target}`
        : command === 'explore' ? 'Ctrl+C to stop and discard this instance' : 'Ctrl+C to stop · data is kept',
      `Details: pnpm dev:status${target}`,
      ...(modelSessionId ? [`OpenAI session: ${modelSessionId}`, `Resume this session: pnpm dev${target} --live-session ${modelSessionId}`] : []),
    ]);
    if (!values.detach) {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, cleanup);
      while (await alive(state.supervisor)) await sleep(1000);
      if (command === 'explore' && await exists(join(instance.root, 'instance.json'))) await disposeInstance(ws, instance.id);
      note(command === 'explore' ? 'Verification stopped and discarded.' : `${instance.profile === 'preview' ? 'Preview' : 'Verification'} stopped. Data kept.`);
    }
    process.exit(0);
  } else if (command === 'status') {
    if (!await exists(join(root, 'workspaces', ws.id, 'preview/instance.json')) && !values.instance) {
      result({ workspace: ws.label, phase: 'not-set-up' }, `Preview not set up · ${ws.label}`, ['Setup: pnpm dev:setup']);
    } else {
      const instance = selected ?? await readInstance(ws, instanceId);
      const state = await runtime(instance);
      const running = state ? await alive(state.supervisor) : false;
      const phase = state?.phase ?? 'stopped';
      result({ workspace: ws.label, instanceId: instance.id, profile: instance.profile, fixture: instance.fixture, phase, running,
        serverUrl: state?.serverUrl, webUrl: state?.webUrl, error: state?.error, modelSessionId:state?.modelSessionId },
      `Ash · ${instance.label}`, [
        `State: ${!running && ['ready', 'starting'].includes(phase) ? 'Supervisor exited' : phase}`,
        `Profile: ${instance.profile} · Fixture: ${instance.fixture}`,
        ...(running && state?.webUrl ? [`Frontend: ${state.webUrl}`, `Backend:  ${state.serverUrl}`] : []),
        `Logs: ${join(instance.root, 'logs')}`,
        ...(state?.error ? [`Error: ${state.error}`] : []),
      ]);
    }
  } else if (command === 'stop') {
    await stopInstance(ws, instanceId);
    result({ stopped: instanceId }, `Stopped · ${selected?.label ?? ws.label}`, ['Data kept.']);
  } else if (command === 'reset') {
    note(`Resetting · ${selected?.label ?? ws.label}…`);
    result(await resetInstance(ws, instanceId, fixture), `Reset complete · ${selected?.label ?? ws.label}`, [
      `Fixture: ${fixture} · instance is stopped`, `Start: pnpm dev${values.instance ? ` --instance ${instanceId}` : ''}`,
    ]);
  }
  else if (command === 'dispose') {
    const ids = values.instance ? [instanceId] : [ws.previewId, ...await readdir(join(root, 'workspaces', ws.id, 'verify')).catch(() => [])];
    for (const target of ids) if (await exists(join(root, 'workspaces', ws.id, target === ws.previewId ? 'preview' : `verify/${target}`, 'instance.json'))) await disposeInstance(ws, target);
    result({ disposed: ids }, `Disposed · ${selected?.label ?? ws.label}`, ['Development data removed. Source and evidence kept.']);
  } else throw new Error('Expected setup, start, status, stop, reset, dispose or explore');
} catch (e) {
  console.error(`${jsonOutput ? '' : '✗ '}${(e as Error).message}`);
  if (!jsonOutput && logDirectory) console.error(`  Logs: ${logDirectory}`);
  process.exit(1);
}
