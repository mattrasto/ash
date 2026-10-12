import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { devRoot, id, fingerprint, atomic } from './io.ts';
import { buildAll } from './build.ts';
import { SCHEMA_VERSION, FIXTURE_VERSION } from '../../packages/shared/src/index.ts';

const checkout = process.cwd();
const evidence = join(await devRoot(), 'evidence', id());
await mkdir(evidence, {recursive:true});
const before = await fingerprint(checkout);
const steps: Array<{command:string; passed:boolean}> = [];
let output = '';
async function run(args: string[]) {
  const passed = await new Promise<boolean>((resolve,reject) => {
    const child = spawn('pnpm', args, {cwd:checkout,env:{...process.env, ASH_TEST_EVIDENCE:evidence},stdio:['inherit','pipe','pipe']});
    for (const stream of [child.stdout,child.stderr]) stream.on('data',chunk => {output += chunk.toString(); process.stdout.write(chunk);});
    child.once('error',reject); child.once('exit',code => resolve(code === 0));
  });
  steps.push({command:`pnpm ${args.join(' ')}`,passed});
  if (!passed) throw new Error(`Verification failed: pnpm ${args.join(' ')}`);
}
let error: string | undefined;
try {
  await run(['typecheck']);
  await buildAll(checkout, join(evidence,'build')); steps.push({command:'isolated build',passed:true});
  await run(['test']); await run(['test:workflow']);
  const after = await fingerprint(checkout);
  if (after.hash !== before.hash || after.commit !== before.commit) throw new Error('Source changed during verification; result is invalid');
} catch(e) {error=(e as Error).message;}
await writeFile(join(evidence,'checks.log'),output);
await atomic(join(evidence,'report.json'),{source:before,fixture:'scratchpad / empty',fixtureVersion:FIXTURE_VERSION,schemaVersion:SCHEMA_VERSION,productMigration:'202610120001_images',model:'deterministic/ash-test-v1 + mocked OpenAI Responses',liveProviderCalls:0,steps,passed:!error,error,completedAt:new Date().toISOString()});
console.log(`Verification ${error?'FAILED':'PASSED'}: ${evidence}`);
if(error){console.error(error);process.exitCode=1;}
