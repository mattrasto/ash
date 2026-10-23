import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { exec, alive, exists, processRef, stopProcess } from '../../scripts/dev/io.ts';
import { scenarioTest } from '../support/node-scenarios.ts';
import { scenarios } from '../scenarios.ts';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

scenarioTest('verification-cli', async () => {
  const run = (...args: string[]) => exec(process.execPath, ['--import', 'tsx', 'scripts/dev/verify.ts', '--list', ...args]);
  const quick = JSON.parse((await run('--profile', 'quick')).stdout);
  assert.ok(quick.scenarios.length > 0);
  assert.ok(quick.scenarios.every((s: { suite: string }) => s.suite === 'boundary'));
  const reset = JSON.parse((await run('--scenario', 'DEV-07')).stdout);
  assert.ok(reset.scenarios.some((s: { id: string }) => s.id === 'workflow-setup'), 'Dependent setup is included');
  assert.ok(reset.scenarios.some((s: { id: string }) => s.id === 'workflow-reset'));
  const routing = JSON.parse((await run('--group', 'model-routing', '--scenario', 'model-routing-desktop')).stdout);
  assert.deepEqual(routing.scenarios.map((s:{id:string})=>s.id).sort(), ['model-routing-desktop','model-routing-execution','model-routing-recovery']);
  assert.equal(routing.scope,'partial');
  const layout = JSON.parse((await run('--scenario','chat-layout')).stdout);
  assert.deepEqual(layout.scenarios.map((s:{id:string})=>s.id),['chat-layout']);
  const visibility = JSON.parse((await run('--scenario','visibility-desktop,visibility-recording-recovery')).stdout);
  assert.equal(visibility.scenarios.length,2);
  await assert.rejects(run('--group','typo'),/Unknown group/);
  await assert.rejects(run('--scenario',''),/No implemented scenario/);
  await assert.rejects(run('--group',''),/No implemented scenario/);
  await assert.rejects(run('--workers','8'),/workers must/);
  await assert.rejects(run('--scenario', 'C10'), /No implemented scenario/);
  await assert.rejects(run('--profile', 'typo'), /Unknown profile/);
  await assert.rejects(run('--unknown'), /Unknown option/);

  // Exercise stopping the real suite process before its exclusive lifecycle group.
  const stopRoot=await mkdtemp(join(tmpdir(),'ash-workflow-stop-'));
  await mkdir(join(stopRoot,'tests/integration'),{recursive:true});
  await symlink(fileURLToPath(new URL('../../node_modules',import.meta.url)),join(stopRoot,'node_modules'),'dir');
  await writeFile(join(stopRoot,'package.json'),JSON.stringify({type:'module'}));
  await writeFile(join(stopRoot,'tests/integration/feature.test.ts'),`import test from 'node:test';import {writeFileSync,existsSync} from 'node:fs';test('current group',async()=>{writeFileSync('ready','');while(!existsSync('release'))await new Promise(resolve=>setTimeout(resolve,10));});`);
  await writeFile(join(stopRoot,'tests/integration/workflow.test.ts'),`import test from 'node:test';import {writeFileSync} from 'node:fs';test('exclusive group',()=>writeFileSync('unexpected-lifecycle',''));`);
  const runnerEnv:NodeJS.ProcessEnv={...process.env,ASH_TEST_WORKERS:'1'};delete runnerEnv.NODE_TEST_CONTEXT;
  const runner=spawn(process.execPath,['--import',import.meta.resolve('tsx'),fileURLToPath(new URL('../../scripts/dev/test-workflow.ts',import.meta.url))],{cwd:stopRoot,env:runnerEnv,detached:true,stdio:['ignore','pipe','pipe']});
  let stopped=false,output='';runner.stdout.on('data',chunk=>{output+=chunk.toString();});runner.stderr.on('data',chunk=>{output+=chunk.toString();});
  const exited=new Promise<number|null>(resolve=>runner.once('close',code=>{stopped=true;resolve(code);}));
  const owner=await processRef(runner.pid!);
  try{
    for(let n=0;n<300&&!stopped&&!await exists(join(stopRoot,'ready'));n++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(await exists(join(stopRoot,'ready')),output || 'Feature group reached its process boundary');
    runner.kill('SIGTERM');
    for(let n=0;n<300&&!output.includes('Stopping workflow groups')&&!stopped;n++)await new Promise(resolve=>setTimeout(resolve,10));
    await writeFile(join(stopRoot,'release'),'');
    assert.ok(output.includes('Stopping workflow groups'),'Suite acknowledged cancellation');
    assert.notEqual(await exited,0);
    assert.equal(await exists(join(stopRoot,'unexpected-lifecycle')),false,'Stop never starts a later group');
  }finally{await writeFile(join(stopRoot,'release'),'');await stopProcess(owner,true);await rm(stopRoot,{recursive:true,force:true});}
});

scenarioTest('verification-evidence', async () => {
  // Exercise the real CLI at its process/filesystem boundary with tiny external suite programs.
  const root = await mkdtemp(join(tmpdir(), 'ash-verifier-contract-'));
  const checkout = join(root, 'checkout');
  const state = join(root, 'state');
  await mkdir(checkout);
  try {
    await exec('git', ['init', '-q', checkout]);
    await exec('git', ['-c', 'user.name=Ash tests', '-c', 'user.email=tests@localhost', 'commit', '--allow-empty', '-qm', 'Fixture'], { cwd: checkout });
    const pkg = { private: true, packageManager: 'pnpm@9.0.6', scripts: {
      typecheck: 'node suite.cjs typecheck', build: 'node suite.cjs build', 'test:boundary': 'node suite.cjs boundary',
      'test:workflow': 'node suite.cjs workflow', 'test:desktop': 'node suite.cjs desktop',
    }, devDependencies: { electron: 'fixture', '@playwright/test': 'fixture' } };
    await writeFile(join(checkout, 'package.json'), JSON.stringify(pkg));
    await writeFile(join(checkout, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    const ids = scenarios.filter(s => s.suite === 'boundary').map(s => s.id);
    await writeFile(join(checkout, 'suite.cjs'), `
const fs = require('node:fs');
const path = require('node:path');
const mode = fs.readFileSync('mode.txt', 'utf8');
if (['typecheck','build'].includes(process.argv[2])) process.exit(mode === 'command-failure' ? 2 : 0);
if (mode === 'assertion-failure') require('node:assert/strict').fail('Intentional verification fixture failure');
const ids = process.argv[2] === 'workflow' ? ['model-routing-execution','model-routing-recovery'] : process.argv[2] === 'desktop' ? ['model-routing-desktop'] : ${JSON.stringify(ids)};
if (mode === 'owned-process') {
  const {spawn,execFileSync}=require('node:child_process');
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});child.unref();
  const identity=execFileSync('ps',['-p',String(child.pid),'-o','lstart=','-o','command='],{encoding:'utf8'}).trim();
  const resources=path.join(process.env.ASH_TEST_EVIDENCE,'resources','processes');fs.mkdirSync(resources,{recursive:true});
  fs.writeFileSync(path.join(resources,child.pid+'.json'),JSON.stringify({pid:child.pid,identity}));
}
const dir = path.join(process.env.ASH_TEST_EVIDENCE, 'results');
fs.mkdirSync(dir, { recursive: true });
for (const id of ids) {
  if (mode === 'missing' && id === ids[0]) continue;
  const status = mode === 'skipped' && id === ids[0] ? 'skipped' : 'passed';
  const attempts = [{ status, durationMs: 1 }];
  if (mode === 'retry' && id === ids[0]) attempts.unshift({status:'failed', durationMs:1});
  fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({id, attempts}));
}
if (mode === 'unexpected') fs.writeFileSync(path.join(dir,'chat-layout.json'),JSON.stringify({id:'chat-layout',attempts:[{status:'passed',durationMs:1}]}));
if (mode === 'source-change') fs.appendFileSync('package.json', '\\n');
`);
    for (const mode of ['success', 'missing', 'skipped', 'retry', 'command-failure', 'source-change', 'assertion-failure', 'unexpected', 'focused', 'owned-process']) {
      await writeFile(join(checkout, 'mode.txt'), mode);
      const previous = new Set(await readdir(join(state, 'evidence')).catch(() => []));
      let exitedCleanly = true;
      try {
        await exec(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../../scripts/dev/verify.ts', import.meta.url)), ...(mode==='focused'?['--group','model-routing','--scenario','model-routing-desktop']:['--profile','quick'])], {
          cwd: checkout, env: { ...process.env, ASH_DEV_ROOT: state }, timeout: 30_000,
        });
      } catch { exitedCleanly = false; }
      const created = (await readdir(join(state, 'evidence'))).filter(name => !previous.has(name));
      assert.equal(created.length, 1);
      const report = JSON.parse(await readFile(join(state, 'evidence', created[0], 'report.json'), 'utf8'));
      assert.equal(exitedCleanly, ['success','focused','owned-process'].includes(mode), mode);
      assert.equal(report.passed, ['success','focused','owned-process'].includes(mode), mode);
      assert.equal(report.scope, 'partial');
      assert.ok(report.scenarios.some((s: {status:string}) => s.status === 'not-selected'));
      if(mode==='owned-process'){
        assert.equal(report.cleanup.length,1);assert.equal(report.cleanup[0].status,'passed');
        const resource=await readFile(join(state,'evidence',created[0],'resources','processes',report.cleanup[0].id),'utf8');
        assert.equal(await alive(JSON.parse(resource)),false);
      }
      if(mode==='focused'){assert.deepEqual(report.scenarios.filter((s:{status:string})=>s.status==='passed').map((s:{id:string})=>s.id).sort(),['model-routing-desktop','model-routing-execution','model-routing-recovery']);continue;}
      const first = report.scenarios.find((s: {id:string}) => s.id === ids[0]);
      if (mode === 'missing' || mode === 'command-failure') assert.equal(first.status, 'blocked');
      if (mode === 'skipped') assert.equal(first.status, 'skipped');
      if (mode === 'retry') { assert.equal(first.status, 'failed'); assert.equal(first.attempts.length, 2); }
      if (mode === 'source-change') assert.equal(report.sourceValid, false);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
