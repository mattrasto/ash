import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {buildProtectedRenderer} from '../../scripts/dev/protected-renderer.ts';
import {prepareRenderer} from '../../scripts/dev/renderer-candidate.ts';
import {git} from '../../packages/server/src/modules/adapt/source.ts';
import {scenarioStep} from '../support/node-scenarios.ts';

test('Protected compiler asset reads',{timeout:60000},async t=>{
  await scenarioStep(t,'adapt-compiler-assets',async()=>{
    const root=await mkdtemp(join(tmpdir(),'ash-compiler-')),candidate=join(root,'source'),renderer=join(candidate,'packages/client/src/renderer'),canary=join(root,'private.png'),secret='PRIVATE_COMPILER_CANARY';
    const emitted=async(output:string)=>{const path=join(output,'renderer/assets');return (await readdir(path).catch(()=>[])).map(file=>join(path,file));};
    const noCanary=async(output:string)=>{for(const file of await emitted(output)){const bytes=await readFile(file,'utf8');assert.ok(!bytes.includes(secret)&&!bytes.includes(Buffer.from(secret).toString('base64')));}};
    try{
      await mkdir(renderer,{recursive:true});await writeFile(canary,secret);
      await writeFile(join(candidate,'packages/client/index.html'),'<div id="app"></div><script type="module" src="/src/renderer/main.ts"></script>');
      await writeFile(join(renderer,'main.ts'),'import {mount} from "svelte";import View from "./View.svelte";import "./style.css";mount(View,{target:document.getElementById("app")!});');
      await writeFile(join(renderer,'View.svelte'),'<script lang="ts">let label:string="Protected renderer";</script><h1>{label}</h1><style>h1{color:blue}</style>');
      await writeFile(join(renderer,'local.png'),'LOCAL_RENDERER_ASSET');await writeFile(join(renderer,'style.css'),'body {background-image:url("./local.png?inline")}');
      await git(candidate,['init','-q']);await git(candidate,['add','--all']);const base=await git(candidate,['write-tree']);await prepareRenderer(candidate,base,process.cwd());
      const valid=join(root,'valid');await buildProtectedRenderer(candidate,valid,process.cwd()).catch(async error=>{console.error(await readFile(join(valid,'compiler.log'),'utf8'));throw error;});assert.ok((await emitted(valid)).length);await noCanary(valid);
      await writeFile(join(renderer,'style.css'),'body {background-image:url('+JSON.stringify('/@fs'+canary+'?inline')+')}');
      await git(candidate,['add','packages/client/src/renderer']);await prepareRenderer(candidate,base,process.cwd());
      const denied=join(root,'denied');await assert.rejects(()=>buildProtectedRenderer(candidate,denied,process.cwd()),/Protected renderer compilation failed/);assert.match(await readFile(join(denied,'compiler.log'),'utf8'),/permission: 'FileSystemRead'/);await noCanary(denied);
      await writeFile(join(renderer,'style.css'),'body{color:black}');await writeFile(join(renderer,'main.ts'),'document.body.textContent=new URL('+JSON.stringify(relative(renderer,canary)) + ',import.meta.url).href;');
      const url=join(root,'url');await buildProtectedRenderer(candidate,url,process.cwd());await noCanary(url);
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
