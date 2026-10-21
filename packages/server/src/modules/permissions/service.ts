import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { Prisma, type PrismaClient } from '@prisma/client';
import { SavePermission, CommitPermissions, ReviewPermissions, PermissionReview, PermissionView, PermissionPolicy, PermissionEvaluation, policyText, ZodError, type ToolAction, type FormalizePermission } from '@ash/shared';
import { Decisions, fingerprint, decisionView } from '../decisions/service.ts';
import { evidenceInstruction, sensitivityQuestion, unavailableEvaluator, type Evaluator, type Question, type Verdict } from './evaluator.ts';
import type { ModelAdapter } from '../../platform/models/adapter.ts';
import type { FilesystemConfig } from '../filesystem/runtime.ts';
import { defaultPermissions, filesystemPermissions, permissionId, previousCodeExcludedNames } from './defaults.ts';
import { exact, actionTargets, scopeRank, scopeWinners } from './matching.ts';
import { convertRules } from './migration.ts';
import { bindingRules, unchangedMigrationApproval } from './approval.ts';
import { PermissionError, validateRule, formalize, reviewLinks, authoringJson } from './authoring.ts';
export { PermissionError } from './authoring.ts';
const json=(value:unknown)=>value as Prisma.InputJsonValue;
const view=(row:any):PermissionView=>PermissionView.parse({id:row.id,category:row.category,effect:row.effect,policy:row.policy,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),deletedAt:row.deletedAt?.toISOString()??null});
const command=(rule:PermissionView):SavePermission=>({id:rule.id,category:rule.category,effect:rule.effect,policy:rule.policy});
const policyState=(rules:PermissionView[])=>fingerprint(rules.map(r=>({...command(r),updatedAt:r.updatedAt})));
const signature=(rules:SavePermission[])=>rules.map(r=>({id:r.id,effect:r.effect,policy:r.policy})).sort((a,b)=>a.id.localeCompare(b.id));
export class Permissions {
  private reviewKey=randomBytes(32);
  constructor(readonly db:PrismaClient,readonly decisions:Decisions,private evaluator:Evaluator=unavailableEvaluator,private model?:ModelAdapter){}
  private async lock(tx:Prisma.TransactionClient){await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ash.permissions'))::text`;}
  async list(){return (await this.db.permission.findMany({where:{deletedAt:null},orderBy:[{createdAt:'asc'},{id:'asc'}]})).map(view);}
  private async persist(tx:Prisma.TransactionClient,rule:SavePermission){
    const previous=await tx.permission.findUnique({where:{id:rule.id}});
    if(previous&&(previous.deletedAt||previous.category!==rule.category))throw new PermissionError(409,'A permission cannot change category or restore a retired permission.');
    if(previous&&fingerprint({effect:previous.effect,policy:previous.policy})===fingerprint({effect:rule.effect,policy:rule.policy}))return view(previous);
    const now=new Date();return view(previous?await tx.permission.update({where:{id:rule.id},data:{effect:rule.effect,policy:json(rule.policy),updatedAt:now}}):await tx.permission.create({data:{...rule,policy:json(rule.policy),createdAt:now,updatedAt:now}}));
  }
  // Internal link-free writes also serve seeding and boundary fixtures. Authoring uses review/commit.
  async save(input:unknown){
    const rule=SavePermission.parse(input);await validateRule(rule);
    return this.db.$transaction(async tx=>{
      await this.lock(tx);const all=(await tx.permission.findMany({where:{deletedAt:null}})).map(view),old=all.find(r=>r.id===rule.id);
      const changed=!old||fingerprint(command(old))!==fingerprint(rule);
      if(changed&&((rule.policy.kind==='semantic'&&rule.policy.overrides.length)||all.some(r=>r.policy.kind==='semantic'&&r.policy.overrides.includes(rule.id))))throw new PermissionError(409,'Review the affected override relationships before saving.');
      return this.persist(tx,rule);
    });
  }
  async changeEffect(input:unknown){
    const rule=SavePermission.parse(input);await validateRule(rule);
    return this.db.$transaction(async tx=>{
      await this.lock(tx);const all=(await tx.permission.findMany({where:{deletedAt:null}})).map(view),old=all.find(r=>r.id===rule.id);
      if(!old||fingerprint(old.policy)!==fingerprint(rule.policy)||old.category!==rule.category)throw new PermissionError(409,'Review the interpretation before saving.');
      if((rule.policy.kind==='semantic'&&rule.policy.overrides.length)||all.some(r=>r.policy.kind==='semantic'&&r.policy.overrides.includes(rule.id)))throw new PermissionError(409,'Review the affected override relationships before saving.');
      return this.persist(tx,rule);
    });
  }
  async review(input:unknown){
    const request=ReviewPermissions.parse(input),current=await this.list();
    if(!request.rules.length&&!request.removeIds.length)throw new PermissionError(400,'Choose permissions to review.');
    if(new Set(request.rules.map(r=>r.id)).size!==request.rules.length||new Set(request.removeIds).size!==request.removeIds.length)throw new PermissionError(400,'Each permission appears once in a review.');
    if(request.rules.some(r=>request.removeIds.includes(r.id)))throw new PermissionError(400,'A permission cannot be saved and removed together.');
    const rows=await this.db.permission.findMany({where:{id:{in:request.rules.map(r=>r.id)}}});
    for(const rule of request.rules){await validateRule(rule);if(rule.policy.kind==='semantic'&&(rule.policy.overrides.includes(rule.id)||new Set(rule.policy.overrides).size!==rule.policy.overrides.length))throw new PermissionError(422,'Overrides must name distinct active permissions, never the permission itself.');const old=rows.find(r=>r.id===rule.id);if(old&&(old.deletedAt||old.category!==rule.category))throw new PermissionError(409,'A permission cannot change category or restore a retired permission.');}
    if(request.removeIds.some(id=>!current.some(r=>r.id===id)))throw new PermissionError(404,'Permission not found.');
    const replacements=new Map(request.replacements.map(r=>[r.id,r.replacementId]));
    if(replacements.size!==request.replacements.length||request.replacements.some(r=>!request.removeIds.includes(r.id)||request.removeIds.includes(r.replacementId)||r.id===r.replacementId))throw new PermissionError(422,'Consolidation must remove a duplicate and retain one replacement.');
    const changed=new Set([...request.rules.map(r=>r.id),...request.removeIds]);
    const incoming=current.filter(r=>r.policy.kind==='semantic'&&r.policy.overrides.some(id=>changed.has(id)));
    const writes=new Map(request.rules.map(r=>[r.id,r]));
    const retained=new Map([...current.filter(r=>!request.removeIds.includes(r.id)).map(command),...request.rules].map(r=>[r.id,r]));
    if([...replacements.values()].some(id=>!retained.has(id)))throw new PermissionError(422,'The consolidation replacement must remain selected or already saved.');
    const remap=(refs:string[],self:string)=>[...new Set(refs.map(id=>replacements.get(id)??id).filter(id=>id!==self&&!request.removeIds.includes(id)))].sort();
    for(const rule of retained.values()){
      const inherited=request.replacements.filter(r=>r.replacementId===rule.id).flatMap(r=>{const old=current.find(p=>p.id===r.id)!;return old.policy.kind==='semantic'?old.policy.overrides:[];});
      const refs=remap([...(rule.policy.kind==='semantic'?rule.policy.overrides:[]),...inherited],rule.id);
      const policy=rule.policy.kind==='semantic'?{...rule.policy,overrides:refs}:refs.length?{kind:'semantic' as const,condition:policyText(rule.policy),examples:[],overrides:refs}:rule.policy;
      // Ordinary retirement removes references; consolidation transfers them to the survivor.
      if(JSON.stringify(policy)!==JSON.stringify(rule.policy)||incoming.some(p=>p.id===rule.id))writes.set(rule.id,{...rule,policy});
    }
    const final=[...current.filter(r=>!writes.has(r.id)&&!request.removeIds.includes(r.id)).map(command),...writes.values()];
    this.validateGraph(final);
    const consolidations=request.replacements.map(r=>({removed:command(current.find(p=>p.id===r.id)!),replacementId:r.replacementId}));
    let examples:string[];try{examples=await reviewLinks([...writes.values()],final,this.model,consolidations);}catch(error){if(error instanceof ZodError)throw new PermissionError(422,'The permission review could not be validated. Keep the draft and clarify it.');throw error;}
    for(const id of request.removeIds){
      const old=current.find(r=>r.id===id)!,replacement=final.find(r=>r.id===replacements.get(id));
      if(replacement)examples.push(`Consolidate “${policyText(old.policy)}” into “${policyText(replacement.policy)}” (${replacement.effect==='deny'?'Never':replacement.effect==='ask'?'Ask':'Allow'}); preserve its override relationships.`);
      else examples.push(`Remove “${policyText(old.policy)}”; future actions use the remaining permissions.`);
    }
    const oldTargets=new Set(current.filter(r=>changed.has(r.id)).flatMap(r=>r.policy.kind==='semantic'?r.policy.overrides:[]));
    for(const old of current){
      if(old.policy.kind!=='semantic'||request.removeIds.includes(old.id))continue;
      const updated=final.find(r=>r.id===old.id);
      for(const broaderId of old.policy.overrides)if(updated?.policy.kind==='semantic'&&!updated.policy.overrides.includes(broaderId)){
        const broader=final.find(r=>r.id===broaderId);
        if(broader)examples.push(`Actions matching “${policyText(updated.policy)}” are also subject to “${policyText(broader.policy)}” (${broader.effect==='deny'?'Never':broader.effect==='ask'?'Ask':'Allow'}) again.`);
      }
    }
    const affected=current.filter(r=>changed.has(r.id)||writes.has(r.id)||[...replacements.values()].includes(r.id)||oldTargets.has(r.id)||incoming.some(i=>i.id===r.id)||[...writes.values()].some(w=>w.policy.kind==='semantic'&&w.policy.overrides.includes(r.id)));
    const data={rules:[...writes.values()],removeIds:request.removeIds,snapshot:policyState(current)};
    const payload=Buffer.from(JSON.stringify(data)).toString('base64url'),mac=createHmac('sha256',this.reviewKey).update(payload).digest('base64url');
    return PermissionReview.parse({...data,affected,examples,reviewToken:`${payload}.${mac}`});
  }
  private validateGraph(rules:SavePermission[]){
    const byId=new Map(rules.map(r=>[r.id,r]));
    for(const rule of rules)if(rule.policy.kind==='semantic'){
      const refs=rule.policy.overrides;
      if(new Set(refs).size!==refs.length||refs.some(id=>id===rule.id||!byId.has(id)))throw new PermissionError(422,'Overrides must name distinct active permissions, never the permission itself.');
    }
    const visited=new Set<string>(),visiting=new Set<string>();
    const visit=(id:string)=>{if(visiting.has(id))throw new PermissionError(422,'Override relationships cannot form a cycle.');if(visited.has(id))return;visiting.add(id);const rule=byId.get(id)!;if(rule.policy.kind==='semantic')rule.policy.overrides.forEach(visit);visiting.delete(id);visited.add(id);};
    rules.forEach(r=>visit(r.id));
  }
  async commit(input:unknown){
    const request=CommitPermissions.parse(input),[payload,mac,...extra]=request.reviewToken.split('.');
    for(const rule of request.rules)await validateRule(rule);
    const expected=createHmac('sha256',this.reviewKey).update(payload??'').digest('base64url');
    if(!payload||!mac||extra.length||mac.length!==expected.length||!timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))throw new PermissionError(409,'Review the interpretation again before saving.');
    const reviewed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')) as {rules:SavePermission[];removeIds:string[];snapshot:string};
    if(fingerprint({rules:request.rules,removeIds:request.removeIds})!==fingerprint({rules:reviewed.rules,removeIds:reviewed.removeIds}))throw new PermissionError(409,'The draft changed. Review the interpretation again.');
    return this.db.$transaction(async tx=>{
      await this.lock(tx);const current=(await tx.permission.findMany({where:{deletedAt:null},orderBy:[{createdAt:'asc'},{id:'asc'}]})).map(view);
      if(policyState(current)!==reviewed.snapshot)throw new PermissionError(409,'Permissions changed since this review. Review the current permissions again.');
      const saved=[];for(const rule of reviewed.rules)saved.push(await this.persist(tx,SavePermission.parse(rule)));
      await tx.permission.updateMany({where:{id:{in:reviewed.removeIds},deletedAt:null},data:{deletedAt:new Date(),updatedAt:new Date()}});
      return saved;
    });
  }
  async remove(id:string){
    return this.db.$transaction(async tx=>{await this.lock(tx);const all=(await tx.permission.findMany({where:{deletedAt:null}})).map(view);
      const rule=all.find(r=>r.id===id);if(!rule)throw new PermissionError(404,'Permission not found.');
      if((rule.policy.kind==='semantic'&&rule.policy.overrides.length)||all.some(r=>r.policy.kind==='semantic'&&r.policy.overrides.includes(id)))throw new PermissionError(409,'Review the relationship impact before removing this permission.');
      await tx.permission.update({where:{id},data:{deletedAt:new Date(),updatedAt:new Date()}});
    });
  }
  async seed(filesystem?:FilesystemConfig,codeDirectory?:string){
    const scopes:FilesystemConfig['scopes']=[];for(const scope of filesystem?.scopes??[])if(isAbsolute(scope.path)&&resolve(scope.path)===scope.path&&await realpath(scope.path).catch(()=>null)===scope.path)scopes.push(scope);
    await this.db.$transaction(async tx=>{
      await this.lock(tx);const rows=await tx.permission.findMany();
      for(const row of rows){
        if(PermissionPolicy.safeParse(row.policy).success)continue;
        const converted=convertRules(rows.map(r=>({id:r.id,category:r.category,effect:r.effect,policy:r.policy,deletedAt:r.deletedAt})),row.id);
        for(const rule of converted){const original=rule.id===row.id;await tx.permission.upsert({where:{id:rule.id},create:{...rule,policy:json(rule.policy),createdAt:row.createdAt,updatedAt:new Date(),deletedAt:rule.id===permissionId({migration:row.id,retiredBoundary:true})?null:row.deletedAt},update:original?{policy:json(rule.policy),updatedAt:new Date()}:{} });}
      }
      for(const rule of defaultPermissions)if(!await tx.permission.findUnique({where:{id:rule.id}}))await this.persist(tx,rule);
      const codeScope=scopes.find(scope=>scope.path===codeDirectory);
      const linkedIds=new Set((await tx.permission.findMany({where:{deletedAt:null},select:{policy:true}})).flatMap(row=>{const parsed=PermissionPolicy.safeParse(row.policy);return parsed.success&&parsed.data.kind==='semantic'?parsed.data.overrides:[];}));
      if(codeScope)for(const name of previousCodeExcludedNames){
        if(codeScope.excludedNames.includes(name))continue;
        const id=permissionId({filesystemScope:codeDirectory,exclusion:name}),old=await tx.permission.findUnique({where:{id}});
        const policy={kind:'explicit',verb:'read',resource:{type:'filesystem',path:codeDirectory,scope:'subtree',pattern:name}};
        if(old&&!old.deletedAt&&!linkedIds.has(id)&&old.effect==='deny'&&fingerprint(old.policy)===fingerprint(policy))await tx.permission.update({where:{id},data:{deletedAt:new Date(),updatedAt:new Date()}});
      }
      for(const scope of scopes){
        const catalog=filesystemPermissions(scope),existing=await tx.permission.findUnique({where:{id:catalog[0].id}});
        for(const rule of catalog){
          const pattern=rule.policy.kind==='explicit'&&rule.policy.resource.type==='filesystem'&&rule.policy.resource.pattern;
          if(existing&&!pattern)continue;
          if(!await tx.permission.findUnique({where:{id:rule.id}}))await this.persist(tx,rule);
        }
      }
    },{timeout:20000});
  }

  async formalize(input:ReturnType<typeof FormalizePermission.parse>){try{return await formalize(input,await this.list(),this.model);}catch(error){if(error instanceof ZodError)throw new PermissionError(422,'The interpretation could not be validated. Keep the draft and clarify it.');throw error;}}
  private async propose(action:ToolAction,signal:AbortSignal){
    if(!this.model||this.model.configuration('normal').provider==='deterministic')return;
    try{return SavePermission.parse({id:randomUUID(),...await authoringJson(this.model,'Propose one standing permission for an uncovered sensitive consequence. Return JSON {category,effect,policy:{kind:"semantic",condition,examples:[],overrides:[]}}. Categories filesystem|computer_use|interaction|self_modification; effects allow|ask|deny. Condition is the complete positive action phrase; preserve qualifications, generalize only incidental recipients/tools/sites, and exclude ordinary authentication with an intended service. Prefer Ask unless a prohibition is warranted. Do not propose override authority. This proposal remains inactive pending review.',action,AbortSignal.any([signal,AbortSignal.timeout(30000)]))});}catch{return;}
  }
  async evaluate(action:ToolAction,actionBinding:string,signal:AbortSignal,approvalIds?:string|string[],context?:{text:string;inputId:string;source?:'direct_user'|'external_source';resourceAccess?:'established'|'capability-only';conversation?:{role:string;text:string}[]},cache?:Map<string,PermissionEvaluation>){
    const allRules=await this.list(),targets=actionTargets(action);
    const rules=allRules.filter(r=>targets.some(t=>exact(r.policy,t.action)!=='does_not_apply'));
    const binding=fingerprint({actionBinding,rules:signature(bindingRules(rules,action))}),ids=typeof approvalIds==='string'?[approvalIds]:approvalIds??[];
    const approvals=ids.length?(await this.db.decision.findMany({where:{id:{in:ids},status:'resolved'}})).map(decisionView):[];
    let approved=approvals.find(d=>d.request.kind==='permission'&&d.request.binding===binding&&d.resolution?.kind==='answer'&&d.resolution.source==='controls');
    if(!approved)for(const prior of approvals)if(prior.resolution?.kind==='answer'&&prior.resolution.source==='controls'&&await unchangedMigrationApproval(this.db,prior,action,actionBinding,rules)){approved=prior;break;}
    const answer=approved?.resolution?.kind==='answer'?approved.resolution:undefined,valid=!!approved&&!!answer;
    const cacheKey=fingerprint({action,binding,resolution:approved?.resolution,context}),cached=cache?.get(cacheKey);if(cached)return cached;
    const exceptions=valid&&answer?.value==='exception'?approved!.request.restrictionIds:[];
    const matches:Record<string,Verdict>={},perTarget=targets.map(t=>Object.fromEntries(rules.map(r=>[r.id,r.policy.kind==='semantic'?'insufficient_evidence':exact(r.policy,t.action)])) as Record<string,Verdict>);
    let model='exact',answers:Record<string,any>={},sensitivity:Verdict='does_not_apply',coverage:Verdict='does_not_apply',proposal:SavePermission|undefined;
    const applied:PermissionEvaluation['overrides']=[],scopes:PermissionEvaluation['scopes']=[],effective=new Set<string>(),suppressedByTarget=targets.map(()=>new Set<string>());
    const packet={action:{...action,effectsKnown:!!action.effects.length},targets,evidence:context?[{source:context.source??'direct_user',text:context.text,id:context.inputId},...(context.conversation?.length?[{source:'conversation',messages:context.conversation}]:[])]:[],authorization:valid?[{source:'decision_controls',action:approved!.request.action,value:answer!.value,comment:answer!.comment}]:[]};
    const questions:Question[]=[];
    const resolveMatches=()=>{
      effective.clear();applied.length=0;scopes.length=0;suppressedByTarget.forEach(ids=>ids.clear());
      targets.forEach((target,i)=>{
        const winners=scopeWinners(rules,target.action);scopes.push({target:target.id,ruleIds:[...winners]});
        const eligible=rules.filter(r=>perTarget[i][r.id]!=='does_not_apply'&&(scopeRank(r.policy,target.action)===null||winners.has(r.id)));
        const active=eligible.filter(r=>perTarget[i][r.id]==='applies'),suppressed=suppressedByTarget[i];
        for(const rule of active)if(rule.policy.kind==='semantic')for(const broaderId of rule.policy.overrides)if(eligible.some(r=>r.id===broaderId)){suppressed.add(broaderId);applied.push({ruleId:rule.id,broaderId,target:target.id});}
        active.filter(r=>!suppressed.has(r.id)).forEach(r=>effective.add(r.id));
      });
      for(const rule of rules){const values=perTarget.map(m=>m[rule.id]);matches[rule.id]=values.includes('applies')?'applies':values.includes('insufficient_evidence')?'insufficient_evidence':'does_not_apply';}
    };
    const active=()=>rules.filter(r=>effective.has(r.id)),denied=()=>active().filter(r=>r.effect==='deny'&&!exceptions.includes(r.id));
    const finish=(outcome:PermissionEvaluation['outcome'],reasons:string[])=>{const result=PermissionEvaluation.parse({type:'permission_evaluation',action,binding,rules,matches,outcome,reasons,sensitivity,coverage,answers,model,context:JSON.parse(JSON.stringify(packet)),questions,configuration:{evaluator:this.evaluator.name??'controlled',threshold:this.evaluator.threshold??null},scopes,overrides:applied,effectiveRuleIds:[...effective],...(proposal?{proposal}:{}),...(valid?{decisionId:approved!.id}:{})});cache?.set(cacheKey,result);return result;};
    if(context?.resourceAccess==='capability-only'&&!action.resources.length)return finish('blocked',['This adapter did not describe the resource needing access.']);
    resolveMatches();
    const definiteDenials=denied().filter(r=>r.policy.kind==='explicit'&&!rules.some(other=>other.policy.kind==='semantic'&&other.policy.overrides.includes(r.id)));
    if(definiteDenials.length)return finish('denied',definiteDenials.map(r=>`Blocked by: ${policyText(r.policy)}`));
    const questionId=(id:string,i:number)=>targets.length===1?`rule.${id}`:`rule.${id}.target.${i}`;
    targets.forEach((target,i)=>{for(const rule of rules)if(rule.policy.kind==='semantic')questions.push({id:questionId(rule.id,i),instructions:`${evidenceInstruction} Is this specific target/action covered by the condition: ${rule.policy.condition}? Boundary examples: ${rule.policy.examples.join(' ')}. Evaluate only this target; other recipients cannot satisfy its identity. Target action: ${JSON.stringify(target.action)}`});});
    questions.push(sensitivityQuestion);
    const result=await this.evaluator.evaluate(packet,questions,signal);model=result.model;answers=result.answers;
    targets.forEach((_,i)=>{for(const rule of rules)if(rule.policy.kind==='semantic')perTarget[i][rule.id]=answers[questionId(rule.id,i)]?.value??'insufficient_evidence';});
    sensitivity=answers.sensitivity?.value??'insufficient_evidence';resolveMatches();
    if(Object.values(answers).some(a=>a.error))return finish('blocked',['Permission evaluation is unavailable. Retry when the evaluator is available.']);
    if(perTarget.some((values,i)=>Object.entries(values).some(([id,value])=>value==='insufficient_evidence'&&!suppressedByTarget[i].has(id))))return finish('needs-input',['A permission needs clarification before this action can proceed.']);
    if(denied().length)return finish('denied',denied().map(r=>`Blocked by: ${policyText(r.policy)}`));
    if(sensitivity==='applies'){
      const question={id:'coverage',instructions:`${evidenceInstruction} Is every sensitive consequence explicitly addressed by an effective applicable rule or saved Decision response? Generic app/contact access is insufficient. Empty covering lists are a negative answer.`};questions.push(question);
      const covering=await this.evaluator.evaluate({...packet,applicableRules:active().map(r=>({effect:r.effect,policy:r.policy}))},[question],signal);answers={...answers,...covering.answers};coverage=answers.coverage?.value??'insufficient_evidence';
      if(answers.coverage?.error)return finish('blocked',['Sensitive-consequence evaluation is unavailable.']);
    }
    if(sensitivity==='insufficient_evidence'||(sensitivity==='applies'&&coverage!=='applies'&&!(valid&&['approve','not-applicable','exception'].includes(String(answer?.value))))){
      if(sensitivity==='applies')proposal=await this.propose(action,signal);
      return finish('needs-input',[`An unaddressed sensitive consequence needs your review.${proposal?' Proposed boundary: '+policyText(proposal.policy):''}`]);
    }
    if(valid&&answer?.value==='decline')return finish('denied',['The user declined this action.']);
    const asking=active().filter(r=>r.effect==='ask');
    if(asking.length&&!(valid&&['approve','exception'].includes(String(answer?.value))))return finish('needs-input',asking.map(r=>`Confirmation required: ${policyText(r.policy)}`));
    return finish('allowed',[]);
  }
}
