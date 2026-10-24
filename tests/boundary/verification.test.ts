import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { exec, alive, exists, processRef, stopProcess } from '../../scripts/dev/io.ts';
import { scenarioTest } from '../support/node-scenarios.ts';
import { scenarios, selectScenarios } from '../scenarios.ts';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSelection } from '../helpers/selection-checks.ts';
import { checkGraph } from '../helpers/graph-checks.ts';
import { checkDesktopOutputIsolation } from '../helpers/desktop-output-checks.ts';

scenarioTest('verification-cli', async () => {
  await checkSelection();
  await checkGraph();
  await checkDesktopOutputIsolation();
  const run = (...args: string[]) => exec(process.execPath, ['--import', 'tsx', 'scripts/dev/verify.ts', '--list', ...args]);
  const quick = JSON.parse((await run('--profile', 'quick')).stdout);
  assert.ok(quick.scenarios.length > 0);
  assert.ok(quick.scenarios.every((s: { suite: string }) => s.suite === 'boundary'));
  assert.deepEqual(quick.scenarios.map((s:{id:string})=>s.id).sort(),['boundary-environment','boundary-fingerprint','boundary-locks','boundary-paths','boundary-process']);
  const harness = JSON.parse((await run('--group','verification')).stdout);
  assert.deepEqual(harness.scenarios.map((s:{id:string})=>s.id).sort(),['verification-cli','verification-evidence']);
  const full = JSON.parse((await run()).stdout);
  assert.equal(full.scenarios.length,scenarios.length,'Full verification retains every scenario');
  const reset = JSON.parse((await run('--scenario', 'DEV-07')).stdout);
  assert.ok(reset.scenarios.some((s: { id: string }) => s.id === 'workflow-setup'), 'Dependent setup is included');
  assert.ok(reset.scenarios.some((s: { id: string }) => s.id === 'workflow-reset'));
  const routing = JSON.parse((await run('--group', 'model-routing', '--scenario', 'model-routing-desktop')).stdout);
  assert.deepEqual(routing.scenarios.map((s:{id:string})=>s.id).sort(), ['model-routing-desktop','model-routing-execution','model-routing-recovery']);
  assert.equal(routing.scope,'partial');
  const wider = JSON.parse((await run('--workers','8','--group','model-routing')).stdout);
  assert.equal(wider.graph.plan.workers,8);
  const layout = JSON.parse((await run('--scenario','chat-layout')).stdout);
  assert.deepEqual(layout.scenarios.map((s:{id:string})=>s.id),['chat-layout']);
  const visibility = JSON.parse((await run('--scenario','visibility-desktop,visibility-recording-recovery')).stdout);
  assert.equal(visibility.scenarios.length,2);
  await assert.rejects(run('--group','typo'),/Unknown group/);
  await assert.rejects(run('--scenario',''),/No implemented scenario/);
  await assert.rejects(run('--group',''),/No implemented scenario/);
  for(const workers of ['0','1.5','13']) await assert.rejects(run('--workers',workers),/workers must/);
  await assert.rejects(run('--scenario', 'C10'), /No implemented scenario/);
  await assert.rejects(run('--profile', 'typo'), /Unknown profile/);
  await assert.rejects(run('--unknown'), /Unknown option/);
  await assert.rejects(run('--affected','HEAD','--profile','quick'), /full verification/);
  await assert.rejects(run('--iterate'), /requires --affected/);
  await assert.rejects(run('--reference','/nonexistent/ash-report.json'), /ENOENT/);

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
    const ids = selectScenarios('quick').map(s => s.id);
    await writeFile(join(checkout, 'suite.cjs'), `
const fs = require('node:fs');
const path = require('node:path');
const mode = fs.readFileSync('mode.txt', 'utf8');
if (['typecheck','build'].includes(process.argv[2])) process.exit(mode === 'command-failure' ? 2 : 0);
if (mode === 'assertion-failure') require('node:assert/strict').fail('Intentional verification fixture failure');
if (mode === 'independent-failure' && process.argv[2] === 'workflow') require('node:assert/strict').fail('Controlled workflow branch failure');
const ids = process.argv[2] === 'workflow' ? ['model-routing-execution','model-routing-recovery'] : process.argv[2] === 'desktop' ? ['model-routing-desktop'] : ${JSON.stringify(ids)};
if (['owned-process','interrupt'].includes(mode)) {
  const {spawn,execFileSync}=require('node:child_process');
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});child.unref();
  const identity=execFileSync('ps',['-p',String(child.pid),'-o','lstart=','-o','command='],{encoding:'utf8'}).trim();
  const resources=path.join(process.env.ASH_TEST_EVIDENCE,'resources','processes');fs.mkdirSync(resources,{recursive:true});
  fs.writeFileSync(path.join(resources,child.pid+'.json'),JSON.stringify({pid:child.pid,identity}));
  if (mode === 'owned-process') {
    const id='111111111111111111111111', evidence=process.env.ASH_TEST_EVIDENCE;
    const instances=path.join(evidence,'resources','instances');fs.mkdirSync(instances,{recursive:true});
    fs.writeFileSync(path.join(instances,id+'.json'),JSON.stringify({version:1,id,workspaceId:id,checkout:process.cwd(),label:'Recovered fixture',profile:'test',fixture:'empty',root:path.join(evidence,'already-disposed'),devRoot:process.env.ASH_DEV_ROOT,database:'fixture',runtimeRole:'fixture',ownerRole:'fixture',clusterId:id,schemaVersion:1,generation:id}));
    const events=path.join(evidence,'events');fs.mkdirSync(events,{recursive:true});
    fs.writeFileSync(path.join(events,process.pid+'.jsonl'),JSON.stringify({id,kind:'phase',name:'environment.owned',context:id,status:'passed',at:Date.now(),processId:process.pid})+'\\n');
  }
}
if (mode === 'interrupt') {fs.writeFileSync('interrupt-ready','');process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}
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
    for (const mode of ['success', 'missing', 'skipped', 'retry', 'command-failure', 'source-change', 'assertion-failure', 'unexpected', 'focused', 'owned-process', 'independent-failure']) {
      await writeFile(join(checkout, 'mode.txt'), mode);
      const previous = new Set(await readdir(join(state, 'evidence')).catch(() => []));
      let exitedCleanly = true;
      try {
        await exec(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../../scripts/dev/verify.ts', import.meta.url)), ...(['focused','independent-failure'].includes(mode)?['--group','model-routing','--scenario','model-routing-desktop']:['--profile','quick'])], {
          cwd: checkout, env: { ...process.env, ASH_DEV_ROOT: state }, timeout: 30_000,
        });
      } catch { exitedCleanly = false; }
      const created = (await readdir(join(state, 'evidence'))).filter(name => !previous.has(name));
      assert.equal(created.length, 1);
      const report = JSON.parse(await readFile(join(state, 'evidence', created[0], 'report.json'), 'utf8'));
      assert.equal(exitedCleanly, ['success','focused','owned-process'].includes(mode), mode);
      assert.equal(report.passed, ['success','focused','owned-process'].includes(mode), mode);
      assert.equal(report.scope, 'partial');
      const timeline=await readFile(join(state,'evidence',created[0],'timeline.html'),'utf8');
      assert.ok(timeline.includes('Partial verification '+(report.passed?'passed':'failed')),'Timeline agrees with aggregate source/coverage outcome and scope');
      assert.ok(!timeline.includes('<h1>Full verification passed</h1>'));
      assert.ok(report.scenarios.some((s: {status:string}) => s.status === 'not-selected'));
      if(mode==='owned-process'){
        assert.equal(report.cleanup.length,2);assert.ok(report.cleanup.every((c:{status:string})=>c.status==='passed'));
        const progress=JSON.parse(await readFile(join(state,'evidence',created[0],'progress.json'),'utf8'));
        assert.deepEqual(progress.environments,[],'Main recovery releases environments even without a child cleanup event');
        const processCleanup=report.cleanup.find((c:{kind:string})=>c.kind==='processes');
        const resource=await readFile(join(state,'evidence',created[0],'resources','processes',processCleanup.id),'utf8');
        assert.equal(await alive(JSON.parse(resource)),false);
      }
      if(mode==='focused'){assert.deepEqual(report.scenarios.filter((s:{status:string})=>s.status==='passed').map((s:{id:string})=>s.id).sort(),['model-routing-desktop','model-routing-execution','model-routing-recovery']);continue;}
      if(mode==='independent-failure'){
        assert.equal(report.graph.state['workflow:model-routing'].status,'failed');
        assert.equal(report.scenarios.find((s:{id:string})=>s.id==='model-routing-desktop').status,'passed','Unrelated branch runs after a sibling fails');
        assert.equal(report.graph.state.cleanup.status,'passed');continue;
      }
      const first = report.scenarios.find((s: {id:string}) => s.id === ids[0]);
      if (mode === 'missing' || mode === 'command-failure') assert.equal(first.status, 'blocked');
      if (mode === 'skipped') assert.equal(first.status, 'skipped');
      if (mode === 'retry') { assert.equal(first.status, 'failed'); assert.equal(first.attempts.length, 2); }
      if (mode === 'source-change') assert.equal(report.sourceValid, false);
    }
    await writeFile(join(checkout,'mode.txt'),'interrupt');
    const previous=new Set(await readdir(join(state,'evidence')));
    const interrupted=spawn(process.execPath,['--import',import.meta.resolve('tsx'),fileURLToPath(new URL('../../scripts/dev/verify.ts',import.meta.url)),'--profile','quick'],{cwd:checkout,env:{...process.env,ASH_DEV_ROOT:state},detached:true,stdio:'ignore'});
    const exited=new Promise<number|null>(resolve=>interrupted.once('close',resolve)),owner=await processRef(interrupted.pid!);
    try{
      for(let n=0;n<500&&!await exists(join(checkout,'interrupt-ready'));n++)await new Promise(resolve=>setTimeout(resolve,10));
      assert.ok(await exists(join(checkout,'interrupt-ready')),'Real verifier reached owned process boundary');
      interrupted.kill('SIGTERM');
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{assert.notEqual(await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Verifier cancellation exceeded its grace period')),12000);})]),0);}finally{clearTimeout(timer);}
      const created=(await readdir(join(state,'evidence'))).filter(name=>!previous.has(name));assert.equal(created.length,1);
      const report=JSON.parse(await readFile(join(state,'evidence',created[0],'report.json'),'utf8'));
      assert.equal(report.interrupted,true);assert.equal(report.passed,false);assert.equal(report.graph.state.cleanup.status,'passed');
      assert.equal(report.cleanup.length,1);assert.equal(report.cleanup[0].status,'passed');
      const resource=JSON.parse(await readFile(join(state,'evidence',created[0],'resources/processes',report.cleanup[0].id),'utf8'));
      assert.equal(await alive(resource),false,'Interrupted run recovers its detached child');
    }finally{
      await stopProcess(owner,true);
      for(const directory of (await readdir(join(state,'evidence'))).filter(name=>!previous.has(name))){
        const resources=join(state,'evidence',directory,'resources/processes');
        for(const file of await readdir(resources).catch(()=>[]))await stopProcess(JSON.parse(await readFile(join(resources,file),'utf8')),true);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
