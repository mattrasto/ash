import { z } from 'zod';
import { ToolAction, ToolJson } from './tools.ts';

export const PermissionCategory = z.enum(['filesystem', 'computer_use', 'interaction', 'self_modification']);
export const PermissionEffect = z.enum(['allow', 'ask', 'deny']);
export const PermissionResource = z.discriminatedUnion('type', [
  z.object({ type:z.literal('filesystem'), path:z.string().startsWith('/').max(4096), scope:z.enum(['file','subtree']), pattern:z.string().min(1).max(4096).optional() }).strict(),
  z.object({ type:z.literal('computer'), appId:z.string().min(1).max(4096).optional() }).strict(),
  z.object({ type:z.literal('connection'), connectionId:z.string().min(1).max(4096), accountId:z.string().min(1).max(4096).optional(), resourceId:z.string().min(1).max(4096).optional() }).strict(),
  z.object({ type:z.enum(['messages','public_content','drafts']) }).strict(),
  z.object({ type:z.literal('operation'), name:z.string().min(1).max(100) }).strict(),
]);
export const PermissionPolicy = z.discriminatedUnion('kind', [
  z.object({ kind:z.literal('explicit'), verb:z.enum(['read','read_file','list','glob','search','write','edit','mkdir','move','delete','use','observe','control','send','publish','prepare','perform']), resource:PermissionResource }).strict(),
  z.object({ kind:z.literal('semantic'), condition:z.string().trim().min(1).max(4000), examples:z.array(z.string().max(1000)).max(12).default([]), overrides:z.array(z.string().uuid()).max(64).default([]).transform(ids=>ids.sort()) }).strict(),
]);
export type PermissionPolicy = z.infer<typeof PermissionPolicy>;
export const SavePermission = z.object({ id:z.string().uuid(), category:PermissionCategory, effect:PermissionEffect, policy:PermissionPolicy }).strict();
export type SavePermission = z.infer<typeof SavePermission>;
export const PermissionView = SavePermission.extend({ createdAt:z.string().datetime(), updatedAt:z.string().datetime(), deletedAt:z.string().datetime().nullable() });
export type PermissionView = z.infer<typeof PermissionView>;
export const FormalizePermission = z.object({ text:z.string().trim().min(1).max(4000), category:PermissionCategory, effect:PermissionEffect, id:z.string().uuid().optional() }).strict();
export const FilesystemPermissionInput = z.object({path:z.string().trim().min(1).max(4096)}).strict();
export const PermissionReplacement = z.object({id:z.string().uuid(),replacementId:z.string().uuid()}).strict();
export const PermissionRemoval = PermissionReplacement.partial({replacementId:true}).extend({reason:z.string().trim().min(1).max(2000)});
export type PermissionRemoval = z.infer<typeof PermissionRemoval>;
export const ReviewPermissions = z.object({ rules:z.array(SavePermission).max(512), removeIds:z.array(z.string().uuid()).max(512).default([]), replacements:z.array(PermissionReplacement).max(512).default([]) }).strict();
export const CommitPermissions = ReviewPermissions.omit({replacements:true}).extend({ reviewToken:z.string().min(1).max(500000) });
export const PermissionReview = z.object({ rules:z.array(SavePermission), removeIds:z.array(z.string().uuid()), affected:z.array(PermissionView), examples:z.array(z.string().max(2000)).max(256), reviewToken:z.string(), snapshot:z.string() }).strict();
export type PermissionReview = z.infer<typeof PermissionReview>;
export const FormalizedPermissions = z.object({ rules:z.array(SavePermission).max(32), removals:z.array(PermissionRemoval).max(32).default([]), clarification:z.string().nullable() }).strict();
export type FormalizedPermissions = z.infer<typeof FormalizedPermissions>;

// Immutable captures retain their original policy shape; live writes only accept PermissionPolicy.
export const LegacyPermissionPolicy = z.object({
  kind:z.enum(['resource','activity']), wording:z.string().optional(),
  explicit:z.array(z.discriminatedUnion('kind', [
    z.object({kind:z.literal('path'),root:z.string(),operations:z.array(z.string())}).strict(),
    z.object({kind:z.literal('eq'),field:z.enum(['operation','effect','resourceKind','resourceId','appId','site','recipient','targetKind']),value:z.string()}).strict(),
  ])).optional(),
  semantic:z.object({condition:z.string(),examples:z.array(z.string()).default([])}).strict().optional(),
}).strict().refine(p=>!!p.explicit?.length||!!p.semantic);
export type LegacyPermissionPolicy = z.infer<typeof LegacyPermissionPolicy>;
export const CapturedSavePermission = SavePermission.extend({policy:z.union([PermissionPolicy,LegacyPermissionPolicy])});
export type CapturedSavePermission = z.infer<typeof CapturedSavePermission>;
const CapturedPermissionView = CapturedSavePermission.extend({createdAt:z.string().datetime(),updatedAt:z.string().datetime(),deletedAt:z.string().datetime().nullable()});
export const permissionVerbNames:Record<Extract<PermissionPolicy,{kind:'explicit'}>['verb'],string> = { read:'Read',read_file:'Read file contents in',list:'List',glob:'Find files in',search:'Search',write:'Write',edit:'Edit',mkdir:'Create folders in',move:'Move',delete:'Delete',use:'Use',observe:'Observe',control:'Control',send:'Send',publish:'Publish',prepare:'Prepare',perform:'Perform' };
export function filesystemResourceText(resource:Extract<z.infer<typeof PermissionResource>,{type:'filesystem'}>):string {
  const root=resource.path==='/'?'':resource.path;
  return resource.pattern?`${root}/${resource.pattern.startsWith('./')?resource.pattern.slice(2):'**/'+resource.pattern+'/**'}`:`${resource.path}${resource.scope==='subtree'&&resource.path!=='/'?'/':''}`;
}
export function policyText(policy:PermissionPolicy|LegacyPermissionPolicy):string {
  if(policy.kind==='semantic')return policy.condition;
  if(policy.kind!=='explicit')return policy.wording??policy.semantic?.condition??legacyCondition(policy);
  const resource=policy.resource;
  const target=resource.type==='filesystem'?filesystemResourceText(resource)
    :resource.type==='computer'?resource.appId??'computer':resource.type==='messages'?'messages':resource.type==='public_content'?'public content':resource.type==='drafts'?'drafts in Ash'
    :resource.type==='operation'?resource.name:resource.type==='connection'?[resource.connectionId,resource.accountId,resource.resourceId].filter(Boolean).join(' / '):resource.type;
  return `${permissionVerbNames[policy.verb]} ${target}`;
}
export function legacyCondition(policy:LegacyPermissionPolicy):string {
  const clauses=(policy.explicit??[]).map(c=>c.kind==='path'?`the operation is one of ${c.operations.join(', ')} and its canonical filesystem target is ${c.root} or a descendant`
    :`the ${c.field} equals ${JSON.stringify(c.value)}`);
  if(policy.semantic)clauses.push(policy.semantic.condition);
  return `Perform an action where ${clauses.map(c=>`(${c})`).join(' AND ')}`;
}
export function permissionForReview(rule:CapturedSavePermission):SavePermission {
  return SavePermission.parse({...rule,policy:rule.policy.kind==='resource'||rule.policy.kind==='activity'?{kind:'semantic',condition:legacyCondition(rule.policy),examples:rule.policy.semantic?.examples??[],overrides:[]}:rule.policy});
}
export const Verdict = z.enum(['applies','does_not_apply','insufficient_evidence']);
export const PermissionEvaluation = z.object({
  type:z.literal('permission_evaluation'),action:ToolAction,binding:z.string(),
  rules:z.array(CapturedPermissionView),matches:z.record(z.string(), Verdict),
  outcome:z.enum(['allowed','denied','needs-input','blocked']),reasons:z.array(z.string()),
  sensitivity:Verdict,coverage:Verdict,answers:z.record(z.string(), ToolJson),model:z.string(),
  context:z.record(z.string(), ToolJson).default({}),questions:z.array(z.object({id:z.string(),instructions:z.string()}).strict()).default([]),
  configuration:z.object({evaluator:z.string(),threshold:z.number().nullable()}).strict().default({evaluator:'not-captured',threshold:null}),
  scopes:z.array(z.object({target:z.string(),ruleIds:z.array(z.string().uuid())})).default([]),
  overrides:z.array(z.object({ruleId:z.string().uuid(),broaderId:z.string().uuid(),target:z.string()})).default([]),
  effectiveRuleIds:z.array(z.string().uuid()).optional(),
  decisionId:z.string().uuid().optional(),proposal:CapturedSavePermission.optional(),
}).strict();
export type PermissionEvaluation = z.infer<typeof PermissionEvaluation>;
