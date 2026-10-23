import { testGroups } from '../../tests/scenarios.ts';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';

// Ordinary feature groups may overlap; renderer-release and infrastructure journeys run alone.
const workers = Number(process.env.ASH_TEST_WORKERS ?? 1);
if (![1, 2].includes(workers)) throw new Error('ASH_TEST_WORKERS must be 1 or 2');
const selected = process.argv.slice(2);
const files = selected.length ? selected : (await readdir('tests/integration')).filter(name => name.endsWith('.test.ts')).sort().map(name => `tests/integration/${name}`);
if (!files.length || files.some(file => !/^tests\/integration\/[a-z-]+\.test\.ts$/.test(file))) throw new Error('Expected integration test files');
const exclusive = new Set(testGroups.filter(group => group.exclusive).map(group => group.file));
const lifecycle = files.filter(file => exclusive.has(file));
const feature = files.filter(file => !lifecycle.includes(file));
let interrupted = false;
for (const group of [feature, lifecycle]) {
  if (!group.length) continue;
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', `--test-concurrency=${group === lifecycle ? 1 : workers}`, ...group], { stdio: 'inherit' });
  const forward = () => { interrupted = true; console.log('Stopping workflow groups'); child.kill('SIGTERM'); };
  process.on('SIGINT', forward); process.on('SIGTERM', forward);
  const code = await new Promise<number>(resolve => { child.once('error', error => { console.error(error.message); resolve(1); }); child.once('close', code => resolve(code ?? 1)); });
  process.off('SIGINT', forward); process.off('SIGTERM', forward);
  if (code || interrupted) { process.exitCode = code || 1; break; }
}
