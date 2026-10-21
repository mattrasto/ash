import { SavePermission, PermissionPolicy, LegacyPermissionPolicy, legacyCondition, type LegacyPermissionPolicy as Legacy, type SavePermission as Rule } from '@ash/shared';
import { defaultPermissions, permissionId } from './defaults.ts';
import { inside, readOperations } from './matching.ts';

type StoredRule={id:string;category:string;effect:string;policy:unknown;deletedAt?:Date|null};
const verbs:Record<string,string>={read:'read_file',list:'list',glob:'glob',search:'search',grep:'search',write:'write',edit:'edit',mkdir:'mkdir',move:'move',delete:'delete'};
const severity:Record<string,number>={allow:0,ask:1,deny:2};
function knownDefault(rule:StoredRule,policy:Legacy):Rule|undefined {
  const preset=defaultPermissions.find(r=>r.id===rule.id&&r.category===rule.category);
  if(!preset)return;
  const conditions=policy.explicit??[];
  if(rule.id.endsWith('004')&&conditions.length===1&&conditions[0].kind==='eq'&&conditions[0].field==='resourceKind'&&conditions[0].value==='computer'&&!policy.semantic)return {...preset,effect:rule.effect as Rule['effect']};
  const effect=rule.id.endsWith('001')?'draft':rule.id.endsWith('002')?'send':'publish';
  const words=effect==='draft'?['Preparing drafts within Ash.']:effect==='send'?['Sending as the user.','Send messages']:['Publishing as the user.','Publish public content'];
  if(conditions.length===1&&conditions[0].kind==='eq'&&conditions[0].field==='effect'&&conditions[0].value===effect&&policy.semantic&&words.includes(policy.semantic.condition)&&!policy.semantic.examples.length)return {...preset,effect:rule.effect as Rule['effect']};
}
export function convertRules(rows:StoredRule[],onlyId?:string):Rule[]{
  rows=[...rows].sort((a,b)=>a.id.localeCompare(b.id));
  return rows.flatMap(row=>{
    if(onlyId&&row.id!==onlyId)return [];
    if(PermissionPolicy.safeParse(row.policy).success)return [SavePermission.parse({id:row.id,category:row.category,effect:row.effect,policy:row.policy})];
    const old=LegacyPermissionPolicy.parse(row.policy),preset=knownDefault(row,old);
    if(preset)return [preset];
    const base={id:row.id,category:row.category,effect:row.effect};
    const oldPath=old.explicit?.length===1&&old.explicit[0].kind==='path'?old.explicit[0]:undefined;
    const retiredBoundary=row.deletedAt&&old.kind==='resource'&&oldPath&&!rows.some(other=>{
      if(other.deletedAt)return false;
      const legacy=LegacyPermissionPolicy.safeParse(other.policy);
      if(legacy.success)return legacy.data.kind==='resource'&&legacy.data.explicit?.some(c=>c.kind==='path'&&inside(c.root,oldPath.root));
      const current=PermissionPolicy.safeParse(other.policy);
      return current.success&&current.data.kind==='explicit'&&current.data.resource.type==='filesystem'&&!current.data.resource.pattern&&current.data.resource.scope==='subtree'&&inside(current.data.resource.path,oldPath.root);
    })?SavePermission.parse({...base,id:permissionId({migration:row.id,retiredBoundary:true}),effect:'deny',policy:{kind:'explicit',verb:'read',resource:{type:'filesystem',path:oldPath.root,scope:'subtree'}}}):undefined;
    const protect=(rules:Rule[])=>retiredBoundary?[...rules,retiredBoundary]:rules;

    const path=old.explicit?.length===1&&old.explicit[0].kind==='path'?old.explicit[0]:undefined;
    const purePath=path&&!old.semantic;
    const wouldRelax=path&&old.kind==='activity'&&rows.some(other=>{
      if(other.id===row.id||other.deletedAt||severity[other.effect]<=severity[row.effect])return false;
      const parsed=LegacyPermissionPolicy.safeParse(other.policy);if(!parsed.success)return false;
      return parsed.data.explicit?.some(c=>c.kind==='path'&&inside(c.root,path.root)&&c.operations.some(op=>path.operations.includes(op)));
    });
    if(purePath&&!wouldRelax){
      const operations=old.kind==='resource'?[...new Set([...path.operations,...readOperations])]:path.operations;
      const fullRead=readOperations.every(op=>path.operations.includes(op))&&path.operations.every(op=>(readOperations as readonly string[]).includes(op));
      if(fullRead)return protect([SavePermission.parse({...base,policy:{kind:'explicit',verb:'read',resource:{type:'filesystem',path:path.root,scope:'subtree'}}})]);
      return protect(operations.map((op,index)=>SavePermission.parse({...base,id:index===0?row.id:permissionId({migration:row.id,operation:op}),effect:path.operations.includes(op)?row.effect:'deny',policy:{kind:'explicit',verb:verbs[op],resource:{type:'filesystem',path:path.root,scope:'subtree'}}})));
    }
    const rule=SavePermission.parse({...base,policy:{kind:'semantic',condition:legacyCondition(old),examples:old.semantic?.examples??[],overrides:[]}});
    if(old.kind!=='resource')return protect([rule]);
    // A conditional legacy grant was also a boundary. Preserve its inverse as a visible
    // independent restriction; otherwise default allowance would widen old access.
    const descendants=path?rows.filter(r=>!r.deletedAt).flatMap(r=>{const p=LegacyPermissionPolicy.safeParse(r.policy);const child=p.success&&p.data.kind==='resource'&&p.data.explicit?.length===1&&p.data.explicit[0].kind==='path'?p.data.explicit[0]:undefined;return child&&child.root!==path.root&&inside(path.root,child.root)?[child.root]:[];}):[];
    const exactScope=legacyCondition({...old,semantic:undefined})+(descendants.length?`; the canonical target is outside each narrower scope: ${descendants.join(', ')}`:'');
    const peers=rows.filter(other=>!other.deletedAt&&other.effect!=='deny').flatMap(other=>{
      const p=LegacyPermissionPolicy.safeParse(other.policy);
      return p.success&&p.data.kind==='resource'&&JSON.stringify(p.data.explicit)===JSON.stringify(old.explicit)?[legacyCondition(p.data)]:[];
    });
    const condition=`Perform an action covered by (${exactScope}) when none of these previously required access conditions holds: ${peers.map(p=>`(${p})`).join(' OR ')}`;
    const baseline=path?[...new Set([...path.operations,...readOperations])].map(op=>SavePermission.parse({...base,id:permissionId({migration:row.id,scope:op}),effect:path.operations.includes(op)?'allow':'deny',policy:{kind:'explicit',verb:verbs[op],resource:{type:'filesystem',path:path.root,scope:'subtree'}}})):[];
    return protect([rule,...baseline,SavePermission.parse({...base,id:permissionId({migration:row.id,boundary:true}),effect:'deny',policy:{kind:'semantic',condition,examples:[],overrides:[]}})]);
  });
}
