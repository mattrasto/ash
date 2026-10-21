import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, writeFile, symlink, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerConfig, RunState, CreateDecision, DecisionRequest, PermissionEvaluation, PermissionPolicy, SavePermission, policyText, type RequestPayload, type ToolCall, type ToolAction } from '../../packages/shared/src/index.ts';
import { Decisions, DecisionWait, decisionView, fingerprint } from '../../packages/server/src/modules/decisions/service.ts';
import { Permissions } from '../../packages/server/src/modules/permissions/service.ts';
import { filesystemResource } from '../../packages/server/src/modules/permissions/authoring.ts';
import { defaultPermissions, secretsPermissionId, permissionId } from '../../packages/server/src/modules/permissions/defaults.ts';
import { JevEvaluator, offlineEvaluator, type Evaluator } from '../../packages/server/src/modules/permissions/evaluator.ts';
import { Threads } from '../../packages/server/src/modules/threads/service.ts';
import { decisionRuntime } from '../../packages/server/src/modules/decisions/tools.ts';
import { filesystemRuntime,loadFilesystemConfig } from '../../packages/server/src/modules/filesystem/runtime.ts';
import { composeToolRuntimes, registerTool, type ToolRuntime } from '../../packages/server/src/modules/tools/contract.ts';
import { deterministicModel } from '../../packages/server/src/platform/models/deterministic.ts';
import type { ModelAdapter } from '../../packages/server/src/platform/models/adapter.ts';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { workspace, createInstance } from '../../scripts/dev/workspace.ts';
import { startInstance, stopInstance, disposeInstance, runtime } from '../../scripts/dev/lifecycle.ts';
import { devRoot, json, exec } from '../../scripts/dev/io.ts';
import { makeWorktree } from '../helpers/worktree.ts';
import { scenarioStep } from '../support/node-scenarios.ts';
import { crmPermissionPrompt, permissionAuthoringCases } from '../fixtures/permission-authoring.ts';
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until<T>(get:()=>Promise<T>,ready:(value:T)=>boolean){for(let i=0;i<500;i++){const value=await get();if(ready(value))return value;await pause(20);}throw new Error('Timed out waiting for Decision progress.');}
const call=(name:string,args:unknown):ToolCall=>({name,arguments:JSON.stringify(args),callId:randomUUID()});
const scripted=(calls:ToolCall[]):ModelAdapter=>({...deterministicModel,async *stream(request){if(request.tools?.previousOutputIds.length)yield 'Completed from the saved answers and evidence.';else yield {kind:'output' as const,calls};}});

test('Permissions and Decisions: durable policy, immutable answers and resumption',{timeout:240000},async t=>{
  const base=await realpath(await mkdtemp(join(tmpdir(),'ash-decisions-'))),source=process.cwd(),checkout=join(base,'checkout');await makeWorktree(source,checkout);
  const ws=await workspace(checkout,await devRoot()),instance=await createInstance(ws,'test','empty');
  const config=ServerConfig.parse(await json(join(instance.root,'server.json'))),db=connectProduct(config.databaseUrl);
  const files=join(base,'files');await exec('mkdir',['-p',files]);await writeFile(join(files,'a.ts'),'function one() {}\n');await writeFile(join(files,'b.ts'),'function two() {}\n');
  const fsConfig={version:1 as const,scopes:[{path:files,operations:['read','list','glob','search'] as ('read'|'list'|'glob'|'search')[],excludedNames:[]}]};
  const decisions=new Decisions(db),permissions=new Permissions(db,decisions,offlineEvaluator);await permissions.seed(fsConfig);
  const services:Threads[]=[];
  const service=(model:ModelAdapter,auto=true,tools:ToolRuntime=composeToolRuntimes(decisionRuntime(decisions),filesystemRuntime(async()=>structuredClone(fsConfig))))=>{const value=new Threads(db,model,auto,undefined,tools,undefined,decisions,permissions);services.push(value);return value;};
  const start=async(value:Threads,text='Read')=>{const thread=randomUUID();await value.createThread(thread,'Decision fixture');return {thread,run:await value.submit(thread,randomUUID(),text,'normal')};};
  const wait=async(id:string,status:string)=>until(()=>db.run.findUniqueOrThrow({where:{id}}),r=>{if(['failed','interrupted','cancelled','completed'].includes(r.status)&&r.status!==status)throw new Error(JSON.stringify({status:r.status,error:r.error,calls:RunState.parse(r.state).tools?.calls}));return r.status===status;});
  const askRule=()=>({id:randomUUID(),category:'filesystem',effect:'ask',policy:{kind:'explicit',verb:'read_file',resource:{type:'filesystem',path:join(files,'b.ts'),scope:'file'}}});
  const readCall=()=>call('filesystem.read',{path:join(files,'b.ts'),startLine:1,maxLines:20});
  try{
    await scenarioStep(t,'permissions-defaults',async()=>{
      const send=defaultPermissions[1],publish=defaultPermissions[2],computer=(await permissions.list()).find(rule=>rule.category==='computer_use')!;
      const controlled=new Permissions(db,decisions,{async evaluate(_packet,questions){return {model:'controlled',answers:Object.fromEntries(questions.map(q=>[q.id,{value:q.id==='sensitivity'||q.id.startsWith('rule.'+secretsPermissionId)?'does_not_apply' as const:'applies' as const}]))};}});
      const action={operation:'computer.click',resources:[{kind:'computer',id:'local',label:'This computer'}],effects:['control']};
      const check=(effects=action.effects)=>controlled.evaluate({...action,effects},'computer-default',new AbortController().signal,undefined,{text:'Use the computer',inputId:randomUUID(),resourceAccess:'capability-only'});
      assert.equal((await check()).outcome,'allowed');assert.equal((await check(['send'])).outcome,'needs-input');assert.equal((await check(['publish'])).outcome,'needs-input');
      await permissions.save({id:computer.id,category:computer.category,policy:computer.policy,effect:'ask'});assert.equal((await check()).outcome,'needs-input');
      await permissions.save({id:computer.id,category:computer.category,policy:computer.policy,effect:'deny'});assert.equal((await check(['send'])).outcome,'denied');
      // Untouched legacy defaults adopt the new exact predicates, while custom wording stays qualified.
      for(const [rule,word,effect] of [[send,'Sending as the user.','send'],[publish,'Publishing as the user.','publish']] as const)await db.permission.update({where:{id:rule.id},data:{policy:{kind:'activity',explicit:[{kind:'eq',field:'effect',value:effect}],semantic:{condition:word,examples:[]}}}});
      await permissions.seed(fsConfig);let saved=await permissions.list();assert.deepEqual(saved.find(r=>r.id===send.id)!.policy,send.policy);assert.deepEqual(saved.find(r=>r.id===publish.id)!.policy,publish.policy);assert.equal(saved.find(r=>r.id===computer.id)!.effect,'deny');
      const customized=SavePermission.parse({...send,policy:{kind:'semantic',condition:'Send messages only to my team',examples:['External recipients are excluded.']}});
      await permissions.save(customized);await permissions.remove(publish.id);await permissions.remove(computer.id);await permissions.seed(fsConfig);
      saved=await permissions.list();assert.deepEqual(saved.find(rule=>rule.id===send.id)!.policy,customized.policy);assert.ok(!saved.some(rule=>rule.id===publish.id||rule.id===computer.id));
      await permissions.save({...send,effect:'allow'});await permissions.seed(fsConfig);assert.equal((await permissions.list()).find(r=>r.id===send.id)!.effect,'allow');await permissions.save(send);
    });
    await scenarioStep(t,'permissions-filesystem-authoring',async()=>{
      const signal=new AbortController().signal,nested=join(files,'nested');await mkdir(nested);await writeFile(join(nested,'deep.ts'),'ordinary synthetic fixture');
      const checked=new Permissions(db,decisions,{async evaluate(packet,questions){return {model:'controlled-secrets',answers:Object.fromEntries(questions.map(q=>[q.id,{value:q.id.startsWith('rule.'+secretsPermissionId)&&(packet as any).action.facts?.containsSecrets?'applies' as const:'does_not_apply' as const}]))};}});
      const read=(path:string,containsSecrets=false)=>checked.evaluate({operation:'filesystem.read',effects:['read'],resources:[{kind:'filesystem',id:path,label:path}],facts:{containsSecrets}},'path-authoring',signal);
      assert.equal((await filesystemResource({path:files})).scope,'subtree');assert.equal((await filesystemResource({path:join(files,'a.ts')})).scope,'file');
      assert.equal((await filesystemResource({path:join(files,'future.txt')})).scope,'file');assert.equal((await filesystemResource({path:join(files,'future-folder')+'/'})).scope,'subtree');
      const direct=await checked.save({id:randomUUID(),category:'filesystem',effect:'deny',policy:{kind:'explicit',verb:'read',resource:await filesystemResource({path:files+'/*.ts'})}});
      assert.equal((await read(join(files,'a.ts'))).outcome,'denied');assert.equal((await read(join(nested,'deep.ts'))).outcome,'allowed');await checked.remove(direct.id);
      const recursive=await checked.save({id:randomUUID(),category:direct.category,effect:direct.effect,policy:{kind:'explicit',verb:'read',resource:await filesystemResource({path:files+'/**/*.ts'})}});
      assert.equal((await read(join(files,'a.ts'))).outcome,'denied');assert.equal((await read(join(nested,'deep.ts'))).outcome,'denied');await checked.remove(recursive.id);
      const another=join(base,'another-project');await mkdir(another);await writeFile(join(another,'.env.local'),'SYNTHETIC_ONLY');
      assert.equal((await read(join(another,'.env.local'))).outcome,'denied');assert.equal((await read(join(another,'private.pem'))).outcome,'denied');
      const local=await checked.save({id:randomUUID(),category:'filesystem',effect:'allow',policy:{kind:'explicit',verb:'read',resource:await filesystemResource({path:another+'/*.pem'})}});
      assert.equal((await read(join(another,'private.pem'))).outcome,'allowed');assert.equal((await read(join(another,'deeper','private.pem'))).outcome,'denied');await checked.remove(local.id);
      const tree=await checked.save({id:randomUUID(),category:'filesystem',effect:'deny',policy:{kind:'explicit',verb:'read',resource:await filesystemResource({path:files+'/*/**'})}});
      const subtree=await checked.save({id:randomUUID(),category:'filesystem',effect:'allow',policy:{kind:'explicit',verb:'read',resource:await filesystemResource({path:nested})}});
      assert.equal((await read(join(nested,'deep.ts'))).outcome,'allowed');assert.equal((await read(join(files,'a.ts'))).outcome,'denied');await checked.remove(tree.id);await checked.remove(subtree.id);
      const secret=join(files,'innocent-name.txt');assert.equal((await read(secret,true)).outcome,'denied');
      const exception=await checked.save({id:randomUUID(),category:'filesystem',effect:'allow',policy:{kind:'explicit',verb:'read',resource:await filesystemResource({path:secret})}});
      assert.equal((await read(secret,true)).outcome,'denied');await checked.remove(exception.id);
      assert.equal((await read(join(files,'.git','config'))).outcome,'allowed');assert.equal((await read(join(files,'node_modules','package','index.js'))).outcome,'allowed');
      await assert.rejects(filesystemResource({path:files+'/*/../escape'}),/patterns/);
      const old=await checked.save({id:permissionId({filesystemScope:files,exclusion:'.git'}),category:'filesystem',effect:'deny',policy:{kind:'explicit',verb:'read',resource:{type:'filesystem',path:files,scope:'subtree',pattern:'.git'}}});
      const edited=await checked.save({id:permissionId({filesystemScope:files,exclusion:'node_modules'}),category:old.category,effect:'ask',policy:{kind:'explicit',verb:'read',resource:{type:'filesystem',path:files,scope:'subtree',pattern:'node_modules'}}});
      await checked.seed(fsConfig,files);assert.ok(!(await checked.list()).some(r=>r.id===old.id));assert.equal((await checked.list()).find(r=>r.id===edited.id)!.effect,'ask');await checked.remove(edited.id);
      const linkedDefault=await checked.save({id:permissionId({filesystemScope:files,exclusion:'out'}),category:'filesystem',effect:'deny',policy:{kind:'explicit',verb:'read',resource:{type:'filesystem',path:files,scope:'subtree',pattern:'out'}}});
      // Established reviewed authority is fixture state; the operation under test is default cleanup.
      const linkedRule=SavePermission.parse({id:randomUUID(),category:'filesystem',effect:'allow',policy:{kind:'semantic',condition:`Read the public generated report at ${join(files,'out','public.txt')}`,overrides:[linkedDefault.id]}});
      await db.permission.create({data:{...linkedRule,createdAt:new Date(),updatedAt:new Date()}});await checked.seed(fsConfig,files);
      assert.ok((await checked.list()).some(r=>r.id===linkedDefault.id));const cleanup=await checked.review({rules:[],removeIds:[linkedRule.id]});await checked.commit({rules:cleanup.rules,removeIds:cleanup.removeIds,reviewToken:cleanup.reviewToken});await checked.remove(linkedDefault.id);
      const global=(await checked.list()).find(r=>r.id===defaultPermissions.at(-1)!.id)!;await checked.changeEffect({id:global.id,category:global.category,effect:'ask',policy:global.policy});
      await checked.seed(fsConfig,files);assert.equal((await checked.list()).find(r=>r.id===global.id)!.effect,'ask');await checked.changeEffect({id:global.id,category:global.category,effect:'deny',policy:global.policy});
      await rm(nested,{recursive:true});await rm(another,{recursive:true});
    });
    await scenarioStep(t,'permissions-policy',async()=>{
      const action={operation:'filesystem.read',resources:[{kind:'filesystem',id:join(files,'b.ts'),label:'b.ts'}],effects:['read']};
      assert.equal((await permissions.evaluate(action,'binding',new AbortController().signal)).outcome,'allowed');
      const ask=await permissions.save(askRule());
      assert.equal((await permissions.evaluate(action,'binding',new AbortController().signal)).outcome,'needs-input');
      const deny=await permissions.save({...askRule(),effect:'deny',category:'interaction'});
      assert.equal((await permissions.evaluate(action,'binding',new AbortController().signal)).outcome,'denied');
      await assert.rejects(permissions.save({id:deny.id,policy:deny.policy,effect:deny.effect,category:'filesystem'}));
      await permissions.remove(deny.id);await permissions.remove(ask.id);
      const semantic=await permissions.save({id:randomUUID(),category:'interaction',effect:'ask',policy:{kind:'semantic',condition:'Contacting someone outside my company.',examples:['Drafting is excluded.']}});
      const seen:unknown[]=[];const evaluator:Evaluator={async evaluate(packet,questions){seen.push(packet);return {model:'controlled',answers:Object.fromEntries(questions.map(q=>[q.id,{value:q.id==='sensitivity'||q.id.startsWith('rule.'+secretsPermissionId)?'does_not_apply' as const:'applies' as const}]))};}};
      const sem=new Permissions(db,decisions,evaluator);assert.equal((await sem.evaluate(action,'binding',new AbortController().signal)).outcome,'needs-input');assert.ok(!JSON.stringify(seen).includes('category'));
      await permissions.remove(semantic.id);
      const semanticDeny=await permissions.save({id:randomUUID(),category:'filesystem',effect:'deny',policy:{kind:'semantic',condition:'Read file contents when the project is archived.',examples:[]}});
      const notArchived=new Permissions(db,decisions,{async evaluate(_packet,questions){return {model:'controlled',answers:Object.fromEntries(questions.map(q=>[q.id,{value:'does_not_apply' as const}]))};}});
      assert.equal((await notArchived.evaluate(action,'binding',new AbortController().signal)).outcome,'allowed');
      assert.equal((await sem.evaluate(action,'binding',new AbortController().signal)).outcome,'denied');await permissions.remove(semanticDeny.id);
      const unavailable=new Permissions(db,decisions,{async evaluate(_packet,questions){return {model:'failed',answers:Object.fromEntries(questions.map(q=>[q.id,{value:'insufficient_evidence' as const,error:'timeout'}]))};}});assert.equal((await unavailable.evaluate(action,'binding',new AbortController().signal)).outcome,'blocked');
      const formalized=await permissions.formalize({text:`Don't read from ${files}`,category:'filesystem',effect:'ask'});assert.equal(formalized.rules[0].effect,'deny');assert.ok(formalized.rules[0].policy.kind==='explicit');assert.ok(!('original_text' in formalized.rules[0].policy));
      const qualified=await permissions.formalize({text:`On Mondays, allow reading from ${files}`,category:'filesystem',effect:'allow'});assert.equal(qualified.rules[0].policy.kind,'semantic');assert.equal(policyText(qualified.rules[0].policy),`On Mondays, allow reading from ${files}`);
      const conditional=await permissions.save({id:randomUUID(),category:'filesystem',effect:'allow',policy:{kind:'semantic',condition:'Read files when the project is active.',examples:[]}});
      const negative=new Permissions(db,decisions,{async evaluate(_packet,questions){return {model:'controlled',answers:Object.fromEntries(questions.map(q=>[q.id,{value:'does_not_apply' as const}]))};}});assert.equal((await negative.evaluate(action,'binding',new AbortController().signal)).outcome,'allowed');await permissions.remove(conditional.id);
      let wire:Record<string,any>|undefined;const transport:typeof fetch=async(_url,options)=>{wire=JSON.parse(String(options!.body));return new Response(JSON.stringify({model:'jev-1.13.0',usage:{input_tokens:100,output_tokens:0},answers:{sensitivity:{type:'choice',choice:'does_not_apply',probabilities:{applies:0.01,does_not_apply:0.98,insufficient_evidence:0.01}}}}),{status:200});};
      const jev=new JevEvaluator('synthetic-key',transport);assert.equal((await jev.evaluate({action},[{id:'sensitivity',instructions:'Question'}],new AbortController().signal)).answers.sensitivity.value,'does_not_apply');assert.equal(wire!.questions.sensitivity.type,'choice');
    });
    await scenarioStep(t,'permissions-reviewed-overrides',async()=>{
      const signal=new AbortController().signal,send=defaultPermissions[1],john='john@example.com';
      const predicates=new Map<string,(action:any)=>'applies'|'does_not_apply'|'insufficient_evidence'>();
      const controlled=new Permissions(db,decisions,{async evaluate(packet,questions){const data=packet as any;return {model:'controlled-targets',answers:Object.fromEntries(questions.map(q=>{
        if(q.id==='sensitivity'||q.id==='coverage')return [q.id,{value:'does_not_apply' as const}];
        const id=q.id.slice(5).split('.target.')[0],index=Number(q.id.split('.target.')[1]??0);
        return [q.id,{value:predicates.get(id)?.(data.targets[index].action)??'does_not_apply'}];
      }))};}});
      const sendAction=(recipients=[john],work=false,outside=false)=>({operation:'fixture.send',effects:['send'],resources:recipients.map(id=>({kind:'contact',id,label:id})),facts:{work,outside}});
      const evaluate=(action:ToolAction=sendAction())=>controlled.evaluate(action,'reviewed-send',signal);
      const commit=async(rules:unknown[],removeIds:string[]=[])=>{const review=await controlled.review({rules,removeIds});await controlled.commit({rules:review.rules,removeIds:review.removeIds,reviewToken:review.reviewToken});return review;};
      const computerBase=await controlled.save({id:randomUUID(),category:'computer_use',effect:'deny',policy:{kind:'explicit',verb:'use',resource:{type:'computer'}}});
      const appAllow=await controlled.save({id:randomUUID(),category:'computer_use',effect:'allow',policy:{kind:'explicit',verb:'use',resource:{type:'computer',appId:'com.example.browser'}}});
      const computerAction={operation:'computer.click',effects:['control'],resources:[{kind:'computer',id:'local',label:'Computer'}],facts:{appId:'com.example.browser'}};
      assert.equal((await controlled.evaluate(computerAction,'computer-scope',signal)).outcome,'allowed');assert.equal((await controlled.evaluate({...computerAction,facts:{appId:'com.example.editor'}},'computer-scope',signal)).outcome,'denied');assert.equal((await controlled.evaluate({...computerAction,effects:['control','send']},'computer-scope',signal)).outcome,'needs-input');
      await controlled.remove(computerBase.id);await controlled.remove(appAllow.id);
      const parent=await permissions.save({id:randomUUID(),category:'filesystem',effect:'deny',policy:{kind:'explicit',verb:'read',resource:{type:'filesystem',path:files,scope:'subtree'}}});
      const child=await permissions.save({...askRule(),effect:'allow'});
      const aliasParent=join(base,'scope-alias');await symlink(files,aliasParent);
      await assert.rejects(permissions.save({...askRule(),policy:{kind:'explicit',verb:'read',resource:{type:'filesystem',path:join(aliasParent,'future.txt'),scope:'file'}}}),/canonical path/);
      const canonicalProposal=await permissions.formalize({text:`Never read from ${join(aliasParent,'future.txt')}`,category:'filesystem',effect:'ask'});assert.ok(policyText(canonicalProposal.rules[0].policy).includes(join(files,'future.txt')));await rm(aliasParent);

      assert.equal((await controlled.evaluate({operation:'filesystem.read',effects:['read'],resources:[{kind:'filesystem',id:join(files,'b.ts'),label:'b'}]},'path',signal)).outcome,'allowed');
      assert.equal((await controlled.evaluate({operation:'filesystem.read',effects:['read'],resources:[{kind:'filesystem',id:join(files,'a.ts'),label:'a'}]},'path',signal)).outcome,'denied');
      await permissions.remove(parent.id);await permissions.remove(child.id);
      const narrow=SavePermission.parse({id:randomUUID(),category:'interaction',effect:'allow',policy:{kind:'semantic',condition:'Send messages to John Smith (john@example.com)'}});
      predicates.set(narrow.id,a=>a.facts?.unknown?'insufficient_evidence':a.effects.includes('send')&&a.facts?.recipient===john?'applies':'does_not_apply');
      await controlled.save(narrow);assert.equal((await evaluate()).outcome,'needs-input');
      const linked=SavePermission.parse({...narrow,policy:{...narrow.policy,overrides:[send.id]}});
      await assert.rejects(controlled.save(linked),/Review/);await commit([linked]);
      let result=await evaluate();assert.equal(result.outcome,'allowed');assert.deepEqual(result.overrides.map(o=>o.broaderId),[send.id]);assert.ok(!result.effectiveRuleIds!.includes(send.id));
      const external=await controlled.save({id:randomUUID(),category:'interaction',effect:'deny',policy:{kind:'semantic',condition:'Send work files outside my company'}});
      predicates.set(external.id,a=>a.facts?.work&&a.facts?.outside?'applies':'does_not_apply');
      assert.equal((await evaluate(sendAction([john],true,true))).outcome,'denied');
      await commit([], [narrow.id]);
      const specific=SavePermission.parse({id:randomUUID(),category:'interaction',effect:'allow',policy:{kind:'semantic',condition:'Send work files outside my company to John Smith (john@example.com)',overrides:[external.id]}});
      predicates.set(specific.id,a=>a.facts?.unknown?'insufficient_evidence':a.facts?.work&&a.facts?.outside&&a.facts?.recipient===john?'applies':'does_not_apply');
      await commit([specific]);assert.equal((await evaluate(sendAction([john],true,true))).outcome,'needs-input');
      result=await evaluate(sendAction([john,'mary@example.com'],true,true));assert.equal(result.outcome,'denied');assert.equal(result.overrides.length,1);assert.ok(result.overrides[0].target.includes(john));assert.ok(result.effectiveRuleIds!.includes(external.id));
      assert.equal((await evaluate({...sendAction([john],true,true),facts:{work:true,outside:true,unknown:true}})).outcome,'needs-input');
      await assert.rejects(controlled.review({rules:[{...specific,policy:{...specific.policy,overrides:[specific.id]}}]}),/itself/);
      await assert.rejects(controlled.review({rules:[{...specific,policy:{...specific.policy,overrides:[randomUUID()]}}]}),/active/);
      await assert.rejects(controlled.review({rules:[{...specific,policy:{kind:'semantic',condition:'Publish public content',overrides:[external.id]}}]}),/override/);
      await assert.rejects(controlled.review({rules:[{...specific,policy:{kind:'semantic',condition:'Send work files outside my company',overrides:[external.id]}}]}),/override/);
      await assert.rejects(controlled.review({rules:[{...specific,policy:{...specific.policy,overrides:[external.id,external.id]}}]}),/distinct/);
      const cycleA=randomUUID(),cycleB=randomUUID();await assert.rejects(controlled.review({rules:[{...specific,id:cycleA,policy:{kind:'semantic',condition:'Send messages',overrides:[cycleB]}},{...specific,id:cycleB,policy:{kind:'semantic',condition:'Send messages to John',overrides:[cycleA]}}]}),/cycle/);
      const stale=await controlled.review({rules:[{...specific,effect:'ask'}]});
      const unrelated=await controlled.save({id:randomUUID(),category:'filesystem',effect:'ask',policy:{kind:'explicit',verb:'perform',resource:{type:'operation',name:'fixture.unrelated'}}});
      await assert.rejects(controlled.commit({rules:stale.rules,removeIds:stale.removeIds,reviewToken:stale.reviewToken}),/changed since/);
      const fresh=await controlled.review({rules:[{...specific,effect:'ask'}]});await assert.rejects(controlled.commit({rules:[{...specific,effect:'deny'}],removeIds:[],reviewToken:fresh.reviewToken}),/draft changed/);
      await controlled.commit({rules:fresh.rules,removeIds:fresh.removeIds,reviewToken:fresh.reviewToken});
      await assert.rejects(controlled.changeEffect({...specific,effect:'deny'}),/Review/);
      const impact=await commit([{id:external.id,category:external.category,effect:'ask',policy:external.policy}]);assert.ok(impact.affected.some(r=>r.id===specific.id));
      const removal=await commit([], [external.id]);assert.ok(removal.affected.some(r=>r.id===specific.id));
      const saved=(await controlled.list()).find(r=>r.id===specific.id)!;assert.equal(saved.policy.kind,'semantic');if(saved.policy.kind==='semantic')assert.deepEqual(saved.policy.overrides,[]);
      await controlled.remove(specific.id);await controlled.remove(unrelated.id);
    });
    await scenarioStep(t,'permissions-policy-migration',async()=>{
      const legacyRoot=join(base,'legacy');await exec('mkdir',['-p',legacyRoot]);await writeFile(join(legacyRoot,'readme.txt'),'Legacy file');await writeFile(join(legacyRoot,'.env.local'),'synthetic');
      const id=randomUUID(),mixedId=randomUUID(),retired=randomUUID(),now=new Date();
      const old={kind:'resource',wording:'Legacy partial read access',explicit:[{kind:'path',root:legacyRoot,operations:['read']}]};
      const mixed={kind:'activity',explicit:[{kind:'path',root:legacyRoot,operations:['read']},{kind:'eq',field:'recipient',value:'outside@example.com'}],semantic:{condition:'The recipient is outside Acme.',examples:['Drafting is excluded.']}};
      for(const [ruleId,policy,deletedAt] of [[id,old,null],[mixedId,mixed,null],[retired,old,now]] as const)await db.permission.create({data:{id:ruleId,category:'filesystem',effect:ruleId===mixedId?'ask':'allow',policy,createdAt:now,updatedAt:now,deletedAt}});
      const historical={type:'permission_evaluation',action:{operation:'filesystem.read',resources:[{kind:'filesystem',id:join(legacyRoot,'readme.txt'),label:'Legacy'}],effects:['read']},binding:'legacy-binding',rules:[{id,category:'filesystem',effect:'allow',policy:old,createdAt:now.toISOString(),updatedAt:now.toISOString(),deletedAt:null}],matches:{[id]:'applies'},outcome:'allowed',reasons:[],sensitivity:'does_not_apply',coverage:'does_not_apply',answers:{},model:'legacy'};
      assert.deepEqual(PermissionEvaluation.parse(historical).rules[0].policy,old);
      const proposal=await decisions.create({id:randomUUID(),request:{kind:'question',form:'text',question:'Legacy proposal?',reason:'Retain the exact reviewed request.',proposal:{id:randomUUID(),category:'filesystem',effect:'ask',policy:mixed}}});const before=fingerprint((await db.decision.findUniqueOrThrow({where:{id:proposal.id}})).request);
      const config={version:1 as const,scopes:[{path:legacyRoot,operations:['read'] as 'read'[],excludedNames:['.env*']}]};await permissions.seed(config);
      const rows=await permissions.list(),converted=rows.find(r=>r.id===id)!;assert.equal(converted.policy.kind,'explicit');assert.equal((await db.permission.findUniqueOrThrow({where:{id:retired}})).deletedAt?.toISOString(),now.toISOString());
      const mixedRule=rows.find(r=>r.id===mixedId)!;assert.equal(mixedRule.policy.kind,'semantic');assert.ok(policyText(mixedRule.policy).includes('outside@example.com'));assert.ok(policyText(mixedRule.policy).includes('AND'));assert.equal(fingerprint((await db.decision.findUniqueOrThrow({where:{id:proposal.id}})).request),before);
      assert.ok(rows.some(r=>r.policy.kind==='explicit'&&r.policy.resource.type==='filesystem'&&r.policy.resource.pattern==='.env*'));
      // Remove the semantic fixture before testing exact conversion with the offline evaluator.
      await permissions.remove(mixedId);
      const action=(operation:string,file:string)=>({operation:`filesystem.${operation}`,effects:['read'],resources:[{kind:'filesystem',id:join(legacyRoot,file),label:file}]});
      assert.equal((await permissions.evaluate(action('read','readme.txt'),'migration',new AbortController().signal)).outcome,'allowed');
      assert.equal((await permissions.evaluate(action('list','readme.txt'),'migration',new AbortController().signal)).outcome,'denied');
      assert.equal((await permissions.evaluate(action('read','.env.local'),'migration',new AbortController().signal)).outcome,'denied');
      const managed=filesystemRuntime(async()=>config,'all',true);
      assert.equal((await managed.authorize(action('read','.env.local'),{runId:randomUUID(),threadId:randomUUID(),callId:randomUUID(),signal:new AbortController().signal})).outcome,'allowed');
      const exactAllow=await permissions.save({id:randomUUID(),category:'filesystem',effect:'allow',policy:{kind:'explicit',verb:'read_file',resource:{type:'filesystem',path:join(legacyRoot,'.env.local'),scope:'file'}}});
      assert.equal((await permissions.evaluate(action('read','.env.local'),'migration',new AbortController().signal)).outcome,'allowed');await permissions.remove(exactAllow.id);

      const beforeCount=await db.permission.count();await permissions.seed(config);assert.equal(await db.permission.count(),beforeCount);
      // A reviewed legacy approval survives representation-only conversion, but not a real policy change.
      const legacyAskId=randomUUID(),legacyAsk={kind:'activity',explicit:[{kind:'path',root:join(legacyRoot,'readme.txt'),operations:['read']}]};
      const currentSecret=(await permissions.list()).find(r=>r.id===secretsPermissionId)!;
      await db.permission.create({data:{id:legacyAskId,category:'filesystem',effect:'ask',policy:legacyAsk,createdAt:now,updatedAt:now}});
      const oldRules=[{id,category:'filesystem',effect:'allow',policy:old,createdAt:now.toISOString(),updatedAt:now.toISOString(),deletedAt:null},{id:legacyAskId,category:'filesystem',effect:'ask',policy:legacyAsk,createdAt:now.toISOString(),updatedAt:now.toISOString(),deletedAt:null},currentSecret];
      const baseBinding='migration-reviewed-action',legacyBinding=fingerprint({actionBinding:baseBinding,rules:oldRules.filter(r=>r.effect!=='allow').map(r=>({id:r.id,effect:r.effect,policy:r.policy}))}),sourceId=randomUUID(),captureId=randomUUID();
      await db.artifact.create({data:{id:sourceId,layer:'input',actor:'user',payload:{type:'input_text',text:'Read the legacy file'},createdAt:now,updatedAt:now}});
      await db.artifact.create({data:{id:captureId,layer:'act',actor:'ash',sourceId,payload:{...historical,action:action('read','readme.txt'),rules:oldRules,binding:legacyBinding,outcome:'needs-input'},createdAt:now,updatedAt:now}});
      const approval=await decisions.create({id:randomUUID(),sourceArtifactId:captureId,request:{kind:'permission',form:'approval',question:'Approve this read?',reason:'Legacy Ask',action:action('read','readme.txt'),binding:legacyBinding,evaluationArtifactId:captureId,options:[{id:'approve',label:'Approve this action'}]}});
      await decisions.answer(approval.id,{submissionId:randomUUID(),value:'approve'});await permissions.seed(config);
      const reused=await permissions.evaluate(action('read','readme.txt'),baseBinding,new AbortController().signal,[approval.id]);assert.equal(reused.outcome,'allowed');assert.equal(reused.decisionId,approval.id);
      const convertedAsk=(await permissions.list()).find(r=>r.id===legacyAskId)!;await permissions.save({id:convertedAsk.id,category:convertedAsk.category,policy:convertedAsk.policy,effect:'deny'});assert.equal((await permissions.evaluate(action('read','readme.txt'),baseBinding,new AbortController().signal,[approval.id])).outcome,'denied');
      await permissions.remove(legacyAskId);

      for(const rule of await permissions.list())if(rule.policy.kind==='explicit'&&rule.policy.resource.type==='filesystem'&&rule.policy.resource.path===legacyRoot)await permissions.remove(rule.id);
      await decisions.cancel(proposal.id);
      const retiredRoot=join(base,'retired-boundary');await exec('mkdir',['-p',retiredRoot]);await writeFile(join(retiredRoot,'file.txt'),'synthetic');
      const retiredId=randomUUID();await db.permission.create({data:{id:retiredId,category:'filesystem',effect:'allow',policy:{kind:'resource',explicit:[{kind:'path',root:retiredRoot,operations:['list','read','glob','search']}]},createdAt:now,updatedAt:now,deletedAt:now}});
      await permissions.seed();const protective=(await permissions.list()).find(r=>r.policy.kind==='explicit'&&r.policy.resource.type==='filesystem'&&r.policy.resource.path===retiredRoot)!;
      assert.equal(protective.effect,'deny');assert.ok((await db.permission.findUniqueOrThrow({where:{id:retiredId}})).deletedAt);await permissions.remove(protective.id);await permissions.seed();assert.ok(!(await permissions.list()).some(r=>r.id===protective.id));

    });
    await scenarioStep(t,'permissions-traversal-boundaries',async()=>{
      await writeFile(join(files,'.skip.txt'),'EXCLUDED_SYNTHETIC_VALUE');
      const settings={...fsConfig,scopes:[{...fsConfig.scopes[0],excludedNames:['.skip.txt']}]};await permissions.seed(settings);
      const tools=filesystemRuntime(async()=>settings,'all',true),owner=service(scripted([call('filesystem.search',{path:files,query:'EXCLUDED_SYNTHETIC_VALUE',pattern:null})]),true,tools);
      const scanned=await start(owner,'Search the fixture directory');const complete=RunState.parse((await wait(scanned.run.id,'completed')).state).tools!.calls[0];assert.equal(complete.status,'completed');
      const result=await db.artifact.findUniqueOrThrow({where:{id:complete.resultArtifactId}});assert.ok(!JSON.stringify(result.payload).includes('EXCLUDED_SYNTHETIC_VALUE'));assert.ok(JSON.stringify(result.payload).includes('outside permitted access'));assert.equal((await decisions.list(scanned.thread)).length,0);
      const direct=await start(service(scripted([call('filesystem.read',{path:join(files,'.skip.txt'),startLine:1,maxLines:5})]),true,tools));await wait(direct.run.id,'waiting');const question=(await decisions.list(direct.thread)).find(d=>d.status==='pending')!;assert.equal(question.request.options[0].id,'exception');await owner.cancel(direct.run.id);
      const restriction=(await permissions.list()).find(r=>r.policy.kind==='explicit'&&r.policy.resource.type==='filesystem'&&r.policy.resource.pattern==='.skip.txt')!;await permissions.remove(restriction.id);await rm(join(files,'.skip.txt'));
    });
    await scenarioStep(t,'permissions-review-authoring',async()=>{
      const model:ModelAdapter={...deterministicModel,configuration(){return {provider:'openai',model:'controlled-authoring',options:{api:'responses',store:false,maxOutputTokens:4000,timeoutMs:30000,reasoningEffort:'none'}} as any;},async *stream(request){
        const input=JSON.parse(String(request.messages.at(-1)!.content));
        if(String(request.messages[0].content).startsWith('Review proposed'))yield JSON.stringify({scopes:(input.scopeChecks??[]).map((c:any)=>({id:c.id,equivalentIds:[],uncertainIds:[]})),links:input.links.map((link:any)=>({ruleId:link.ruleId,broaderId:link.broaderId,compatible:true,reason:'The recipient condition narrows the send.'})),examples:['An ordinary message to John: Allow.','Work files to an external recipient: Never.']});
        else if(input.text.includes('synthetic exception hierarchy'))yield JSON.stringify({rules:[
          {key:'documents',effect:'deny',policy:{kind:'semantic',condition:'Read documents',overrides:[]}},
          {key:'public',effect:'ask',policy:{kind:'semantic',condition:'Read documents labeled public',overrides:['documents']}},
          {key:'approved',effect:'allow',policy:{kind:'semantic',condition:'Read documents labeled public and approved',overrides:['public']}},
        ],clarification:null,suggestion:null});
        else yield JSON.stringify(input.text.includes('ambiguous')?{rules:[],clarification:'Which John? Supply an address.',suggestion:null}:{rules:[{key:'a',effect:'ask',policy:{kind:'explicit',verb:'read',resource:{type:'filesystem',path:files,scope:'subtree'}}},{key:'b',effect:'deny',policy:{kind:'semantic',condition:'Send work files outside Acme',examples:[],overrides:[]}}],clarification:null,suggestion:'Keep reads and external delivery separate.'});
      }};
      const author=new Permissions(db,decisions,offlineEvaluator,model);
      const beforeProposals=await author.list();
      const proposed=await author.formalize({text:'Ask before reading here; never send work files outside Acme',category:'filesystem',effect:'ask'});assert.equal(proposed.rules.length,2);assert.equal(proposed.rules[0].policy.kind,'explicit');assert.equal(proposed.rules[1].policy.kind,'semantic');
      assert.deepEqual(await author.list(),beforeProposals);
      await assert.rejects(author.formalize({text:'ambiguous John',category:'interaction',effect:'ask'}),/Which John/);
      await assert.rejects(author.changeEffect(proposed.rules[1]),/Review/);
      // Proposed-key links survive formalization, review and atomic activation as a three-level hierarchy.
      const hierarchy=await author.formalize({text:'synthetic exception hierarchy: never read documents; ask for public documents, except allow approved public documents',category:'filesystem',effect:'deny'});
      const [broad,publicRule,approved]=hierarchy.rules;
      assert.deepEqual(publicRule.policy.kind==='semantic'&&publicRule.policy.overrides,[broad.id]);assert.deepEqual(approved.policy.kind==='semantic'&&approved.policy.overrides,[publicRule.id]);
      assert.ok(!(await author.list()).some(r=>hierarchy.rules.some(p=>p.id===r.id)));
      const hierarchyAuthor=new Permissions(db,decisions,{async evaluate(packet,questions){const data=packet as any;return {model:'controlled-document-labels',answers:Object.fromEntries(questions.map(q=>{
        const id=q.id.slice(5).split('.target.')[0],facts=data.targets[Number(q.id.split('.target.')[1]??0)]?.action.facts??{};
        const applies=id===broad.id||(id===publicRule.id&&facts.public)||(id===approved.id&&facts.public&&facts.approved);
        return [q.id,{value:applies?'applies' as const:'does_not_apply' as const}];
      }))};}},model);
      const reviewed=await hierarchyAuthor.review({rules:hierarchy.rules});await hierarchyAuthor.commit({rules:reviewed.rules,removeIds:reviewed.removeIds,reviewToken:reviewed.reviewToken});
      const readDocument=(facts:Record<string,boolean>)=>hierarchyAuthor.evaluate({operation:'fixture.read_documents',effects:['read'],resources:[{kind:'document',id:'synthetic-document',label:'Synthetic document'}],facts},'document-hierarchy',new AbortController().signal);
      assert.equal((await readDocument({})).outcome,'denied');assert.equal((await readDocument({public:true})).outcome,'needs-input');
      const allowed=await readDocument({public:true,approved:true});assert.equal(allowed.outcome,'allowed');assert.deepEqual(allowed.effectiveRuleIds,[approved.id]);
      assert.equal((await readDocument({approved:true})).outcome,'denied');
      const cleanup=await hierarchyAuthor.review({rules:[],removeIds:hierarchy.rules.map(r=>r.id)});await hierarchyAuthor.commit({rules:cleanup.rules,removeIds:cleanup.removeIds,reviewToken:cleanup.reviewToken});
    });
    await scenarioStep(t,'permissions-authoring-priorities',async()=>{
      for(const fixture of permissionAuthoringCases){
        const original=(await permissions.list()).find(p=>JSON.stringify(p.policy)===JSON.stringify(fixture.baseline.policy));
        const base=await permissions.save({effect:fixture.baseline.effect,policy:fixture.baseline.policy,id:original?.id??randomUUID(),category:fixture.category});
        let currentMatches:Record<string,'applies'|'does_not_apply'|'insufficient_evidence'>={},mixed=false;
        const ids=new Map<string,string>([[base.id,'base']]);
        const byKey=(key:string)=>key==='base'?fixture.baseline:fixture.proposals.find(p=>p.key===key)!;
        const model:ModelAdapter={...deterministicModel,configuration(){return {provider:'openai',model:'controlled-priority-authoring',options:{api:'responses',store:false,maxOutputTokens:4000,timeoutMs:30000,reasoningEffort:'none'}} as any;},async *stream(request){
          const input=JSON.parse(String(request.messages.at(-1)!.content));
          if(String(request.messages[0].content).startsWith('Review proposed'))yield JSON.stringify({scopes:(input.scopeChecks??[]).map((c:any)=>({id:c.id,equivalentIds:[],uncertainIds:[]})),links:input.links.map((link:any)=>({ruleId:link.ruleId,broaderId:link.broaderId,compatible:fixture.proposals.some(p=>policyText(p.policy)===link.specific&&p.overrides.some(key=>policyText(byKey(key).policy)===link.overridden)),reason:'The selected priority controls the same action and target.'})),examples:fixture.samples.map(sample=>`${sample.label}: ${sample.outcome}`)});
          else yield JSON.stringify({rules:[
            // A repeated baseline from the model must be reused, including explicit/semantic equivalents.
            {key:'copy',effect:base.effect,policy:base.policy.kind==='explicit'&&['messages','public_content'].includes(base.policy.resource.type)?{kind:'semantic',condition:policyText(base.policy)+'.',overrides:[]}:base.policy},
            ...fixture.proposals.map(p=>({key:p.key,effect:p.effect,policy:p.policy.kind==='semantic'?{...p.policy,overrides:p.overrides.map(key=>key==='base'?'copy':key)}:p.policy})),
          ],clarification:null});
        }};
        const author=new Permissions(db,decisions,{async evaluate(packet,questions){const data=packet as any;return {model:'controlled-shared-targets',answers:Object.fromEntries(questions.map(q=>{
          const key=ids.get(q.id.slice(5).split('.target.')[0]),target=data.targets[Number(q.id.split('.target.')[1]??0)]?.action;
          let value=key?currentMatches[key]??'does_not_apply':'does_not_apply';
          if(mixed&&key==='named')value=['john@example.com','amy@example.com'].includes(target?.facts?.recipient)?'applies':'does_not_apply';
          if(mixed&&key==='friends')value=['john@example.com','amy@example.com'].includes(target?.facts?.recipient)?'insufficient_evidence':'does_not_apply';
          return [q.id,{value}];
        }))};}},model);
        const proposed=await author.formalize({text:fixture.prompt,category:fixture.category,effect:'ask'});
        assert.equal(proposed.rules.length,fixture.proposals.length,fixture.id);assert.ok(!proposed.rules.some(p=>p.id===base.id));
        for(const expected of fixture.proposals){const actual=proposed.rules.find(p=>policyText(p.policy)===policyText(expected.policy))!;assert.ok(actual,expected.key);ids.set(actual.id,expected.key);}
        for(const p of proposed.rules)if(p.policy.kind==='semantic')assert.deepEqual(new Set(p.policy.overrides),new Set(fixture.proposals.find(expected=>expected.key===ids.get(p.id))!.overrides.map(key=>[...ids].find(([,value])=>value===key)![0])));
        assert.equal((await author.list()).find(p=>p.id===base.id)!.updatedAt,base.updatedAt);
        const review=await author.review({rules:proposed.rules});await author.commit({rules:review.rules,removeIds:review.removeIds,reviewToken:review.reviewToken});
        assert.equal((await author.list()).find(p=>p.id===base.id)!.updatedAt,base.updatedAt,'The saved baseline is untouched.');
        for(const sample of fixture.samples){currentMatches=sample.matches;const result=await author.evaluate(sample.action,fixture.id,new AbortController().signal);assert.equal(result.outcome,sample.outcome,`${fixture.id}: ${sample.label}`);}
        // Repeated authoring is idempotent even if the model repeats all existing proposals.
        assert.deepEqual((await author.formalize({text:fixture.prompt,category:fixture.category,effect:'ask'})).rules,[]);
        const removeIds=proposed.rules.map(p=>p.id);
        if(fixture.id==='crm-contacts'){
          mixed=true;const result=await author.evaluate({operation:'fixture.send',effects:['send'],resources:['john@example.com','other@example.com'].map(id=>({kind:'contact',id,label:id}))},'mixed-recipients',new AbortController().signal);assert.equal(result.outcome,'denied');assert.ok(result.overrides.every(link=>link.target.includes('john@example.com')));mixed=false;
          const independent=await author.save({id:randomUUID(),category:'interaction',effect:'deny',policy:{kind:'semantic',condition:'Send work files outside my company'}});ids.set(independent.id,'work');removeIds.push(independent.id);currentMatches={friends:'insufficient_evidence',named:'applies',work:'applies'};
          assert.equal((await author.evaluate(fixture.samples[0].action,'independent-work-content',new AbortController().signal)).outcome,'denied');
          const named=proposed.rules.find(p=>p.id===[...ids].find(([,key])=>key==='named')![0])!;
          await assert.rejects(author.review({rules:[{...named,policy:{...named.policy,kind:'semantic',condition:policyText(named.policy),overrides:[independent.id]}}]}),/priority/);
        }
        if(!original)removeIds.push(base.id);
        const cleanup=await author.review({rules:[],removeIds});await author.commit({rules:cleanup.rules,removeIds:cleanup.removeIds,reviewToken:cleanup.reviewToken});
        if(original)await author.changeEffect({id:original.id,category:original.category,effect:original.effect,policy:original.policy});
      }
    });
    await scenarioStep(t,'permissions-change-sets',async()=>{
      const before=await permissions.list(),base=before.find(p=>p.policy.kind==='explicit'&&p.policy.resource.type==='messages')!;
      const entry=(p:typeof base)=>({id:p.id,category:p.category,effect:p.effect,policy:p.policy});
      await permissions.changeEffect({...entry(base),effect:'ask'});
      const baseline=(await permissions.list()).find(p=>p.id===base.id)!;
      let draft:any={rules:[
        {key:'baseline',effect:'deny',policy:{kind:'semantic',condition:'Send messages to any recipient.',overrides:[base.id]}},
        {key:'friends',effect:'ask',policy:{kind:'semantic',condition:'Send messages to recipients marked as friends in my CRM',overrides:['baseline']}},
        {key:'named',effect:'allow',policy:{kind:'semantic',condition:'Send messages to John Example (john@example.com) or Amy Example (amy@example.com)',overrides:['friends','baseline']}},
      ],removals:[],clarification:null};
      const model:ModelAdapter={...deterministicModel,configuration(){return {provider:'openai',model:'controlled-change-sets',options:{api:'responses',store:false,maxOutputTokens:4000,timeoutMs:30000,reasoningEffort:'none'}} as any;},async *stream(request){
        const input=JSON.parse(String(request.messages.at(-1)!.content));
        if(String(request.messages[0].content).startsWith('Review proposed'))yield JSON.stringify({
          scopes:(input.scopeChecks??[]).map((c:any)=>({id:c.id,equivalentIds:input.rules.find((r:any)=>r.id===c.id)?.policy.condition==='Deliver messages to everybody'?c.compareIds.filter((id:string)=>id===base.id):[],uncertainIds:[]})),
          consolidations:(input.consolidations??[]).map((c:any)=>({...c,equivalent:false,reason:'A qualified restriction is not the same scope as general messaging.'})),
          links:input.links.map((l:any)=>({...l,compatible:true,reason:'Reviewed priority for this recipient.'})),examples:['Named recipients: Allow; other CRM friends: Ask; other recipients use the selected general permission.'],
        });else yield JSON.stringify(draft);
      }};
      const author=new Permissions(db,decisions,offlineEvaluator,model);
      const proposed=await author.formalize({text:crmPermissionPrompt,category:'filesystem',effect:'ask'});
      assert.equal(proposed.rules.length,3);assert.deepEqual(proposed.removals,[]);
      const updated=proposed.rules.find(p=>p.id===base.id)!;assert.equal(updated.effect,'deny');assert.equal(updated.category,base.category);assert.deepEqual(updated.policy,base.policy);
      assert.equal((await author.list()).find(p=>p.id===base.id)!.updatedAt,baseline.updatedAt,'Suggestions stay inactive.');
      const partial=await author.review({rules:proposed.rules.filter(p=>p.id!==base.id)});assert.ok(!partial.rules.some(p=>p.id===base.id),'Unchecked update leaves its saved row unchanged.');
      const review=await author.review({rules:proposed.rules});await author.commit({rules:review.rules,removeIds:review.removeIds,reviewToken:review.reviewToken});
      const active=await author.list();assert.equal(active.length,before.length+2);assert.equal(active.find(p=>p.id===base.id)!.effect,'deny');
      assert.deepEqual((await author.formalize({text:crmPermissionPrompt,category:'interaction',effect:'ask'})).rules,[],'Repeated suggestions reuse all existing meanings.');
      const equal={id:randomUUID(),category:'interaction',effect:'deny',policy:{kind:'semantic',condition:'Send messages to any recipient',overrides:[base.id]}};
      await assert.rejects(author.review({rules:[equal]}),/same scope/);
      await assert.rejects(author.review({rules:[{...equal,policy:{...equal.policy,condition:'Deliver messages to everybody',overrides:[]}}]}),/same scope/,'Independent semantic comparison catches a paraphrase outside local canonicalization.');
      draft={rules:[{id:base.id,effect:'ask',policy:base.policy}],removals:[],clarification:null};
      const change=await author.formalize({text:'Ask before sending messages to anybody',category:'filesystem',effect:'ask'});assert.equal(change.rules[0].id,base.id);assert.equal(change.rules[0].category,base.category);
      // Seed a historical duplicate; consolidation, not duplicate creation, is under test.
      const duplicate=await permissions.save({...SavePermission.parse(equal),id:randomUUID(),policy:{...equal.policy,overrides:[]}});
      const dependent={id:randomUUID(),category:'interaction',effect:'allow',policy:{kind:'semantic',condition:'Send messages to Casey Example (casey@example.com)',examples:[],overrides:[duplicate.id]}};
      const linked=await author.review({rules:[dependent]});await author.commit({rules:linked.rules,removeIds:linked.removeIds,reviewToken:linked.reviewToken});
      draft={rules:[],removals:[{id:duplicate.id,replacementId:base.id,reason:'This repeats the general messaging permission.'}],clarification:null};
      const removal=await author.formalize({text:'Consolidate the duplicate general messaging permission',category:'interaction',effect:'ask'});assert.equal(removal.rules.length,0);assert.equal(removal.removals[0].replacementId,base.id);
      assert.ok((await author.list()).some(p=>p.id===duplicate.id));
      await assert.rejects(author.review({rules:[],removeIds:[duplicate.id],replacements:[{id:duplicate.id,replacementId:randomUUID()}]}),/replacement/);
      const consolidated=await author.review({rules:[],removeIds:[duplicate.id],replacements:[{id:duplicate.id,replacementId:base.id}]});
      const transferred=consolidated.rules.find(p=>p.id===dependent.id)!;assert.deepEqual(transferred.policy.kind==='semantic'&&transferred.policy.overrides,[base.id]);
      assert.ok(consolidated.affected.some(p=>p.id===duplicate.id));assert.ok(consolidated.affected.some(p=>p.id===base.id));
      assert.ok((await author.list()).some(p=>p.id===duplicate.id),'Review and deselection alone do not retire anything.');
      await author.commit({rules:consolidated.rules,removeIds:consolidated.removeIds,reviewToken:consolidated.reviewToken});
      assert.ok(!(await author.list()).some(p=>p.id===duplicate.id));assert.ok((await db.permission.findUniqueOrThrow({where:{id:duplicate.id}})).deletedAt);
      const savedDependent=(await author.list()).find(p=>p.id===dependent.id)!;assert.deepEqual(savedDependent.policy.kind==='semantic'&&savedDependent.policy.overrides,[base.id]);
      const friends=proposed.rules.find(p=>p.policy.kind==='semantic'&&p.policy.condition.includes('friends in my CRM'))!;
      assert.equal(friends.policy.kind,'semantic');if(friends.policy.kind!=='semantic')throw new Error('Expected the CRM permission.');
      const examples=['A named exception retains its priority even when CRM membership is unknown.'];
      const withExamples=await author.review({rules:[{...friends,policy:{...friends.policy,examples}}]});await author.commit({rules:withExamples.rules,removeIds:withExamples.removeIds,reviewToken:withExamples.reviewToken});
      draft={rules:[{id:friends.id,effect:'ask',policy:{...friends.policy,examples:[],overrides:[]}}],clarification:null};
      const relationshipEdit=await author.formalize({text:'Keep the CRM friend condition and remove its overrides',category:'interaction',effect:'ask'});
      const friendEdit=relationshipEdit.rules[0];assert.equal(friendEdit.policy.kind,'semantic');if(friendEdit.policy.kind==='semantic'){assert.deepEqual(friendEdit.policy.examples,examples,'Equivalent-scope edits retain saved boundary examples.');assert.deepEqual(friendEdit.policy.overrides,[],'An explicit existing-ID change can remove reviewed links.');}
      const historical=randomUUID();await db.permission.create({data:{id:historical,category:'interaction',effect:'allow',policy:{kind:'semantic',condition:dependent.policy.condition,examples:[],overrides:[friends.id]},createdAt:new Date(),updatedAt:new Date()}});
      const inherited=await author.review({rules:[],removeIds:[historical],replacements:[{id:historical,replacementId:dependent.id}]});
      const survivor=inherited.rules.find(p=>p.id===dependent.id)!;assert.deepEqual(survivor.policy.kind==='semantic'&&survivor.policy.overrides,[base.id,friends.id].sort(),'Consolidation preserves outgoing authority from both copies.');
      await author.commit({rules:inherited.rules,removeIds:inherited.removeIds,reviewToken:inherited.reviewToken});
      const qualified=await author.save({id:randomUUID(),category:'interaction',effect:'deny',policy:{kind:'semantic',condition:'Send work files outside my company',overrides:[]}});
      await assert.rejects(author.review({rules:[],removeIds:[qualified.id],replacements:[{id:qualified.id,replacementId:base.id}]}),/qualified restriction/);
      assert.ok((await author.list()).some(p=>p.id===qualified.id));
      // Local reconciliation also proposes consolidation when a saved duplicate is encountered.
      const repeated=await author.save({...entry(duplicate),id:randomUUID()});draft={rules:[{key:'baseline',effect:'deny',policy:base.policy}],clarification:null};
      const cleanupDraft=await author.formalize({text:'Never send messages by default',category:'interaction',effect:'deny'});assert.equal(cleanupDraft.removals[0].id,repeated.id);assert.equal(cleanupDraft.removals[0].replacementId,base.id);
      await assert.rejects(author.review({rules:[{...entry(base),effect:'ask'}],removeIds:[]}),/same scope/,'Unchecking consolidation cannot activate an equivalent conflicting permission.');
      const cleanup=await author.review({rules:[],removeIds:[...proposed.rules.filter(p=>p.id!==base.id).map(p=>p.id),dependent.id,qualified.id,repeated.id]});await author.commit({rules:cleanup.rules,removeIds:cleanup.removeIds,reviewToken:cleanup.reviewToken});
      await author.changeEffect({id:base.id,category:base.category,effect:base.effect,policy:base.policy});
    });
    await scenarioStep(t,'decisions-lifecycle',async()=>{
      const id=randomUUID(),command=CreateDecision.parse({id,request:{kind:'question',question:'Which folder?',reason:'Choose a target.',form:'choice',options:[{id:'a',label:'Folder A'},{id:'b',label:'Folder B'}]}});
      const created=await decisions.create(command);assert.equal(created.threadId,null);assert.equal((await decisions.create(command)).id,id);await assert.rejects(decisions.create({...command,request:{...command.request,question:'Different question'}}));
      await decisions.snooze(id,new Date(Date.now()+3600000).toISOString());assert.equal((await decisions.list()).find(d=>d.id===id)!.status,'snoozed');await decisions.snooze(id,null);
      const submit=randomUUID();await decisions.answer(id,{submissionId:submit,value:'a'});await decisions.answer(id,{submissionId:submit,value:'a'});await assert.rejects(decisions.answer(id,{submissionId:submit,value:'b'}));
      await assert.rejects(db.decision.update({where:{id},data:{request:{...created.request,question:'Overwrite'}}}));
      const skipped=await decisions.create({id:randomUUID(),request:{kind:'question',question:'Explain?',reason:'Context',form:'text'}});assert.equal((await decisions.answer(skipped.id,{submissionId:randomUUID(),value:{skipped:true}})).status,'resolved');
      const stale=await decisions.create({id:randomUUID(),request:{kind:'question',question:'Old target?',reason:'Context',form:'text'}});await decisions.cancel(stale.id,'Target changed.');await assert.rejects(decisions.answer(stale.id,{submissionId:randomUUID(),value:'stale'}));
      const thread=randomUUID();await service(deterministicModel).createThread(thread,'Ordinary reply');const ordinary=await decisions.create({id:randomUUID(),threadId:thread,request:{kind:'question',question:'Which folder?',reason:'Choose.',form:'choice',options:[{id:'a',label:'Folder A'},{id:'b',label:'Folder B'}]}});
      const reply=await service(deterministicModel).submit(thread,randomUUID(),'Use Folder B','normal');await wait(reply.id,'completed');const saved=decisionView(await db.decision.findUniqueOrThrow({where:{id:ordinary.id}}));assert.equal(saved.resolution?.kind,'answer');if(saved.resolution?.kind==='answer'){assert.equal(saved.resolution.value,'b');assert.equal(saved.resolution.sourceArtifactId,reply.inputArtifactId);}
      const nullable=service(scripted([call('decisions.ask',{question:'Which folder?',reason:'Required target.',options:null})])),nullableRun=await start(nullable,'Ask me');await wait(nullableRun.run.id,'waiting');assert.equal((await decisions.list(nullableRun.thread))[0].request.form,'text');await nullable.cancel(nullableRun.run.id);
      const shared=await decisions.create({id:randomUUID(),request:{kind:'question',question:'Shared target?',reason:'Two consumers need this answer.',form:'text'}});
      const consumer=registerTool({definition:{name:'decisions.ask',version:1,description:'Shared question consumer',inputSchema:{type:'object',properties:{},additionalProperties:false},effects:['input'],concurrency:'exclusive',repeatability:'safe',limits:{timeoutMs:1000,resultBytes:4096}},parse(){return {};},async prepare(){return {action:{operation:'decisions.ask',resources:[],effects:['input']}};},async execute(_prepared,context){const view=await decisions.hold(context.runId,context.callId,shared.request,shared.id);if(['pending','snoozed'].includes(view.status))throw new DecisionWait();return {status:'success',content:[{type:'text',text:JSON.stringify(view.resolution)}],references:[],omissions:[]};}});
      const sharedRuntime:ToolRuntime={tools:[consumer],resources:async()=>[{kind:'decisions',id:shared.id,label:'Shared input'}],authorize:async()=>({outcome:'allowed',code:'decision_input',message:'Collect required input.',configurationRevision:'fixture',evaluator:'not-performed'})};
      const firstConsumer=service(scripted([call('decisions.ask',{})]),true,sharedRuntime),first=await start(firstConsumer);await wait(first.run.id,'waiting');
      const secondConsumer=service(scripted([call('decisions.ask',{})]),true,sharedRuntime),second=await start(secondConsumer);await wait(second.run.id,'waiting');
      assert.ok((await secondConsumer.readThread(second.thread)).decisions?.some(d=>d.id===shared.id));await firstConsumer.cancel(first.run.id);assert.equal((await db.decision.findUniqueOrThrow({where:{id:shared.id}})).status,'pending');
      await decisions.answer(shared.id,{submissionId:randomUUID(),value:'Shared folder'});await wait(second.run.id,'completed');assert.equal((await db.run.findUniqueOrThrow({where:{id:first.run.id}})).status,'cancelled');
    });
    await scenarioStep(t,'decisions-chat-race',async()=>{
      for(const winner of ['answer','cancel'] as const){
        const thread=randomUUID(),requestKey=randomUUID();let observed!:()=>void,release!:()=>void,calls=0;
        const snapshotReady=new Promise<void>(resolve=>observed=resolve),gate=new Promise<void>(resolve=>release=resolve);
        class PausedDecisions extends Decisions {
          override async list(threadId?:string){const snapshot=await super.list(threadId);if(threadId===thread){observed();await gate;}return snapshot;}
        }
        const model:ModelAdapter={...deterministicModel,async *stream(){calls++;yield 'Accepted chat response.';}};
        const owner=new Threads(db,model,true,undefined,undefined,undefined,new PausedDecisions(db),permissions);services.push(owner);
        await owner.createThread(thread,'Concurrent chat answer');
        const question=await decisions.create({id:randomUUID(),threadId:thread,request:{kind:'question',question:'Which folder?',reason:'Choose a target.',form:'choice',options:[{id:'a',label:'Folder A'},{id:'b',label:'Folder B'}]}});
        const submission=owner.submit(thread,requestKey,winner==='answer'?'Use Folder B':'Skip this question','normal');
        try{
          await snapshotReady;
          const accepted=await db.run.findUniqueOrThrow({where:{requestKey}});assert.equal(accepted.status,'queued');
          const saved=winner==='answer'?await decisions.answer(question.id,{submissionId:randomUUID(),value:'a'}):await decisions.cancel(question.id);
          release();const run=await submission;await wait(run.id,'completed');
          assert.equal((await owner.submit(thread,requestKey,winner==='answer'?'Use Folder B':'Skip this question','normal')).id,run.id);
          assert.deepEqual(decisionView(await db.decision.findUniqueOrThrow({where:{id:question.id}})),saved);
          assert.equal(await db.run.count({where:{requestKey}}),1);assert.equal(await db.artifact.count({where:{threadId:thread,layer:'input'}}),1);assert.equal(calls,1);
          const next=await owner.submit(thread,randomUUID(),'Continue the conversation','normal');await wait(next.id,'completed');assert.equal(calls,2);
        }finally{release();await submission.catch(()=>{});}
      }
      // Unexpected interpretation failures still dispatch the committed Run and remain observable.
      const fault=new Error('Synthetic chat interpretation failure');let calls=0;
      class FailedDecisions extends Decisions {override async resolveClearChat(){throw fault;}}
      const model:ModelAdapter={...deterministicModel,async *stream(){calls++;yield 'Accepted despite the interpretation failure.';}};
      const owner=new Threads(db,model,true,undefined,undefined,undefined,new FailedDecisions(db),permissions);services.push(owner);
      const thread=randomUUID(),requestKey=randomUUID();await owner.createThread(thread,'Interpretation failure');
      await assert.rejects(owner.submit(thread,requestKey,'Hello','normal'),error=>error===fault);
      const accepted=await db.run.findUniqueOrThrow({where:{requestKey}});await wait(accepted.id,'completed');
      assert.equal((await owner.submit(thread,requestKey,'Hello','normal')).id,accepted.id);assert.equal(calls,1);
      assert.equal(await db.artifact.count({where:{threadId:thread,layer:'input'}}),1);
    });
    await scenarioStep(t,'decisions-scheduling-wake',async()=>{
      const owner=service(scripted([call('decisions.ask',{question:'Which target?',reason:'Required input.',options:null})]));
      const first=await start(owner,'Ask me');await wait(first.run.id,'waiting');
      let unlock!:()=>void,locked!:()=>void;const held=new Promise<void>(resolve=>locked=resolve),gate=new Promise<void>(resolve=>unlock=resolve);
      const transaction=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM threads WHERE id=${first.thread}::uuid FOR UPDATE`;locked();await gate;},{timeout:20000});
      await held;const scan=owner.resumeWaiting();
      try{
        await until(()=>db.$queryRaw<Array<{count:number}>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`,rows=>rows[0].count>0);
        // This Run did not exist in the scheduler's first snapshot. Its worker finishes
        // and its answer arrives while that scan is blocked by the other Thread.
        const second=await start(owner,'Ask me');await wait(second.run.id,'waiting');const question=(await decisions.list(second.thread)).find(d=>d.status==='pending')!;
        await decisions.answer(question.id,{submissionId:randomUUID(),value:'Chosen folder'});await pause(20);unlock();await transaction;await scan;await wait(second.run.id,'completed');
      }finally{unlock();await transaction;await owner.cancel(first.run.id);}
    });
    await scenarioStep(t,'permissions-default-code',async()=>{
      const defaults=await loadFilesystemConfig(instance.root,checkout),runtime=filesystemRuntime(async()=>defaults);await permissions.seed(defaults);
      const codeRule=(await permissions.list()).find(rule=>rule.policy.kind==='explicit'&&rule.policy.resource.type==='filesystem'&&rule.policy.resource.path===checkout&&!rule.policy.resource.pattern)!;assert.equal(codeRule.effect,'allow');
      const code=join(checkout,'specs/product.md'),readCode=()=>call('filesystem.read',{path:code,startLine:1,maxLines:5});
      const first=await start(service(scripted([readCode()]),true,runtime));assert.equal(RunState.parse((await wait(first.run.id,'completed')).state).tools!.calls[0].status,'completed');
      for(const [operation,target] of [['filesystem.read',join(files,'b.ts')],['filesystem.write',code]])assert.equal((await runtime.authorize({operation,resources:[{kind:'filesystem',id:target,label:target}],effects:[operation.endsWith('write')?'write':'read']},{runId:first.run.id,threadId:first.thread,callId:randomUUID(),signal:new AbortController().signal})).outcome,'denied');
      await permissions.save({id:codeRule.id,category:codeRule.category,policy:codeRule.policy,effect:'ask'});const asked=await start(service(scripted([readCode()]),true,runtime));await wait(asked.run.id,'waiting');const question=(await decisions.list(asked.thread)).find(d=>d.status==='pending')!;await decisions.answer(question.id,{submissionId:randomUUID(),value:'approve'});await wait(asked.run.id,'completed');
      await permissions.save({id:codeRule.id,category:codeRule.category,policy:codeRule.policy,effect:'deny'});
      const narrower=await loadFilesystemConfig(instance.root,checkout);narrower.scopes.push({path:join(checkout,'specs'),operations:[],excludedNames:[]});assert.equal((await filesystemRuntime(async()=>narrower).authorize({operation:'filesystem.read',resources:[{kind:'filesystem',id:code,label:code}],effects:['read']},{runId:first.run.id,threadId:first.thread,callId:randomUUID(),signal:new AbortController().signal})).outcome,'denied');
      for(const value of services)await value.stop();await startInstance(ws,instance.id,{headless:true});assert.equal((await permissions.list()).find(rule=>rule.id===codeRule.id)!.effect,'deny');await stopInstance(ws,instance.id);
      await permissions.remove(codeRule.id);await startInstance(ws,instance.id,{headless:true});assert.ok((await db.permission.findUniqueOrThrow({where:{id:codeRule.id}})).deletedAt);assert.ok(!(await permissions.list()).some(rule=>rule.id===codeRule.id));await stopInstance(ws,instance.id);
    });
    await scenarioStep(t,'permissions-decisions-stretch',async()=>{
      const raced=await decisions.create({id:randomUUID(),request:{kind:'question',question:'One answer?',reason:'Two clients answer simultaneously.',form:'text'}});
      const results=await Promise.allSettled(['A','B'].map(value=>decisions.answer(raced.id,{submissionId:randomUUID(),value})));assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);
      const snoozed=await decisions.create({id:randomUUID(),request:{kind:'question',question:'Wake without answering?',reason:'Attention only.',form:'text'}});await decisions.snooze(snoozed.id,new Date(Date.now()+100).toISOString());await pause(120);await decisions.wake();const woke=await db.decision.findUniqueOrThrow({where:{id:snoozed.id}});assert.equal(woke.status,'pending');assert.equal(woke.resolution,null);await decisions.cancel(snoozed.id);
      const chat=service(deterministicModel),thread=randomUUID();await chat.createThread(thread,'Ambiguous reply');const questions=await Promise.all(['First target?','Second target?'].map(question=>decisions.create({id:randomUUID(),threadId:thread,request:{kind:'question',question,reason:'Choose a folder.',form:'choice',options:[{id:'a',label:'Folder A'}]}})));const reply=await chat.submit(thread,randomUUID(),'Use Folder A','normal');await wait(reply.id,'completed');for(const question of questions){assert.equal((await db.decision.findUniqueOrThrow({where:{id:question.id}})).status,'pending');await decisions.cancel(question.id);}
      const deny=await permissions.save({...askRule(),effect:'deny'}),ask=await permissions.save(askRule());const owner=service(scripted([readCall()])),blocked=await start(owner);await wait(blocked.run.id,'waiting');const old=(await decisions.list(blocked.thread)).find(d=>d.status==='pending')!;assert.deepEqual(old.request.restrictionIds,[deny.id]);
      const added=await permissions.save({...askRule(),effect:'deny'});await decisions.answer(old.id,{submissionId:randomUUID(),value:'exception'});const changed=await until(()=>decisions.list(blocked.thread),list=>list.some(d=>d.id!==old.id&&d.status==='pending'));const next=changed.find(d=>d.id!==old.id&&d.status==='pending')!;assert.deepEqual(new Set(next.request.restrictionIds),new Set([deny.id,added.id]));assert.equal(next.request.options.some(option=>option.id==='approve'),false);await decisions.answer(next.id,{submissionId:randomUUID(),value:'exception'});assert.equal(RunState.parse((await wait(blocked.run.id,'completed')).state).tools!.calls[0].status,'completed');for(const rule of [deny,ask,added])await permissions.remove(rule.id);
      const allAsk=await permissions.save({id:randomUUID(),category:'filesystem',effect:'ask',policy:{kind:'explicit',verb:'perform',resource:{type:'operation',name:'filesystem.read'}}}),alias=join(files,'moving-alias.ts');await symlink(join(files,'b.ts'),alias);const moving=await start(service(scripted([call('filesystem.read',{path:alias,startLine:1,maxLines:5})])));await wait(moving.run.id,'waiting');const original=(await decisions.list(moving.thread)).find(d=>d.status==='pending')!;await rm(alias);await symlink(join(files,'a.ts'),alias);await decisions.answer(original.id,{submissionId:randomUUID(),value:'approve'});const newer=await until(()=>decisions.list(moving.thread),list=>list.some(d=>d.id!==original.id&&d.status==='pending'));const fresh=newer.find(d=>d.id!==original.id&&d.status==='pending')!;assert.equal(fresh.request.action!.resources[0].id,join(files,'a.ts'));assert.equal((await db.decision.findUniqueOrThrow({where:{id:original.id}})).status,'resolved');await decisions.answer(fresh.id,{submissionId:randomUUID(),value:'approve'});await wait(moving.run.id,'completed');await permissions.remove(allAsk.id);await rm(alias);
      for(const answers of [{}, {sensitivity:{type:'choice',choice:'applies',probabilities:{applies:.5,does_not_apply:.45,insufficient_evidence:.05}}}, {sensitivity:{type:'choice',choice:'applies',probabilities:{applies:1,does_not_apply:1,insufficient_evidence:1}}}]){const evaluator=new JevEvaluator('synthetic-key',async()=>new Response(JSON.stringify({model:'jev-1.13.0',usage:{input_tokens:0,output_tokens:0},answers}),{status:200}));const result=await evaluator.evaluate({action:'fixture'},[{id:'sensitivity',instructions:'Boundary question'}],new AbortController().signal);assert.equal(result.answers.sensitivity.value,'insufficient_evidence');}
      let calls=0;const bounded=new JevEvaluator('synthetic-key',async()=>{calls++;throw new Error('Should not send oversized evidence');});assert.equal((await bounded.evaluate({evidence:'x'.repeat(60000)},[{id:'sensitivity',instructions:'Boundary question'}],new AbortController().signal)).answers.sensitivity.value,'insufficient_evidence');assert.equal(calls,0);
    });
    await scenarioStep(t,'decisions-resumption',async()=>{
      const rule=await permissions.save(askRule());
      const model=scripted([call('filesystem.read',{path:join(files,'a.ts'),startLine:1,maxLines:20}),readCall()]);const value=service(model),started=await start(value);const held=RunState.parse((await wait(started.run.id,'waiting')).state);assert.equal(held.tools!.calls[0].status,'completed');const firstResult=held.tools!.calls[0].resultArtifactId;
      const question=(await decisions.list(started.thread)).find(d=>d.status==='pending')!;assert.equal(question.request.kind,'permission');
      const unrelated=await service(deterministicModel).submit(started.thread,randomUUID(),'Hello','normal');await wait(unrelated.id,'completed');assert.equal((await db.run.findUniqueOrThrow({where:{id:started.run.id}})).status,'waiting');
      await assert.rejects(decisions.answer(question.id,{submissionId:randomUUID(),value:'approve'},'chat',unrelated.inputArtifactId));
      // The callback may be lost; recovery discovers the saved immutable answer.
      await value.stop();decisions.onChanged=()=>{};await decisions.answer(question.id,{submissionId:randomUUID(),value:'approve'});
      const recovered=service(model);await recovered.recover();const done=RunState.parse((await wait(started.run.id,'completed')).state);assert.equal(done.tools!.calls[0].resultArtifactId,firstResult);assert.equal(done.tools!.calls.length,2);assert.equal(done.tools!.calls[1].status,'completed');
      const cancelled=await start(service(scripted([readCall()])));await wait(cancelled.run.id,'waiting');const cancelledDecision=(await decisions.list(cancelled.thread)).find(d=>d.status==='pending')!;await services.at(-1)!.cancel(cancelled.run.id);assert.equal((await db.decision.findUniqueOrThrow({where:{id:cancelledDecision.id}})).status,'cancelled');
      const changed=await start(service(scripted([readCall()])));await wait(changed.run.id,'waiting');const approval=(await decisions.list(changed.thread)).find(d=>d.status==='pending')!;await permissions.save({...askRule(),id:rule.id,effect:'deny'});await decisions.answer(approval.id,{submissionId:randomUUID(),value:'approve'});await wait(changed.run.id,'waiting');const replacement=await until(()=>decisions.list(changed.thread),list=>list.some(d=>d.id!==approval.id&&d.status==='pending'));const blocked=replacement.find(d=>d.id!==approval.id&&d.status==='pending')!;assert.equal(blocked.request.options[0].id,'exception');assert.equal(blocked.request.options.some(o=>o.id==='approve'),false);await decisions.answer(blocked.id,{submissionId:randomUUID(),value:'decline'});await wait(changed.run.id,'completed');assert.equal(RunState.parse((await db.run.findUniqueOrThrow({where:{id:changed.run.id}})).state).tools!.calls[0].status,'denied');
      await permissions.save({...askRule(),id:rule.id});
      // Actual backend startup resumes a persisted held action with a saved approval.
      for(const old of services)await old.stop();const lastService=service(scripted([readCall()]));const restart=await start(lastService);await wait(restart.run.id,'waiting');const pending=(await decisions.list(restart.thread)).find(d=>d.status==='pending')!;await lastService.stop();decisions.onChanged=()=>{};await decisions.answer(pending.id,{submissionId:randomUUID(),value:'approve'});await writeFile(join(instance.root,'.ash-tools.json'),JSON.stringify(fsConfig));
      await startInstance(ws,instance.id,{headless:true});await wait(restart.run.id,'completed');await stopInstance(ws,instance.id);
      await symlink(join(files,'b.ts'),join(files,'alias.ts'));const alias=service(scripted([call('filesystem.read',{path:join(files,'alias.ts'),startLine:1,maxLines:20})]));const viaAlias=await start(alias);await wait(viaAlias.run.id,'waiting');const aliasDecision=(await decisions.list(viaAlias.thread)).find(d=>d.status==='pending')!;assert.equal(aliasDecision.request.action!.resources[0].id,join(files,'b.ts'));await alias.cancel(viaAlias.run.id);
      await permissions.remove(rule.id);
      const allAsk=await permissions.save({id:randomUUID(),category:'filesystem',effect:'ask',policy:{kind:'explicit',verb:'perform',resource:{type:'operation',name:'filesystem.read'}}});
      const parallel=service(scripted([call('filesystem.read',{path:join(files,'a.ts'),startLine:1,maxLines:20}),readCall()]));const both=await start(parallel);await wait(both.run.id,'waiting');const requests=(await decisions.list(both.thread)).filter(d=>d.status==='pending');assert.equal(requests.length,2);
      const first=requests.find(d=>d.request.action!.resources[0].id===join(files,'a.ts'))!;await decisions.answer(first.id,{submissionId:randomUUID(),value:'approve'});
      await until(()=>db.run.findUniqueOrThrow({where:{id:both.run.id}}),r=>r.status==='waiting'&&RunState.parse(r.state).tools!.calls[0].status==='completed');
      assert.equal((await db.decision.findUniqueOrThrow({where:{id:requests.find(d=>d.id!==first.id)!.id}})).status,'pending');await parallel.cancel(both.run.id);await permissions.remove(allAsk.id);
      // Traversal revisits its root on resume; reuse each unchanged approval rather than looping.
      const rootAsk=await permissions.save({id:randomUUID(),category:'filesystem',effect:'ask',policy:{kind:'explicit',verb:'list',resource:{type:'filesystem',path:files,scope:'file'}}});
      const childAsk=await permissions.save({id:randomUUID(),category:'filesystem',effect:'ask',policy:{kind:'explicit',verb:'list',resource:{type:'filesystem',path:join(files,'b.ts'),scope:'file'}}});
      const traversal=service(scripted([call('filesystem.list',{path:files})])),listing=await start(traversal);
      await wait(listing.run.id,'waiting');const rootQuestion=(await decisions.list(listing.thread)).find(d=>d.status==='pending')!;await decisions.answer(rootQuestion.id,{submissionId:randomUUID(),value:'approve'});
      const childQuestion=await until(()=>decisions.list(listing.thread),list=>list.some(d=>d.id!==rootQuestion.id&&d.status==='pending'));const next=childQuestion.find(d=>d.id!==rootQuestion.id&&d.status==='pending')!;
      await decisions.answer(next.id,{submissionId:randomUUID(),value:'approve'});await wait(listing.run.id,'completed').catch(async error=>{throw new Error(JSON.stringify({error:String(error),state:RunState.parse((await db.run.findUniqueOrThrow({where:{id:listing.run.id}})).state),decisions:(await decisions.list(listing.thread)).map(d=>({id:d.id,status:d.status,binding:d.request.binding,reason:d.request.reason,action:d.request.action}))}));});assert.equal((await decisions.list(listing.thread)).length,2);
      await permissions.remove(rootAsk.id);await permissions.remove(childAsk.id);
      // A retry reuses approval only when the adapter confirms no effect; unknown effects cannot replay.
      for(const outcome of ['none','unknown'] as const){
        let executions=0;
        const handler=registerTool({definition:{name:'fixture.reconcile',version:1,description:'Controlled outcome adapter',inputSchema:{type:'object',properties:{},additionalProperties:false},effects:['read'],concurrency:'exclusive',repeatability:'reconcile',limits:{timeoutMs:1000,resultBytes:4096}},parse(){return {};},async prepare(){return {action:{operation:'fixture.reconcile',resources:[{kind:'fixture',id:'stable',label:'Controlled fixture'}],effects:['read']}};},async execute(){executions++;return executions===1?{status:'error' as const,content:[],references:[],omissions:[],error:{code:'controlled_failure',message:'Controlled outcome',retryable:true,effect:outcome}}:{status:'success' as const,content:[{type:'text' as const,text:'Retried once'}],references:[],omissions:[]};}});
        const tools:ToolRuntime={tools:[handler],resources:async()=>[{kind:'fixture',id:'stable',label:'Controlled fixture'}],authorize:async()=>({outcome:'allowed',code:'fixture',message:'Controlled capability',configurationRevision:'fixture',evaluator:'not-performed'})};
        const retryRule=await permissions.save({id:randomUUID(),category:'interaction',effect:'ask',policy:{kind:'explicit',verb:'perform',resource:{type:'operation',name:'fixture.reconcile'}}});
        const consumer=service(scripted([call('fixture.reconcile',{})]),true,tools),initial=await start(consumer);await wait(initial.run.id,'waiting');const approval=(await decisions.list(initial.thread)).find(d=>d.status==='pending')!;await decisions.answer(approval.id,{submissionId:randomUUID(),value:'approve'});await wait(initial.run.id,'completed');
        const retried=await consumer.retry(initial.run.id,randomUUID(),'normal');await wait(retried.id,'completed');assert.equal(executions,outcome==='none'?2:1);assert.equal((await decisions.list(initial.thread)).filter(d=>d.status==='pending').length,0);await permissions.remove(retryRule.id);
      }
    });
  }finally{for(const value of services)await value.stop();await db.$disconnect();await disposeInstance(ws,instance.id);await exec('git',['worktree','remove','--force',checkout],{cwd:source});await rm(base,{recursive:true,force:true});}
});
