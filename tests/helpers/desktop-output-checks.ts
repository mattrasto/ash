import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, symlink, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, exists, processRef, sleep, stopProcess } from '../../scripts/dev/io.ts';
import { recordResource } from '../../scripts/dev/telemetry.ts';

// Exercise the actual runner's startup cleanup without provisioning an app.
export async function checkDesktopOutputIsolation() {
  const root = await mkdtemp(join(tmpdir(), 'ash-desktop-output-'));
  let owner: Awaited<ReturnType<typeof processRef>> | undefined;
  try {
    await symlink(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');
    const config = join(root, 'playwright.config.ts');
    await writeFile(config, `import base from ${JSON.stringify(fileURLToPath(new URL('../playwright.config.ts', import.meta.url)))}; export default {...base,testDir:${JSON.stringify(root)},reporter:'line',timeout:30000};`);
    await writeFile(join(root, 'first.spec.cjs'), `
const {test,expect}=require('@playwright/test'),fs=require('node:fs'),path=require('node:path');
test('first',async({},info)=>{
  const artifact=info.outputPath('trace.zip');fs.mkdirSync(path.dirname(artifact),{recursive:true});fs.writeFileSync(artifact,'owned trace');
  fs.writeFileSync(${JSON.stringify(join(root, 'ready'))},artifact);
  while(!fs.existsSync(${JSON.stringify(join(root, 'release'))}))await new Promise(resolve=>setTimeout(resolve,10));
  expect(fs.readFileSync(artifact,'utf8')).toBe('owned trace');
});`);
    await writeFile(join(root, 'second.spec.cjs'), `const {test}=require('@playwright/test');test('second',async()=>{});`);
    const env: NodeJS.ProcessEnv = {...process.env, ASH_TEST_EVIDENCE: join(root, 'evidence')};
    delete env.NODE_TEST_CONTEXT;
    const args = [fileURLToPath(import.meta.resolve('@playwright/test/cli')), 'test', '--config', config];
    const first = spawn(process.execPath, [...args, 'first.spec.cjs'], {cwd:root,env:{...env,ASH_TEST_NODE_ID:'desktop:first'},detached:true,stdio:['ignore','pipe','pipe']});
    let output = '', finished = false;
    first.stdout.on('data', chunk => {output += chunk.toString();});first.stderr.on('data', chunk => {output += chunk.toString();});
    first.once('error', error => {output += String(error);});
    const closed = new Promise<number | null>(resolve => first.once('close', code => {finished=true;resolve(code);}));
    owner = await processRef(first.pid!);
    recordResource('processes',String(owner.pid),owner);
    for (let n=0;n<1500&&!finished&&!await exists(join(root,'ready'));n++) await sleep(10);
    assert.ok(await exists(join(root,'ready')),output || 'First runner did not reach its artifact boundary');
    await exec(process.execPath,[...args,'second.spec.cjs'],{cwd:root,env:{...env,ASH_TEST_NODE_ID:'desktop:second'},timeout:20000});
    const artifact = await readFile(join(root,'ready'),'utf8');
    assert.ok(await exists(artifact),'Starting a second graph node must preserve the first node’s trace');
    await writeFile(join(root,'release'),'');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { assert.equal(await Promise.race([closed,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Desktop output probe did not finish')),12000);})]),0,output); }
    finally {clearTimeout(timer);}
  } finally {
    await writeFile(join(root,'release'),'');
    if (owner) await stopProcess(owner,true);
    await rm(root,{recursive:true,force:true});
  }
}
