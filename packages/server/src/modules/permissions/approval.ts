import { PermissionEvaluation, type DecisionView, type PermissionView, type ToolAction, type LegacyPermissionPolicy } from '@ash/shared';
import type { PrismaClient } from '@prisma/client';
import { fingerprint } from '../decisions/service.ts';
import { convertRules } from './migration.ts';
import { actionTargets, exact, inside, scopeRank, scopeWinners } from './matching.ts';

export function bindingRules(rules:PermissionView[],action:ToolAction){
  return rules.filter(rule=>actionTargets(action).some(target=>exact(rule.policy,target.action)!=='does_not_apply'&&(scopeRank(rule.policy,target.action)===null||scopeWinners(rules,target.action).has(rule.id))));
}
function oldMatch(policy:LegacyPermissionPolicy,action:ToolAction){
  const values=(policy.explicit??[]).map(c=>{
    if(c.kind==='path')return c.operations.some(op=>[action.operation,action.operation.split('.').at(-1),...(action.operation==='filesystem.search'?['grep']:[])].includes(op))&&action.resources.some(r=>r.kind==='filesystem'&&inside(c.root,r.id));
    const data=c.field==='operation'?[action.operation,action.operation.split('.').at(-1)]:c.field==='effect'?action.effects:c.field==='resourceKind'?action.resources.map(r=>r.kind):c.field==='resourceId'?action.resources.map(r=>r.id):action.facts?.[c.field]===undefined?null:[String(action.facts[c.field])];
    return data===null?null:data.includes(c.value);
  });
  return values.includes(false)?false:values.includes(null)?null:true;
}
const normalized=(rules:Array<{id:string;effect:string;policy:unknown}>)=>rules.map(r=>({id:r.id,effect:r.effect,policy:r.policy})).sort((a,b)=>a.id.localeCompare(b.id));
/** Reconstruct the previous binding, then compare migrated effective predicates. No age-based grant transfer. */
export async function unchangedMigrationApproval(db:PrismaClient,decision:DecisionView,action:ToolAction,baseBinding:string,current:PermissionView[]){
  if(decision.request.kind!=='permission'||!decision.request.evaluationArtifactId)return false;
  const artifact=await db.artifact.findUnique({where:{id:decision.request.evaluationArtifactId}});
  const capture=PermissionEvaluation.safeParse(artifact?.payload);if(!capture.success)return false;
  const old=capture.data;
  if(!old.rules.some(r=>r.policy.kind==='resource'||r.policy.kind==='activity'))return false;
  const restricted=old.rules.filter(r=>r.effect!=='allow'&&((r.policy.kind==='explicit'||r.policy.kind==='semantic')?exact(r.policy,action)!=='does_not_apply':oldMatch(r.policy,action)!==false));
  if(decision.request.binding!==fingerprint({actionBinding:baseBinding,rules:restricted.map(r=>({id:r.id,effect:r.effect,policy:r.policy}))}))return false;
  const converted=convertRules(old.rules.map(r=>({id:r.id,category:r.category,effect:r.effect,policy:r.policy,deletedAt:r.deletedAt?new Date(r.deletedAt):null}))).map(r=>({...r,createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString(),deletedAt:null}));
  return fingerprint(normalized(bindingRules(converted,action)))===fingerprint(normalized(bindingRules(current,action)));
}
