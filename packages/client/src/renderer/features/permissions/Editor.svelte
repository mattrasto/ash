<script lang="ts">
  import { policyText, filesystemResourceText, permissionVerbNames, type PermissionView, type PermissionPolicy, type SavePermission, type FormalizedPermissions, type PermissionRemoval, type PermissionReview } from '@ash/shared';
  import { onMount, tick } from 'svelte';
  import Icon from '../threads/Icon.svelte';
  let {api,onChanged,onDraftChange,initialRule,busy=$bindable(false)}:{api:<T>(path:string,body?:object)=>Promise<T>;onChanged:()=>Promise<void>;onDraftChange?:(draft:boolean)=>void;initialRule?:SavePermission;busy?:boolean}=$props();
  let rules=$state<PermissionView[]>([]),category=$state<PermissionView['category']>('filesystem');
  let draft=$state(false),loading=$state(true),error=$state(''),notice=$state(''),removing=$state(false);
  let id=$state(''),text=$state(''),ruleEffect=$state<SavePermission['effect']>('ask'),mode=$state<'describe'|'explicit'>('describe');
  let resourceType=$state('filesystem'),verb=$state<Extract<PermissionPolicy,{kind:'explicit'}>['verb']>('read'),path=$state('');
  let candidates=$state<SavePermission[]|null>(null),review=$state<PermissionReview|null>(null),dropped=$state<string[]>([]);
  let removals=$state<PermissionRemoval[]>([]),excludedRemovals=$state<string[]>([]);
  let excluded=$state<string[]>([]),addingOverride=$state<string|null>(null),overrideSearch=$state('');
  let descriptionInput=$state<HTMLTextAreaElement>(),pathInput=$state<HTMLInputElement>();
  const categories=[['filesystem','Filesystem'],['computer_use','Computer use'],['interaction','Interaction'],['self_modification','Self-modification']] as const;
  const effects=[['allow','Allow'],['ask','Ask'],['deny','Never']] as const;
  const existing=$derived(rules.find(r=>r.id===id));
  const incoming=$derived(rules.filter(r=>r.id!==id&&r.policy.kind==='semantic'&&r.policy.overrides.includes(id)));
  const verbOptions=$derived(resourceType==='filesystem'?['read','read_file','list','glob','search','write','edit','mkdir','move','delete']:['read','write','edit','delete','list']);
  const selected=$derived((candidates??[]).filter(r=>!excluded.includes(r.id)).map(rule=>({...rule,policy:rule.policy.kind==='semantic'?{...rule.policy,overrides:overridesFor(rule)}:rule.policy})));
  const selectedRemovals=$derived(removals.filter(r=>!excludedRemovals.includes(r.id)));
  const selectedCount=$derived(selected.length+selectedRemovals.length);
  const canSave=$derived(mode==='explicit'?resourceType==='filesystem'&&!!path.trim():selectedCount>0);
  const effectName=(value:string)=>effects.find(([key])=>key===value)?.[1]??value;
  const asRule=(rule:PermissionView):SavePermission=>({id:rule.id,category:rule.category,effect:rule.effect,policy:rule.policy});
  function title(policy:PermissionPolicy){
    if(policy.kind!=='explicit'||policy.resource.type!=='filesystem')return policyText(policy);
    return `${permissionVerbNames[policy.verb]} ${filesystemResourceText(policy.resource).replace(/(?:\/\*\*)+$/,'').split('/').filter(Boolean).at(-1)??'/'}`;
  }
  function scopeText(policy:PermissionPolicy){return policy.kind==='explicit'&&policy.resource.type==='filesystem'?filesystemResourceText(policy.resource):'';}
  function invalidate(){candidates=null;removals=[];excluded=[];excludedRemovals=[];review=null;addingOverride=null;error='';notice='';removing=false;}
  function changeCandidate(index:number,patch:Partial<SavePermission>){candidates=candidates!.map((r,i)=>i===index?{...r,...patch}:r);review=null;error='';}
  function keepCandidate(ruleId:string,keep:boolean){excluded=keep?excluded.filter(id=>id!==ruleId):[...excluded,ruleId];review=null;error='';addingOverride=null;}
  function keepRemoval(ruleId:string,keep:boolean){excludedRemovals=keep?excludedRemovals.filter(id=>id!==ruleId):[...excludedRemovals,ruleId];review=null;error='';}
  function broaderRule(ruleId:string){return candidates?.find(r=>r.id===ruleId&&!excluded.includes(r.id))??rules.find(r=>r.id===ruleId);}
  function previousOverrides(rule:PermissionView){return rule.policy.kind==='semantic'?rule.policy.overrides.map(id=>rules.find(r=>r.id===id)).filter((r):r is PermissionView=>!!r).map(r=>`${policyText(r.policy)} (${effectName(r.effect)})`).join(', '):'';}
  function transferredOverrides(removal:PermissionRemoval){return rules.filter(r=>r.id!==removal.id&&r.policy.kind==='semantic'&&r.policy.overrides.includes(removal.id));}
  function overridesFor(rule:SavePermission){
    if(rule.policy.kind!=='semantic')return [];
    const omitted=new Set((candidates??[]).filter(r=>excluded.includes(r.id)&&!rules.some(saved=>saved.id===r.id)).map(r=>r.id));
    return [...new Set(rule.policy.overrides.filter(id=>!omitted.has(id)).map(id=>selectedRemovals.find(r=>r.id===id)?.replacementId??id).filter(id=>!selectedRemovals.some(r=>r.id===id)))];
  }
  function availableOverrides(rule:SavePermission){return [...new Map([...rules,...(candidates??[]).filter(r=>!excluded.includes(r.id))].map(r=>[r.id,r])).values()].filter(r=>!selectedRemovals.some(removed=>removed.id===r.id)&&r.id!==rule.id&&!overridesFor(rule).includes(r.id)&&policyText(r.policy).toLowerCase().includes(overrideSearch.toLowerCase()));}
  function changeOverride(index:number,target:string,enabled:boolean){const rule=candidates![index];if(rule.policy.kind!=='semantic')return;changeCandidate(index,{policy:{...rule.policy,overrides:enabled?[...new Set([...rule.policy.overrides,target])]:rule.policy.overrides.filter(id=>id!==target)}});}
  async function load(){rules=await api<PermissionView[]>('permissions');}
  onMount(()=>{void load().then(()=>{if(initialRule)edit(initialRule);}).catch(e=>error=e.message).finally(()=>loading=false);});
  $effect(()=>onDraftChange?.(draft));
  export function discardDraft(){if(busy)return;draft=false;review=null;candidates=null;removals=[];}
  export async function saveBeforeLeaving(){return save();}
  function edit(rule?:SavePermission){
    id=rule?.id??crypto.randomUUID();category=rule?.category??category;ruleEffect=rule?.effect??'ask';text=rule?policyText(rule.policy):'';
    mode=rule?.policy.kind==='explicit'&&rule.policy.resource.type==='filesystem'?'explicit':'describe';resourceType='filesystem';
    if(rule?.policy.kind==='explicit'&&rule.policy.resource.type==='filesystem'){
      verb=rule.policy.verb;path=filesystemResourceText(rule.policy.resource);
    }else{verb='read';path='';}
    candidates=rule&&mode==='describe'?[rule]:null;removals=[];excluded=[];excludedRemovals=[];addingOverride=null;overrideSearch='';review=null;dropped=[];removing=false;error='';notice='';draft=true;
    void tick().then(()=>mode==='describe'?descriptionInput?.focus():pathInput?.focus());
  }
  function categoryKey(event:KeyboardEvent,value:PermissionView['category']){
    if(draft||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
    const index=categories.findIndex(([key])=>key===value);category=categories[event.key==='Home'?0:event.key==='End'?categories.length-1:(index+(event.key==='ArrowRight'?1:-1)+categories.length)%categories.length][0];notice='';document.getElementById(`permission-${category}`)?.focus();
  }
  async function jump(ruleId:string){const rule=rules.find(r=>r.id===ruleId);if(!rule)return;category=rule.category;await tick();const row=document.getElementById(`permission-row-${ruleId}`);row?.focus();row?.scrollIntoView({block:'nearest'});}
  async function explicitRule():Promise<SavePermission>{
    if(resourceType!=='filesystem')throw new Error('Connect an account before adding a connection permission.');
    const previous=existing?.policy.kind==='explicit'&&existing.policy.resource.type==='filesystem'?existing.policy.resource:undefined;
    const resource=previous&&path===filesystemResourceText(previous)?previous:await api<Extract<PermissionPolicy,{kind:'explicit'}>['resource']>('permissions/filesystem-resource',{path});
    return {id,category,effect:ruleEffect,policy:{kind:'explicit',verb,resource}};
  }
  function relationshipUpdates(){return incoming.filter(r=>dropped.includes(r.id)).map(rule=>({...asRule(rule),policy:rule.policy.kind==='semantic'?{...rule.policy,overrides:rule.policy.overrides.filter(target=>target!==id)}:rule.policy}));}
  async function prepareReview(){
    if(!candidates){
      if(mode==='explicit')candidates=[await explicitRule()];
      else if(existing&&text===policyText(existing.policy))candidates=[{...asRule(existing),effect:ruleEffect}];
      else{const value=await api<FormalizedPermissions>('permissions/formalize',{id:existing?id:undefined,text,category,effect:ruleEffect});candidates=value.rules;removals=value.removals??[];if(candidates.length===1)ruleEffect=candidates[0].effect;}
    }
    if(!candidates.length&&!removals.length){notice='These permissions are already saved.';review=null;return;}
    if(!selectedCount)throw new Error('Select at least one change to save.');
    review=await api<PermissionReview>('permissions/review',{rules:[...selected,...relationshipUpdates()],removeIds:selectedRemovals.map(r=>r.id),replacements:selectedRemovals.filter(r=>r.replacementId).map(r=>({id:r.id,replacementId:r.replacementId}))});
  }
  async function suggest(){
    if(busy)return;busy=true;error='';
    try{await prepareReview();}catch(e){review=null;error=(e as Error).message;}finally{busy=false;}
  }
  async function save(){
    if(busy)return false;if(!canSave||removing){error=removing?'Finish or cancel removing this permission first.':mode==='explicit'?'Choose a resource before saving.':candidates?'Select at least one permission to save.':'Suggest permissions before saving.';return false;}
    busy=true;error='';try{
      if(!review)await prepareReview();
      if(review!.affected.some(rule=>{const shown=rules.find(r=>r.id===rule.id);return !shown||shown.updatedAt!==rule.updatedAt;})){
        await load();review=null;error='Permissions changed. Check the updated overrides and save again.';return false;
      }
      const count=selectedCount;await api('permissions/commit',{rules:review!.rules,removeIds:review!.removeIds,reviewToken:review!.reviewToken});draft=false;await load();await onChanged();notice=count>1?'Permissions saved':'Permission saved';return true;}
    catch(e){error=(e as Error).message;review=null;return false;}finally{busy=false;}
  }
  async function setAccess(rule:PermissionView,value:PermissionView['effect']){
    const linked=(rule.policy.kind==='semantic'&&rule.policy.overrides.length)||rules.some(r=>r.policy.kind==='semantic'&&r.policy.overrides.includes(rule.id));
    if(linked){edit(asRule(rule));ruleEffect=value;if(candidates)changeCandidate(0,{effect:value});return;}
    busy=true;error='';notice='';try{await api('permissions',{...asRule(rule),effect:value});await load();await onChanged();notice='Access saved';}catch(e){error=(e as Error).message;}finally{busy=false;}
  }
  async function removalReview(){busy=true;error='';removing=true;review=null;try{review=await api<PermissionReview>('permissions/review',{rules:[],removeIds:[id]});}catch(e){error=(e as Error).message;}finally{busy=false;}}
  async function remove(){if(!review)return;busy=true;error='';try{await api('permissions/commit',{rules:review.rules,removeIds:review.removeIds,reviewToken:review.reviewToken});draft=false;await load();await onChanged();notice='Permission removed';}catch(e){error=(e as Error).message;review=null;}finally{busy=false;}}
</script>

<section class="permission-editor" aria-label="Permissions">
  <div class="category-row"><div class="tabs" role="tablist" aria-label="Permission categories">
    {#each categories as [value,label]}<button role="tab" id={`permission-${value}`} aria-controls="permission-category" disabled={draft||busy} aria-selected={category===value} tabindex={category===value?0:-1} onkeydown={event=>categoryKey(event,value)} onclick={()=>{category=value;notice='';}}>{label}</button>{/each}
  </div>{#if !draft}<button class="add" aria-label="New permission" title="New permission" disabled={busy||loading} onclick={()=>edit()}><Icon name="new" size={18}/></button>{/if}</div>
  <div role="tabpanel" id="permission-category" aria-labelledby={`permission-${category}`}>
    {#if draft}
      <form onsubmit={event=>{event.preventDefault();void save();}}>
        <h3>{existing?'Edit permission':'New permission'}</h3>
        <div class="modes" role="group" aria-label="Creation method"><button type="button" aria-pressed={mode==='describe'} disabled={busy} onclick={()=>{mode='describe';invalidate();}}>Describe</button><button type="button" aria-pressed={mode==='explicit'} disabled={busy} onclick={()=>{mode='explicit';invalidate();}}>Choose action</button></div>
        {#if mode==='describe'}
          <label for="permission-rule">{existing?.policy.kind==='semantic'?'Condition':'Describe a permission'}</label><textarea id="permission-rule" aria-label="Permission description" bind:this={descriptionInput} bind:value={text} oninput={invalidate} placeholder="Ask before sending work files outside my company" maxlength="4000" disabled={busy}></textarea>
        {:else}
          <div class="resource-fields">
            <div><label for="permission-resource-type">Resource Type</label><select id="permission-resource-type" bind:value={resourceType} disabled={busy} onchange={()=>{verb='read';invalidate();}}><option value="filesystem">Filesystem</option><option value="connection">Connections</option></select></div>
            <div><label for="permission-resource">Resource</label>{#if resourceType==='filesystem'}<input id="permission-resource" bind:this={pathInput} bind:value={path} oninput={invalidate} placeholder="/path/to/folder or **/*.key" disabled={busy}/>{:else}<select id="permission-resource" disabled><option>No connections available</option></select>{/if}</div>
            <div><label for="permission-verb">Action</label><select id="permission-verb" bind:value={verb} disabled={busy||resourceType==='connection'} onchange={invalidate}>{#each verbOptions as value}<option value={value}>{permissionVerbNames[value as keyof typeof permissionVerbNames]}</option>{/each}</select></div>
          </div>
          {#if resourceType==='filesystem'}<p class="path-hint">Folders include their contents. Use * for one name, ** for any depth. Add / for a folder that doesn’t exist yet.</p>{/if}
        {/if}
        {#if mode==='explicit'}<div class="access-row"><label for="permission-access">Access</label><select id="permission-access" bind:value={ruleEffect} disabled={busy} onchange={invalidate}>{#each effects as [value,label]}<option value={value}>{label}</option>{/each}</select></div>{/if}
        {#if incoming.length&&!removing}<fieldset class="incoming"><legend>Affected overrides</legend>{#each incoming as rule}<label class="check"><input type="checkbox" checked={!dropped.includes(rule.id)} disabled={busy} onchange={event=>{dropped=event.currentTarget.checked?dropped.filter(value=>value!==rule.id):[...dropped,rule.id];review=null;}}/><span>Keep the override from {policyText(rule.policy)}</span></label>{/each}</fieldset>{/if}
        {#if mode==='describe'}<button type="button" disabled={busy||!text.trim()} onclick={suggest}>{busy?'Preparing…':'Suggest permissions'}</button>{/if}

        {#if candidates&&candidates.length&&mode==='describe'&&!removing}<section class="suggestions" aria-label="Suggested permissions">
          {#each candidates as rule,index (rule.id)}{@const kept=!excluded.includes(rule.id)}{@const previous=rules.find(r=>r.id===rule.id)}
            <section class="proposed" class:addition={!previous} class:modification={!!previous} aria-label={`Suggested permission ${index+1}`}>
              <div class="proposal-heading">
                <label class="proposal-choice"><input type="checkbox" aria-label={`Keep suggested permission ${index+1}`} checked={kept} disabled={busy} onchange={event=>keepCandidate(rule.id,event.currentTarget.checked)}/><span class="proposal-text"><span class="operation"><Icon name={previous?'edit':'new'} size={12}/>{previous?'Change':'Add'}</span><span class="proposal-title">{policyText(rule.policy)}</span></span></label>
                <select aria-label="Access" value={rule.effect} disabled={busy||!kept} onchange={event=>changeCandidate(index,{effect:event.currentTarget.value as SavePermission['effect']})}>{#each effects as [value,label]}<option value={value}>{label}</option>{/each}</select>
              </div>
              <div class="suggestion-body">
                {#if previous}<div class="before-change" aria-label={`Previous permission ${index+1}`}>
                  {#if policyText(previous.policy)!==policyText(rule.policy)}<p>Previously: {policyText(previous.policy)}</p>{/if}
                  {#if previous.effect!==rule.effect}<p>{effectName(previous.effect)} → {effectName(rule.effect)}</p>{/if}
                  {#if JSON.stringify(previous.policy.kind==='semantic'?previous.policy.overrides:[])!==JSON.stringify(rule.policy.kind==='semantic'?rule.policy.overrides:[])}<p>Previous overrides: {previousOverrides(previous)||'None'}</p>{/if}
                </div>{/if}
                {#if rule.policy.kind==='semantic'}<div class="override-choices">
                  <div class="override-heading"><span>Overrides</span><button type="button" class="link" aria-label={`Add override for suggestion ${index+1}`} aria-expanded={addingOverride===rule.id} disabled={busy||!kept} onclick={()=>{addingOverride=addingOverride===rule.id?null:rule.id;overrideSearch='';}}>+ Add override</button></div>
                  {#if overridesFor(rule).length}<table class="chosen-overrides" aria-label={`Overrides for suggestion ${index+1}`}>
                    <thead><tr><th scope="col">Permission</th><th scope="col">Access</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead><tbody>
                    {#each overridesFor(rule) as broaderId}{@const broader=broaderRule(broaderId)}
                      <tr><td>{broader?policyText(broader.policy):'Unavailable permission'}</td><td>{broader?effectName(broader.effect):'—'}</td><td><button type="button" class="quiet remove-override" aria-label={`Remove override ${broader?policyText(broader.policy):'unavailable permission'} from suggestion ${index+1}`} disabled={busy||!kept} onclick={()=>changeOverride(index,broaderId,false)}>×</button></td></tr>
                    {/each}
                  </tbody></table>
                  {:else}<p class="no-overrides">None.</p>{/if}
                  {#if addingOverride===rule.id}<div class="override-picker">
                    <input aria-label={`Find override for suggestion ${index+1}`} placeholder="Find a permission…" bind:value={overrideSearch} disabled={busy}/>
                    <ul aria-label={`Available overrides for suggestion ${index+1}`}>
                      {#each availableOverrides(rule) as broader}<li><span>{policyText(broader.policy)}<span class="override-access"> · {effectName(broader.effect)}</span></span><button type="button" class="link" aria-label={`Add ${policyText(broader.policy)} (${effectName(broader.effect)}) as override for suggestion ${index+1}`} onclick={()=>{changeOverride(index,broader.id,true);addingOverride=null;overrideSearch='';}}>Add</button></li>{/each}
                    </ul>
                    {#if !availableOverrides(rule).length}<p class="no-overrides">No matching permissions.</p>{/if}
                  </div>{/if}
                </div>{/if}
              </div>
            </section>
          {/each}
        </section>{/if}
        {#if removals.length&&mode==='describe'&&!removing}<section class="suggested-removals" aria-label="Suggested removals">
          {#each removals as removal,index (removal.id)}{@const previous=rules.find(r=>r.id===removal.id)}{@const replacement=removal.replacementId?broaderRule(removal.replacementId):undefined}
            <section class="proposed removal" aria-label={`Suggested removal ${index+1}`}>
              <div class="proposal-heading"><label class="proposal-choice"><input type="checkbox" aria-label={`Keep suggested removal ${index+1}`} checked={!excludedRemovals.includes(removal.id)} disabled={busy} onchange={event=>keepRemoval(removal.id,event.currentTarget.checked)}/><span class="proposal-text"><span class="operation"><span class="operation-symbol" aria-hidden="true">−</span>Remove</span><span class="proposal-title">{previous?policyText(previous.policy):'Unavailable permission'}</span></span></label><span class="removed-access">{previous?effectName(previous.effect):'—'}</span></div>
              <div class="suggestion-body removal-impact"><p>{removal.reason}</p>{#if removal.replacementId}<p>Consolidate into {replacement?policyText(replacement.policy):'the selected replacement'}{replacement?` (${effectName(replacement.effect)})`:''}.</p>{/if}
                {#if transferredOverrides(removal).length}<ul>{#each transferredOverrides(removal) as dependent}<li>{removal.replacementId?'Transfer':'Remove'} the override from {policyText(dependent.policy)}.</li>{/each}</ul>{/if}
                {#if removal.replacementId&&previous&&previousOverrides(previous)}<p>Preserve its overrides: {previousOverrides(previous)}.</p>{/if}
              </div>
            </section>
          {/each}
        </section>{/if}
        {#if review&&!removing&&review.examples.length}<section class="review-outcomes" aria-label="Review outcomes"><h4>Example outcomes</h4><ul>{#each review.examples as example}<li>{example}</li>{/each}</ul></section>{/if}
        <div class="form-actions"><button class="primary" disabled={busy||!canSave||removing}>{mode==='describe'&&selectedCount!==1?'Save permissions':'Save permission'}</button><button type="button" class="quiet" disabled={busy} onclick={()=>draft=false}>Cancel</button>{#if mode==='describe'&&(candidates?.length||removals.length)}<span class="selection-count" role="status">{selectedCount} selected</span>{/if}</div>
        {#if existing}{#if removing}<section class="remove-confirm" aria-label="Remove permission"><p>Remove this permission? Future actions use the remaining permissions.</p>{#if review?.affected.length}<ul>{#each review.affected.filter(r=>r.id!==id) as rule}<li>Remove its override from {policyText(rule.policy)}</li>{/each}</ul>{/if}<button type="button" class="danger" disabled={busy||!review} onclick={remove}>Remove permission</button><button type="button" class="quiet" onclick={()=>{removing=false;review=null;}}>Keep permission</button></section>{:else}<button type="button" class="quiet danger" disabled={busy} onclick={removalReview}>Remove permission…</button>{/if}{/if}
      </form>
    {:else if loading}<p class="empty">Loading permissions…</p>
    {:else if rules.some(rule=>rule.category===category)}<ul class="permission-list" aria-label="Saved permissions">{#each rules.filter(rule=>rule.category===category) as rule (rule.id)}<li class="permission-row" id={`permission-row-${rule.id}`} tabindex="-1"><div class="rule-details"><div class="name-line"><span class="rule-title">{title(rule.policy)}</span><button class="edit quiet" aria-label={`Edit ${title(rule.policy)}`} title="Edit permission" disabled={busy} onclick={()=>edit(asRule(rule))}><Icon name="edit" size={15}/></button></div>{#if scopeText(rule.policy)}<span class="scope">{scopeText(rule.policy)}</span>{/if}{#if rule.policy.kind==='semantic'&&rule.policy.overrides.length}<div class="override-links"><span>Overrides:</span>{#each rule.policy.overrides as broaderId}{@const broader=rules.find(r=>r.id===broaderId)}{#if broader}<button class="link" onclick={()=>jump(broaderId)}>{policyText(broader.policy)} · {effectName(broader.effect)}</button>{/if}{/each}</div>{/if}</div><select aria-label={`Access for ${title(rule.policy)}`} value={rule.effect} disabled={busy} onchange={event=>{const value=event.currentTarget.value as PermissionView['effect'];event.currentTarget.value=rule.effect;void setAccess(rule,value);}}>{#each effects as [value,label]}<option value={value}>{label}</option>{/each}</select></li>{/each}</ul>
    {:else}<p class="empty">No permissions in this category.</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}{#if notice}<p class="notice" role="status">{notice}</p>{/if}
  </div>
</section>

<style>
  .permission-editor{color:#495741;min-width:0;width:100%;font-size:13px;overflow-wrap:anywhere}
  .category-row{display:flex;align-items:center;gap:12px;border-bottom:1px solid #d6dfcc;margin-bottom:8px}.tabs{display:flex;gap:20px;flex-wrap:wrap;flex:1;min-width:0}.tabs button{background:transparent;border:0;border-bottom:2px solid transparent;border-radius:0;padding:9px 0}.tabs button[aria-selected=true]{border-bottom-color:var(--accent);color:#39552b;font-weight:600}.add{display:flex;align-items:center;justify-content:center;border:0;background:transparent;width:30px;height:30px;padding:0;flex-shrink:0}
  button,select,textarea,input{font:inherit;color:inherit}button{border:1px solid #becdb3;background:#f6f8ef;padding:8px 11px;border-radius:5px;cursor:pointer}button:hover{background:#e6ecdf}button:disabled{opacity:.5;cursor:default}.quiet{border:0;background:transparent}.primary{background:#536f43;color:white;border-color:#536f43}.primary:hover{background:#425d32}.danger{color:#963d30}.link{border:0;background:transparent;padding:0;color:#486039;text-decoration:underline;text-align:left;white-space:normal;overflow-wrap:anywhere}
  .permission-list{list-style:none;padding:0;margin:0}.permission-row{display:flex;align-items:flex-start;gap:20px;border-bottom:1px solid #dfe5d6;padding:16px 0}.rule-details{flex:1;min-width:0}.name-line{display:flex;align-items:flex-start;gap:4px;min-width:0}.rule-title{line-height:1.6;font-weight:500;white-space:normal;overflow-wrap:anywhere;padding-top:3px}.scope{display:block;color:#65745b;font-size:11px;line-height:1.6;margin-top:4px}.edit{opacity:0;transition:opacity .12s;width:28px;height:28px;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:0}.permission-row:hover .edit,.permission-row:focus-within .edit{opacity:1}.permission-row>select{flex-shrink:0}.override-links{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:11px;line-height:1.6;margin-top:8px}.override-links>span{color:#65745b}
  select,input:not([type=checkbox]){padding:8px;border:1px solid #c7d1be;border-radius:5px;background:#fffefa;box-sizing:border-box;max-width:100%}select{width:90px}input:not([type=checkbox]){display:block;width:100%;margin:8px 0 16px}h3{font-size:16px;margin:20px 0}h4{font-size:12px;margin:16px 0 8px;font-weight:600}label,legend{font-size:12px;font-weight:500}.modes{display:flex;gap:4px;margin:0 0 20px}.modes button{border:0;background:transparent}.modes button[aria-pressed=true]{background:#e6ecdf;font-weight:600}textarea{display:block;width:100%;box-sizing:border-box;min-height:100px;resize:vertical;border:1px solid #bdcbb2;border-radius:5px;background:#fffefa;padding:10px;line-height:1.6;margin:8px 0 16px}.access-row{display:flex;align-items:center;gap:18px;margin:20px 0}.access-row select{width:110px}.form-actions{display:flex;gap:8px;margin:24px 0 12px}.check{display:flex;align-items:flex-start;gap:8px;line-height:1.6;font-weight:400;margin:8px 0}.check input{flex-shrink:0;margin-top:4px;accent-color:#536f43}fieldset{border:0;padding:0;margin:18px 0}
  .resource-fields{display:grid;grid-template-columns:minmax(105px,1fr) minmax(0,2.4fr) minmax(105px,1fr);gap:12px;margin:20px 0 8px}.resource-fields>div{min-width:0}.resource-fields select,.resource-fields input:not([type=checkbox]){display:block;width:100%;margin:8px 0 0}.path-hint{font-size:11px;color:#65745b;line-height:1.6;margin:8px 0 0}
  .suggestions{margin-top:24px}.proposed{--operation-ink:#2e663b;--operation-fill:#e4f0e2;padding:20px 0;border-top:1px solid #dfe5d6}.proposed.modification{--operation-ink:#805611;--operation-fill:#fff0cb}.proposed.removal{--operation-ink:#963d30;--operation-fill:#f8e2dc}.proposal-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.proposal-heading>select{flex-shrink:0}.proposal-choice{flex:1;min-width:0;display:flex;align-items:flex-start;gap:10px;line-height:1.6;font-size:13px;font-weight:500;padding-top:5px;cursor:pointer}.proposal-choice input{flex-shrink:0;margin:4px 0 0;accent-color:#536f43}.suggestion-body{margin-left:24px}.proposal-text{display:flex;flex-direction:column;gap:6px}.proposal-title{color:var(--operation-ink)}.operation{display:inline-flex;align-items:center;align-self:flex-start;gap:5px;padding:2px 6px;border-radius:3px;background:var(--operation-fill);color:var(--operation-ink);font-size:11px;font-weight:600;line-height:1.4}.operation-symbol{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;font-size:16px;line-height:1}.before-change,.removal-impact{font-size:12px;line-height:1.6;color:#65745b}.before-change p,.removal-impact p{margin:8px 0}.removal-impact ul{padding-left:18px;margin:8px 0}.removed-access{padding:5px 8px;color:#65745b;font-size:12px}.override-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;margin:16px 0 6px}.override-heading .link{text-decoration:none;font-size:11px;min-height:24px}.chosen-overrides{width:100%;table-layout:fixed;border-collapse:collapse;background:#f0f3e9;font-size:12px;line-height:1.6}.chosen-overrides th,.chosen-overrides td{text-align:left;vertical-align:top;padding:8px 12px;border-bottom:1px solid #d6dfcc}.chosen-overrides th{font-size:10px;font-weight:500;color:#65745b}.chosen-overrides th:nth-child(2){width:60px}.chosen-overrides th:last-child{width:24px}.chosen-overrides td:nth-child(2){color:#65745b}.chosen-overrides td:last-child{padding-left:0;padding-right:8px;text-align:right}.override-picker ul{list-style:none;padding:0;margin:0}.override-picker li{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;line-height:1.6;padding:6px 0}.override-picker li>span{min-width:0}.override-access{color:#65745b;font-size:11px}.remove-override{min-height:24px;min-width:24px;flex-shrink:0;padding:0 6px;font-size:18px;line-height:1.25}.no-overrides{font-size:11px;color:#65745b;line-height:1.6;margin:6px 0}.override-picker{margin-top:12px}.override-picker input:not([type=checkbox]){margin:0 0 6px}.override-picker ul{max-height:190px;overflow-y:auto;font-size:12px}.override-picker li{border-bottom:1px solid #e1e7d9}.override-picker li .link{min-height:24px;font-size:11px;flex-shrink:0;margin-top:2px}.selection-count{align-self:center;font-size:11px;color:#65745b;margin-left:auto}.review-outcomes ul,.remove-confirm ul{padding-left:18px;line-height:1.6;font-size:12px}.review-outcomes li{margin:6px 0}.remove-confirm{border-top:1px solid #dfe5d6;margin-top:24px;padding-top:8px;font-size:12px}.remove-confirm button{margin-right:8px}.error{color:#963d30;line-height:1.5}.notice,.empty{font-size:12px;color:#65745b;margin-top:20px}
  .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
  @media(max-width:760px){.tabs{gap:16px}.permission-row{gap:12px}.proposal-heading{gap:12px}.form-actions{flex-wrap:wrap}}@media(hover:none){.edit{opacity:1}}@media(prefers-reduced-motion:reduce){.edit{transition:none}}
</style>
