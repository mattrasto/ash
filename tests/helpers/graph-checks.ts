import assert from 'node:assert/strict';
import { executionPlan, graphPreview, MAX_WORKERS, runGraph, timingCosts, validatePlan, type ExecutionPlan, type GraphNode } from '../../scripts/dev/graph.ts';
import { selectScenarios, scenarios } from '../scenarios.ts';

export async function checkGraph() {
  const routing = executionPlan(selectScenarios('full','model-routing-desktop','model-routing'),2,'accelerated');
  assert.equal(routing.nodes.filter(n=>n.id==='build').length,1,'Shared build is one prerequisite');
  assert.equal(routing.selected.length,3);
  assert.equal(graphPreview(routing).estimatedMs,null,'Unknown durations do not promise a zero-cost run');
  const full=executionPlan(scenarios,2,'accelerated');
  const quick=executionPlan(selectScenarios('quick'),2,'accelerated');
  const reference={version:2,passed:true,sourceValid:true,timing:'accelerated',environment:{platform:process.platform,arch:process.arch},graph:{plan:full,state:{boundary:{status:'passed',durationMs:15000}}},commands:[{command:'pnpm test:boundary',status:'passed',durationMs:15000}]};
  assert.equal(timingCosts(reference,full).get('boundary'),15000);
  assert.equal(timingCosts(reference,quick).has('boundary'),false,'A narrower scope cannot inherit a full boundary duration');
  assert.equal(timingCosts({...reference,graph:undefined},quick).has('boundary'),false,'Legacy command totals cannot establish an exact dispatched scope');
  for(const file of ['threads','images','video','video-understanding']) {
    const path=`tests/integration/${file}.test.ts`,nodes=full.nodes.filter(n=>n.command?.[1]===path);
    assert.equal(nodes.length,1,'Selected groups sharing a file prepare their existing journey once');
    assert.deepEqual([...nodes[0].scenarios].sort(),scenarios.filter(s=>s.file===path).map(s=>s.id).sort());
  }
  const renderingIds=['chat-layout','design-reading','chat-desktop','images-desktop','videos-desktop','video-understanding-desktop','engine-desktop','engine-internal-desktop'];
  const rendering=executionPlan(scenarios.filter(s=>renderingIds.includes(s.id)),2,'accelerated');
  assert.deepEqual([...rendering.selected].sort(),[...renderingIds].sort(),'Coalescing never expands narrow selection');
  assert.equal(full.nodes.find(n=>n.id==='workflow:workflow')!.slots,2,'Exclusive lifecycle consumes the entire capacity');
  for(const node of full.nodes.filter(n=>n.id.startsWith('workflow:')&&n.slots===1))assert.equal(node.environment?.isolation,'fresh-instance');
  const node=(id:string,requires:string[]=[],slots=1):GraphNode=>({id,kind:'check',label:id,requires:requires.map(id=>({id,when:'passed',reason:'Fixture dependency'})),slots,scenarios:[],estimatedMs:10});
  const plan:ExecutionPlan={version:1,workers:2,timing:'accelerated',selected:[],nodes:[node('prepare'),node('left',['prepare']),node('right',['prepare']),node('exclusive',['left','right'],2)]};
  plan.nodes.push({...node('cleanup'),kind:'cleanup',requires:plan.nodes.map(n=>({id:n.id,when:'settled',reason:'Owned resource finalizer'}))});
  const cycle=structuredClone(plan);cycle.nodes[0].requires.push({id:'left',when:'passed',reason:'Invalid cycle'});assert.throws(()=>validatePlan(cycle),/cycle/);
  const missing=structuredClone(plan);missing.nodes[0].requires.push({id:'absent',when:'passed',reason:'Missing fixture'});assert.throws(()=>validatePlan(missing),/Missing/);
  const claim=structuredClone(plan);claim.nodes[0].slots=3;assert.throws(()=>validatePlan(claim),/resource/);
  assert.equal(graphPreview(plan).estimatedMs,40);
  let release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve);
  const starts:string[]=[];let running=0,peak=0,branches=0;
  const state=await runGraph(plan,async task=>{
    starts.push(task.id);running+=task.slots;peak=Math.max(peak,running);assert.ok(running<=2);
    try{
      if(['left','right'].includes(task.id)){if(++branches===2)release();await barrier;}
      if(task.id==='exclusive')assert.equal(running,2);
    }finally{running-=task.slots;}
  },new AbortController().signal);
  assert.equal(peak,2);assert.ok(Object.values(state).every(s=>s.status==='passed'));assert.equal(starts.at(-1),'cleanup');
  for(const workers of [3,4,6,8,MAX_WORKERS]) {
    const wider=executionPlan(scenarios,workers,'accelerated');
    assert.equal(wider.nodes.find(n=>n.id==='workflow:workflow')!.slots,workers,'Lifecycle remains exclusive at higher capacity');
    const branches=Array.from({length:workers},(_,index)=>`branch-${index}`);
    const parallel:ExecutionPlan={version:1,workers,timing:'accelerated',selected:[],nodes:[...branches.map(id=>node(id)),node('exclusive',branches,workers)]};
    parallel.nodes.push({...node('cleanup'),kind:'cleanup',slots:workers,requires:parallel.nodes.map(n=>({id:n.id,when:'settled',reason:'Owned resource finalizer'}))});
    let release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve);
    let running=0,peak=0,started=0;
    const state=await runGraph(parallel,async task=>{
      running+=task.slots;peak=Math.max(peak,running);assert.ok(running<=workers);
      try{if(branches.includes(task.id)){if(++started===workers)release();await barrier;}
        else assert.equal(running,workers,'Exclusive work has no concurrent consumer');
      }finally{running-=task.slots;}
    },new AbortController().signal);
    assert.equal(peak,workers);assert.ok(Object.values(state).every(s=>s.status==='passed'));
    const tooWide=structuredClone(parallel);tooWide.workers=MAX_WORKERS+1;assert.throws(()=>validatePlan(tooWide),/workers/);
  }
  const failure=structuredClone(plan);failure.nodes.push(node('dependent',['left']));failure.nodes.find(n=>n.id==='cleanup')!.requires.push({id:'dependent',when:'settled',reason:'Failed branch finalizer'});
  const executed:string[]=[];
  const failed=await runGraph(failure,async task=>{executed.push(task.id);if(task.id==='left')throw Error('Controlled prerequisite failure');},new AbortController().signal);
  assert.equal(failed.left.status,'failed');assert.equal(failed.dependent.status,'blocked');assert.equal(failed.right.status,'passed');assert.equal(failed.cleanup.status,'passed');assert.ok(!executed.includes('dependent'));
  const abort=new AbortController();abort.abort();const cancelled:string[]=[];
  const stopped=await runGraph(plan,async task=>{cancelled.push(task.id);},abort.signal);
  assert.deepEqual(cancelled,['cleanup']);assert.equal(stopped.left.status,'cancelled');assert.equal(stopped.cleanup.status,'passed');
  const brokenProgress:string[]=[];
  await assert.rejects(runGraph(plan,async task=>{brokenProgress.push(task.id);},new AbortController().signal,()=>{throw Error('Controlled evidence write failure');}),/progress recording failed/);
  assert.deepEqual(brokenProgress,['cleanup'],'Broken progress still finalizes; no further checks execute');
  const during=new AbortController(),afterAbort:string[]=[];
  const interrupted=await runGraph(plan,async task=>{afterAbort.push(task.id);if(task.id==='prepare')during.abort();},during.signal);
  assert.deepEqual(afterAbort,['prepare','cleanup']);assert.equal(interrupted.left.status,'cancelled');
  const timed=executionPlan(selectScenarios('full','chat-layout'),2,'accelerated',new Map([['types',10],['build',5],['desktop:tests/e2e/chat.spec.ts',20],['cleanup',2]]));
  assert.equal(graphPreview(timed).estimatedMs,37);
}
