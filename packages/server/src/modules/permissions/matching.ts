import { relative, sep } from 'node:path';
import type { PermissionPolicy, PermissionView, ToolAction } from '@ash/shared';
import { globMatch } from '../filesystem/pattern.ts';
import type { Verdict } from './evaluator.ts';

export const inside=(root:string,path:string)=>path===root||path.startsWith(root.endsWith('/')?root:root+'/');
export const readOperations=['list','read','glob','search'] as const;
export const operationVerbs:Record<string,string[]>={read:[...readOperations],read_file:['read'],list:['list'],glob:['glob'],search:['search','grep'],write:['write'],edit:['edit'],mkdir:['mkdir'],move:['move'],delete:['delete']};
export function validVerb(policy:PermissionPolicy){
  if(policy.kind==='semantic')return true;
  const {resource,verb}=policy;
  return resource.type==='filesystem'?!!operationVerbs[verb]:resource.type==='computer'?['use','observe','control'].includes(verb):resource.type==='connection'?['read','write','edit','delete','list'].includes(verb):resource.type==='messages'?verb==='send':resource.type==='public_content'?verb==='publish':resource.type==='drafts'?verb==='prepare':verb==='perform';
}
const depth=(path:string)=>path.split('/').filter(Boolean).length;
// A constrained component beats its ancestors; fixed roots break glob ties, then literals win.
const patternRank=(matchedDepth:number,root:string)=>matchedDepth*2+depth(root)/(depth(root)+1);
export function pathRank(policy:PermissionPolicy,action:ToolAction):number|null {
  if(policy.kind!=='explicit'||policy.resource.type!=='filesystem')return null;
  const resource=policy.resource;
  if(!operationVerbs[policy.verb]?.includes(action.operation.split('.').at(-1)!))return null;
  let rank:number|null=null;
  for(const target of action.resources.filter(r=>r.kind==='filesystem')){
    if(resource.scope==='file'?target.id!==resource.path:!inside(resource.path,target.id))continue;
    if(!resource.pattern){rank=Math.max(rank??-1,depth(resource.path)*2+1);continue;}
    const components=relative(resource.path,target.id).split(sep).filter(Boolean);
    if(resource.pattern.startsWith('./')){
      const pattern=resource.pattern.slice(2),recursive=pattern.endsWith('/**'),prefix=recursive?pattern.slice(0,-3):pattern;
      if(recursive){
        for(let i=1;i<=components.length;i++)if(globMatch(prefix,components.slice(0,i).join('/'))){rank=Math.max(rank??-1,patternRank(depth(resource.path)+i,resource.path));break;}
      }else if(globMatch(pattern,components.join('/')))rank=Math.max(rank??-1,patternRank(depth(target.id),resource.path));
      continue;
    }
    for(let i=0;i<components.length;i++)if(globMatch(resource.pattern,components[i]))rank=Math.max(rank??-1,patternRank(depth(resource.path)+i+1,resource.path));
  }
  return rank;
}
export function exact(policy:PermissionPolicy,action:ToolAction):Verdict {
  if(policy.kind==='semantic')return 'applies';
  const {verb,resource}=policy;
  if(resource.type==='filesystem')return !action.operation.startsWith('filesystem.')?'does_not_apply':!action.resources.some(r=>r.kind==='filesystem')?'insufficient_evidence':pathRank(policy,action)!==null?'applies':'does_not_apply';
  if(resource.type==='messages'||resource.type==='public_content'||resource.type==='drafts')return action.effects.includes(resource.type==='messages'?'send':resource.type==='public_content'?'publish':'draft')?'applies':'does_not_apply';
  if(resource.type==='operation')return action.operation===resource.name?'applies':'does_not_apply';
  if(resource.type==='computer'){
    if(!action.resources.some(r=>r.kind==='computer'))return 'does_not_apply';
    if(resource.appId&&action.facts?.appId===undefined)return 'insufficient_evidence';
    if(resource.appId&&action.facts?.appId!==resource.appId)return 'does_not_apply';
    return verb==='observe'&&!action.effects.every(e=>e==='read')?'does_not_apply':verb==='control'&&action.effects.every(e=>e==='read')?'does_not_apply':'applies';
  }
  if(action.facts?.connectionId===undefined)return action.resources.some(r=>r.kind==='connection')?'insufficient_evidence':'does_not_apply';
  for(const [field,value] of Object.entries(resource).filter(([key])=>key!=='type')){
    if(action.facts?.[field]===undefined)return 'insufficient_evidence';
    if(action.facts[field]!==value)return 'does_not_apply';
  }
  return operationVerbs[verb]?.includes(action.operation.split('.').at(-1)!)?'applies':'does_not_apply';
}
export function scopeRank(policy:PermissionPolicy,action:ToolAction):number|null{
  if(policy.kind==='explicit'&&policy.resource.type==='computer'&&exact(policy,action)==='applies')return policy.resource.appId?1:0;
  return pathRank(policy,action);
}
export function scopeWinners(rules:PermissionView[],action:ToolAction):Set<string>{
  const groups=new Map<string,Array<{id:string;rank:number}>>();
  for(const rule of rules){
    const rank=scopeRank(rule.policy,action);if(rank===null||rule.policy.kind!=='explicit')continue;
    const group=rule.policy.resource.type==='computer'?`computer:${rule.policy.verb}`:'filesystem';
    const values=groups.get(group)??[];values.push({id:rule.id,rank});groups.set(group,values);
  }
  return new Set([...groups.values()].flatMap(group=>{const best=Math.max(...group.map(r=>r.rank));return group.filter(r=>r.rank===best).map(r=>r.id);}));
}

export interface ActionTarget {id:string;action:ToolAction}
export function actionTargets(action:ToolAction):ActionTarget[]{
  const contacts=action.resources.filter(r=>['contact','recipient'].includes(r.kind));
  const recipients=contacts.length?contacts.map(r=>r.id):Array.isArray(action.facts?.recipients)?action.facts.recipients.filter((r):r is string=>typeof r==='string'):typeof action.facts?.recipient==='string'?[action.facts.recipient]:[undefined];
  const files=action.resources.filter(r=>r.kind==='filesystem');
  return (recipients.length?recipients:[undefined]).flatMap(recipient=>(files.length?files:[undefined]).map(file=>({
    id:[recipient,file?.id].filter(Boolean).join(' / ')||action.resources.map(r=>r.id).join(' / ')||'action',
    action:{...action,resources:action.resources.filter(r=>(!contacts.includes(r)||r.id===recipient)&&(!files.includes(r)||r===file)),...(recipient?{facts:{...action.facts,recipient,recipients:[recipient]}}:{})},
  })));
}
