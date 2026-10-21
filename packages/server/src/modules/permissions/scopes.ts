import { policyText, type PermissionPolicy } from '@ash/shared';

// Normalize only complete, known scopes. Qualifiers and resource identity stay intact.
export const conditionKey=(text:string)=>text.trim().replace(/[.!?]+$/u,'').replace(/\s+/gu,' ').replace(/^\S+/u,verb=>verb.toLowerCase());
function scopeKey(policy:PermissionPolicy):string {
  if(policy.kind==='explicit')return JSON.stringify(policy);
  const condition=conditionKey(policy.condition);
  if(/^send messages(?: to (?:any recipient|all recipients|anyone|anybody|everyone|everybody))?$/iu.test(condition))return JSON.stringify({kind:'explicit',verb:'send',resource:{type:'messages'}});
  for(const [verb,type,text] of [['publish','public_content','Publish public content'],['prepare','drafts','Prepare drafts in Ash'],['use','computer','Use computer']] as const){
    if(condition===conditionKey(text))return JSON.stringify({kind:'explicit',verb,resource:{type}});
  }
  return condition;
}
export function samePermissionScope(a:PermissionPolicy,b:PermissionPolicy):boolean {
  if(a.kind==='explicit'&&b.kind==='explicit')return scopeKey(a)===scopeKey(b);
  return scopeKey(a)===scopeKey(b)||conditionKey(policyText(a))===conditionKey(policyText(b));
}
