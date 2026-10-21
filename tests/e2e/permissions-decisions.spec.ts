import { test,expect } from '../support/fixtures.ts';
import { ServerConfig } from '../../packages/shared/src/index.ts';
import { runtime } from '../../scripts/dev/lifecycle.ts';
import { json } from '../../scripts/dev/io.ts';
import { join } from 'node:path';
import { connectProduct } from '../../packages/server/src/platform/db/client.ts';
import { crmPermissionPrompt } from '../fixtures/permission-authoring.ts';

test('permissions-suggestions-desktop: Select suggestions, edit individual access and manage suggested override lists',async({ash,instance})=>{
  const {page}=ash,cfg=ServerConfig.parse(await json(join(instance.root,'server.json'))),running=await runtime(instance);
  const request=async(path:string,body?:unknown)=>fetch(`${running!.serverUrl}/api/${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${cfg.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const initial=await(await request('permissions')).json() as any[],send=initial.find(r=>r.policy.resource?.type==='messages'),batches:any[][]=[],missing=crypto.randomUUID();
  await page.route('**/api/permissions/formalize',async route=>{
    const broad=send.id,rules=[
      {id:broad,category:'interaction',effect:'deny',policy:{kind:'semantic',condition:'Send messages',examples:[],overrides:[]}},
      {id:batches[0]?.[1].id??crypto.randomUUID(),category:'interaction',effect:'allow',policy:{kind:'semantic',condition:'Send messages to John Smith (john@example.com)',examples:[],overrides:[...new Set([broad,send.id,...(batches.length?[]:[missing])])]}},
      {id:crypto.randomUUID(),category:'interaction',effect:'ask',policy:{kind:'semantic',condition:'Publish reviewed research notes',examples:[],overrides:[]}},
    ];batches.push(rules);await route.fulfill({json:{rules,suggestion:null,clarification:null}});
  });
  await page.getByRole('button',{name:'Settings',exact:true}).click();const settings=page.getByRole('dialog',{name:'Settings'});await settings.getByRole('tab',{name:'Permissions',exact:true}).click();const permissions=settings.getByRole('region',{name:'Permissions',exact:true});await permissions.getByRole('tab',{name:'Interaction',exact:true}).click();
  const generate=async()=>{await permissions.getByRole('button',{name:'New permission',exact:true}).click();await expect(permissions.getByLabel('Access',{exact:true})).toHaveCount(0);await permissions.getByLabel('Permission description',{exact:true}).fill('Never send messages except to John Smith; ask before publishing reviewed research notes.');await permissions.getByRole('button',{name:'Suggest permissions',exact:true}).click();await expect(permissions.getByRole('button',{name:'Save permissions',exact:true})).toBeEnabled();};
  await generate();const first=permissions.getByRole('region',{name:'Suggested permission 1',exact:true}),john=permissions.getByRole('region',{name:'Suggested permission 2',exact:true}),third=permissions.getByRole('region',{name:'Suggested permission 3',exact:true});
  await expect(permissions.getByLabel('Category',{exact:true})).toHaveCount(0);await expect(permissions.getByText('Access',{exact:true})).toHaveCount(1); // Only the override table has a visible Access heading.
  await expect(permissions.getByText('For matching actions',{exact:false})).toHaveCount(0);
  await expect(john.getByRole('table',{name:'Overrides for suggestion 2'}).getByRole('columnheader',{name:'Permission',exact:true})).toBeVisible();
  const overrideRow=john.getByRole('table',{name:'Overrides for suggestion 2'}).locator('tbody tr').filter({has:page.getByRole('cell',{name:'Never',exact:true})});
  await expect(overrideRow.getByRole('cell',{name:'Send messages',exact:true})).toBeVisible();
  await expect(john.getByRole('table',{name:'Overrides for suggestion 2'}).locator('tbody tr')).toHaveCount(2);await expect(permissions.getByRole('alert')).toContainText('distinct active');await expect.poll(()=>ash.errors.some(e=>e.includes('status of 422'))).toBe(true);ash.errors.splice(ash.errors.findIndex(e=>e.includes('status of 422')),1);await john.getByRole('button',{name:'Remove override unavailable permission from suggestion 2',exact:true}).click();
  for(const n of [1,2,3])await permissions.getByRole('checkbox',{name:`Keep suggested permission ${n}`,exact:true}).uncheck();
  await expect(permissions.getByRole('button',{name:'Save permissions',exact:true})).toBeDisabled();await expect(first.getByLabel('Access',{exact:true})).toBeDisabled();
  await permissions.getByRole('checkbox',{name:'Keep suggested permission 1',exact:true}).check();await expect(first.getByLabel('Access',{exact:true})).toHaveValue('deny');await permissions.getByRole('checkbox',{name:'Keep suggested permission 1',exact:true}).uncheck();await permissions.getByRole('checkbox',{name:'Keep suggested permission 2',exact:true}).check();
  await expect(john.getByRole('table',{name:'Overrides for suggestion 2'}).locator('tbody tr')).toHaveCount(1);await john.getByLabel('Access',{exact:true}).selectOption('ask');
  await john.getByRole('button',{name:'Remove override Send messages from suggestion 2',exact:true}).click();await expect(john.getByRole('table',{name:'Overrides for suggestion 2'})).toHaveCount(0);
  await john.getByRole('button',{name:'Add override for suggestion 2',exact:true}).click();await john.getByLabel('Find override for suggestion 2').fill('Send messages');await john.getByRole('button',{name:'Add Send messages (Ask) as override for suggestion 2',exact:true}).click();
  for(const width of [1400,1040,740]){
    await ash.app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,980),width);
    const modal=await settings.boundingBox(),heading=await john.locator('.proposal-heading').boundingBox(),choice=await john.locator('.proposal-choice').boundingBox(),access=await john.getByLabel('Access',{exact:true}).boundingBox();
    expect(modal!.width).toBeGreaterThan(Math.min(width-60,1050));expect(modal!.height).toBeGreaterThan(850);
    expect(access!.y).toBeCloseTo(heading!.y,0);expect(access!.x).toBeGreaterThan(choice!.x+choice!.width);expect(access!.x+access!.width).toBeCloseTo(heading!.x+heading!.width,0);
    expect(await settings.locator('.body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  }
  await ash.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(740,640));expect((await settings.boundingBox())!.height).toBeLessThan(640);expect(await settings.locator('.body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  let saved=await(await request('permissions')).json() as any[];expect(saved.some(r=>r.id!==send.id&&batches[0].some(candidate=>candidate.id===r.id))).toBe(false);
  // A concurrent broader-rule edit must be shown before any selected proposal is committed.
  expect((await request('permissions',{id:send.id,category:send.category,effect:'deny',policy:send.policy})).status).toBe(200);
  await permissions.getByRole('button',{name:'Save permission',exact:true}).click();await expect(permissions.getByRole('alert')).toContainText('Check the updated overrides');await expect(john.getByRole('table',{name:'Overrides for suggestion 2'})).toContainText('Never');
  saved=await(await request('permissions')).json() as any[];expect(saved.some(r=>r.id===batches[0][1].id)).toBe(false);
  await permissions.getByRole('button',{name:'Save permission',exact:true}).click();await expect(permissions.getByRole('status')).toHaveText('Permission saved');
  saved=await(await request('permissions')).json() as any[];const kept=saved.find(r=>r.id===batches[0][1].id);expect(kept.effect).toBe('ask');expect(kept.policy.overrides).toEqual([send.id]);expect(saved.find(r=>r.id===send.id).effect).toBe('deny');expect(saved.some(r=>r.id===batches[0][2].id)).toBe(false);
  // Multiple selected suggestions save as one batch with their individual Access settings.
  await generate();await permissions.getByRole('checkbox',{name:'Keep suggested permission 2',exact:true}).uncheck();await first.getByLabel('Access',{exact:true}).selectOption('ask');await third.getByLabel('Access',{exact:true}).selectOption('deny');await permissions.getByRole('button',{name:'Save permissions',exact:true}).click();await expect(permissions.getByRole('status')).toHaveText('Permissions saved');
  saved=await(await request('permissions')).json() as any[];expect(saved.find(r=>r.id===batches[1][0].id).effect).toBe('ask');expect(saved.find(r=>r.id===batches[1][2].id).effect).toBe('deny');expect(saved.find(r=>r.id===batches[1][1].id)).toEqual(kept);
  await settings.getByRole('button',{name:'Close Settings'}).click();await page.reload();
});

test('permissions-changes-desktop: Review selected changes and duplicate removals together',async({ash,instance},testInfo)=>{
  const {page}=ash,cfg=ServerConfig.parse(await json(join(instance.root,'server.json'))),running=await runtime(instance);
  const request=async(path:string,body?:unknown)=>fetch(`${running!.serverUrl}/api/${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${cfg.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const initial=await(await request('permissions')).json() as any[],send=initial.find(p=>p.policy.resource?.type==='messages');
  const duplicate=crypto.randomUUID(),dependent=crypto.randomUUID(),friends=crypto.randomUUID(),named=crypto.randomUUID();
  // Synthetic historical permissions exercise consolidation of already-saved data.
  const db=connectProduct(cfg.databaseUrl);
  try{await db.permission.createMany({data:[
    {id:duplicate,category:'interaction',effect:'deny',createdAt:new Date(),updatedAt:new Date(),policy:{kind:'semantic',condition:'Send messages to any recipient',examples:[],overrides:[]}},
    {id:dependent,category:'interaction',effect:'allow',createdAt:new Date(),updatedAt:new Date(),policy:{kind:'semantic',condition:'Send messages to Casey Example (casey@example.com)',examples:[],overrides:[duplicate]}},
  ]});}finally{await db.$disconnect();}
  let removalOnly=false;
  await page.route('**/api/permissions/formalize',async route=>{await route.fulfill({json:{rules:removalOnly?[]:[
    {id:send.id,category:send.category,effect:'deny',policy:send.policy},
    {id:friends,category:'interaction',effect:'ask',policy:{kind:'semantic',condition:'Send messages to recipients marked as friends in my CRM',examples:[],overrides:[send.id]}},
    {id:named,category:'interaction',effect:'allow',policy:{kind:'semantic',condition:'Send messages to John Example (john@example.com) or Amy Example (amy@example.com)',examples:[],overrides:[friends,send.id]}},
  ],removals:removalOnly?[{id:named,reason:'Remove the named-recipient exception; remaining permissions apply.'}]:[{id:duplicate,replacementId:send.id,reason:'This repeats the general messaging permission.'}],clarification:null}});});
  await page.getByRole('button',{name:'Settings',exact:true}).click();const settings=page.getByRole('dialog',{name:'Settings'});await settings.getByRole('tab',{name:'Permissions',exact:true}).click();const permissions=settings.getByRole('region',{name:'Permissions',exact:true});await permissions.getByRole('tab',{name:'Interaction',exact:true}).click();
  const suggest=async(text:string)=>{await permissions.getByRole('button',{name:'New permission',exact:true}).click();await permissions.getByLabel('Permission description',{exact:true}).fill(text);await permissions.getByRole('button',{name:'Suggest permissions',exact:true}).click();};
  await suggest(crmPermissionPrompt);
  const baseline=permissions.getByRole('region',{name:'Suggested permission 1',exact:true}),removal=permissions.getByRole('region',{name:'Suggested removal 1',exact:true});
  await expect(baseline).toContainText('Change');await expect(baseline).toContainText('Ask → Never');await expect(removal).toContainText('Remove');await expect(removal).toContainText('Transfer the override from Send messages to Casey');
  for(const index of [1,2,3])await expect(permissions.getByRole('checkbox',{name:`Keep suggested permission ${index}`,exact:true})).toBeChecked();await expect(removal.getByRole('checkbox')).toBeChecked();
  await expect(permissions.getByRole('status')).toHaveText('4 selected');await expect(permissions.getByRole('alert')).toHaveCount(0);
  // Deselecting a consolidation cannot save an equivalent conflicting baseline.
  await removal.getByRole('checkbox').uncheck();await permissions.getByRole('button',{name:'Save permissions',exact:true}).click();await expect(permissions.getByRole('alert')).toContainText('same scope');
  await expect.poll(()=>ash.errors.some(e=>e.includes('status of 422'))).toBe(true);ash.errors.splice(ash.errors.findIndex(e=>e.includes('status of 422')),1);
  let saved=await(await request('permissions')).json() as any[];expect(saved.find(p=>p.id===send.id).effect).toBe('ask');expect(saved.some(p=>p.id===duplicate)).toBe(true);expect(saved.some(p=>p.id===named||p.id===friends)).toBe(false);
  await removal.getByRole('checkbox').check();for(const index of [1,2,3])await permissions.getByRole('checkbox',{name:`Keep suggested permission ${index}`,exact:true}).uncheck();await removal.getByRole('checkbox').uncheck();await expect(permissions.getByRole('button',{name:'Save permissions',exact:true})).toBeDisabled();
  for(const index of [1,2,3])await permissions.getByRole('checkbox',{name:`Keep suggested permission ${index}`,exact:true}).check();await removal.getByRole('checkbox').check();
  for(const width of [1040,740]){await ash.app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);expect(await settings.locator('.body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);}
  await removal.scrollIntoViewIfNeeded();await testInfo.attach('permission-change-set',{body:await page.screenshot({path:testInfo.outputPath('change-set.png')}),contentType:'image/png'});
  await permissions.getByRole('button',{name:'Save permissions',exact:true}).click();await expect(permissions.getByRole('status')).toHaveText('Permissions saved');
  saved=await(await request('permissions')).json() as any[];expect(saved.find(p=>p.id===send.id).effect).toBe('deny');expect(saved.some(p=>p.id===duplicate)).toBe(false);expect(saved.find(p=>p.id===dependent).policy.overrides).toEqual([send.id]);expect(saved.find(p=>p.id===named).policy.overrides.sort()).toEqual([friends,send.id].sort());
  // A removal-only change set has no Access input and stays reversibly selectable.
  removalOnly=true;await suggest('Remove the John and Amy permission');await expect(removal.getByRole('checkbox')).toBeChecked();await expect(permissions.getByLabel('Access',{exact:true})).toHaveCount(0);await expect(permissions.getByRole('button',{name:'Save permission',exact:true})).toBeEnabled();
  await removal.getByRole('checkbox').uncheck();await expect(permissions.getByRole('button',{name:'Save permissions',exact:true})).toBeDisabled();await removal.getByRole('checkbox').check();await permissions.getByRole('button',{name:'Save permission',exact:true}).click();await expect(permissions.getByRole('status')).toHaveText('Permission saved');
  saved=await(await request('permissions')).json() as any[];expect(saved.some(p=>p.id===named)).toBe(false);expect(saved.some(p=>p.id===friends)).toBe(true);
  expect(await ash.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()&&!w.isFocusable()))).toBe(true);
});

test('permissions-crm-desktop: A named recipient group overrides CRM friends and retains the saved Never baseline',async({ash,instance},testInfo)=>{
  const {page}=ash,cfg=ServerConfig.parse(await json(join(instance.root,'server.json'))),running=await runtime(instance);
  const request=async(path:string,body?:unknown)=>fetch(`${running!.serverUrl}/api/${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${cfg.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const initial=await(await request('permissions')).json() as any[],send=initial.find(p=>p.policy.resource?.type==='messages');expect((await request('permissions',{id:send.id,category:send.category,effect:'deny',policy:send.policy})).status).toBe(200);
  const baseline=(await(await request('permissions')).json() as any[]).find(p=>p.id===send.id),friends=crypto.randomUUID(),named=crypto.randomUUID();let repeated=false;
  await page.route('**/api/permissions/formalize',async route=>{expect(route.request().postDataJSON().text).toBe(crmPermissionPrompt);await route.fulfill({json:{rules:repeated?[]:[
    {id:friends,category:'interaction',effect:'ask',policy:{kind:'semantic',condition:'Send messages to recipients marked as friends in my CRM',examples:[],overrides:[send.id]}},
    {id:named,category:'interaction',effect:'allow',policy:{kind:'semantic',condition:'Send messages to John Example (john@example.com) or Amy Example (amy@example.com)',examples:[],overrides:[friends,send.id]}},
  ],clarification:null}});});
  await page.getByRole('button',{name:'Settings',exact:true}).click();const settings=page.getByRole('dialog',{name:'Settings'});await settings.getByRole('tab',{name:'Permissions',exact:true}).click();const permissions=settings.getByRole('region',{name:'Permissions',exact:true});await permissions.getByRole('tab',{name:'Interaction',exact:true}).click();
  const suggest=async()=>{await permissions.getByRole('button',{name:'New permission',exact:true}).click();await permissions.getByLabel('Permission description',{exact:true}).fill(crmPermissionPrompt);await permissions.getByRole('button',{name:'Suggest permissions',exact:true}).click();};
  await suggest();await expect(permissions.getByRole('button',{name:'Save permissions',exact:true})).toBeEnabled();await expect(permissions.getByRole('region',{name:/^Suggested permission [0-9]+$/})).toHaveCount(2);
  const selected=permissions.getByRole('region',{name:'Suggested permission 2',exact:true});await expect(selected.getByRole('table',{name:'Overrides for suggestion 2'}).locator('tbody tr')).toHaveCount(2);await expect(selected).toContainText('friends in my CRM');await expect(selected.getByLabel('Access',{exact:true})).toHaveValue('allow');
  await expect(permissions.getByText('Suggested wording',{exact:true})).toHaveCount(0);await expect(permissions.getByRole('button',{name:'Suggest rules',exact:true})).toHaveCount(0);await expect(permissions.getByRole('alert')).toHaveCount(0);
  await selected.scrollIntoViewIfNeeded();await testInfo.attach('crm-permission-suggestions',{body:await page.screenshot(),contentType:'image/png'});
  await permissions.getByRole('button',{name:'Save permissions',exact:true}).click();await expect(permissions.getByRole('status')).toHaveText('Permissions saved');
  let saved=await(await request('permissions')).json() as any[];expect(saved).toHaveLength(initial.length+2);expect(saved.find(p=>p.id===send.id)).toEqual(baseline);expect(new Set(saved.find(p=>p.id===named).policy.overrides)).toEqual(new Set([friends,send.id]));
  repeated=true;await suggest();await expect(permissions.getByRole('status')).toHaveText('These permissions are already saved.');await expect(permissions.getByRole('button',{name:'Save permissions',exact:true})).toBeDisabled();await expect(permissions.getByRole('alert')).toHaveCount(0);
  await permissions.getByRole('button',{name:'Cancel',exact:true}).click();await settings.getByRole('button',{name:'Close Settings',exact:true}).click();
});

test('permissions-form-desktop: Known resource types, inferred paths and direct saves use a compact form',async({ash,instance})=>{
  const {page}=ash;await page.getByRole('button',{name:'Settings',exact:true}).click();const settings=page.getByRole('dialog',{name:'Settings'});await settings.getByRole('tab',{name:'Permissions',exact:true}).click();const permissions=settings.getByRole('region',{name:'Permissions',exact:true});
  await expect(permissions.getByText('Read passwords, API tokens, private keys, recovery codes, or other secret values.',{exact:true})).toBeVisible();
  await permissions.getByRole('button',{name:'New permission',exact:true}).click();await permissions.getByRole('button',{name:'Choose action',exact:true}).click();
  const type=permissions.getByLabel('Resource Type',{exact:true}),resource=permissions.getByLabel('Resource',{exact:true}),action=permissions.getByLabel('Action',{exact:true}),access=permissions.getByLabel('Access',{exact:true});
  await expect(type.locator('option')).toHaveText(['Filesystem','Connections']);await expect(permissions.getByLabel('Scope',{exact:true})).toHaveCount(0);await expect(permissions.getByLabel('Name pattern',{exact:true})).toHaveCount(0);await expect(permissions.getByRole('button',{name:'Review interpretation',exact:true})).toHaveCount(0);
  for(const width of [1040,740]){
    await ash.app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,650),width);
    const boxes=await Promise.all([type,resource,action,access].map(field=>field.boundingBox()));expect(new Set(boxes.slice(0,3).map(box=>Math.round(box!.y))).size).toBe(1);expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y+boxes[0]!.height);expect(await settings.locator('.body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  }
  await type.selectOption('connection');await expect(resource).toHaveText('No connections available');await expect(permissions.getByRole('button',{name:'Save permission',exact:true})).toBeDisabled();await type.selectOption('filesystem');
  await resource.fill('/example/**/*.txt');await access.selectOption('deny');await permissions.getByRole('button',{name:'Save permission',exact:true}).click();await expect(permissions.getByRole('status')).toHaveText('Permission saved');
  const row=permissions.getByRole('listitem').filter({hasText:'/example/**/*.txt'});await expect(row.getByRole('combobox')).toHaveValue('deny');await row.getByRole('button',{name:/^Edit /}).click();await expect(resource).toHaveValue('/example/**/*.txt');
  await resource.fill('/example/generated*/**');await permissions.getByRole('button',{name:'Save permission',exact:true}).click();await expect(permissions.getByRole('status')).toHaveText('Permission saved');await permissions.getByRole('button',{name:'Edit Read generated*',exact:true}).click();
  await resource.fill(join(process.cwd(),'specs'));await permissions.getByRole('button',{name:'Save permission',exact:true}).click();await expect(permissions.getByRole('status')).toHaveText('Permission saved');
  const folder=permissions.getByRole('listitem').filter({hasText:join(process.cwd(),'specs')+'/'});await folder.getByRole('button',{name:/^Edit /}).click();await resource.fill(join(process.cwd(),'package.json'));await permissions.getByRole('button',{name:'Save permission',exact:true}).click();await expect(permissions.getByRole('status')).toHaveText('Permission saved');
  const cfg=ServerConfig.parse(await json(join(instance.root,'server.json'))),running=await runtime(instance),saved=await(await fetch(`${running!.serverUrl}/api/permissions`,{headers:{authorization:`Bearer ${cfg.token}`}})).json() as any[];
  expect(saved.find(r=>r.policy.resource?.path===join(process.cwd(),'package.json')).policy.resource.scope).toBe('file');
  await permissions.getByRole('button',{name:'New permission',exact:true}).click();await permissions.getByLabel('Permission description',{exact:true}).fill('Allow read public release notes only after publication');await permissions.getByRole('button',{name:'Suggest permissions',exact:true}).click();await expect(permissions.getByRole('button',{name:'Save permission',exact:true})).toBeEnabled();await access.selectOption('deny');await permissions.getByRole('button',{name:'Save permission',exact:true}).click();await expect(permissions.getByRole('listitem').filter({hasText:'Read public release notes only after publication'}).getByRole('combobox')).toHaveValue('deny');
  await settings.getByRole('button',{name:'Close Settings'}).click();await page.reload();
});

test('permissions-decisions-desktop: Full-page Decisions and tabbed Settings preserve work and drafts',async({ash,instance})=>{
  const {page}=ash,message=page.getByLabel('Message',{exact:true});
  await ash.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(740,650));
  const scope='/example/'+ 'long-folder-name'.repeat(8);
  await message.fill('Ask me which folder to use?');await message.press('Enter');
  await expect(page.getByTestId('run-status')).toHaveText('waiting');
  await expect(page.getByRole('button',{name:'Retry response',exact:true})).toHaveCount(0);
  await message.fill('A separate conversation');await message.press('Enter');
  await expect(page.getByTestId('run-status').filter({hasText:'completed'})).toHaveCount(1);
  await message.fill('My preserved chat draft');
  await page.getByRole('button',{name:/^Decisions/}).click();const panel=page.getByRole('main',{name:'Decisions',exact:true});
  await expect(panel).toBeVisible();await expect(message).toBeHidden();await expect(panel.getByRole('button',{name:'Back to chat'})).toBeFocused();
  await expect.poll(async()=>{const box=(await panel.boundingBox())!,sidebar=(await page.getByRole('complementary',{name:'Thread sidebar'}).boundingBox())!;return box.width+sidebar.width;}).toBe(740);
  await expect(panel.getByRole('button',{name:'Snooze 1 hour',exact:true})).toBeHidden();await expect(panel.getByLabel('Optional comment')).toBeHidden();await panel.getByRole('button',{name:'Snooze…',exact:true}).click();
  await panel.getByRole('button',{name:'Snooze 1 hour',exact:true}).click();
  await panel.getByRole('tab',{name:'Snoozed',exact:true}).click();await expect(panel.getByTestId('decision-card')).toHaveCount(1);
  await panel.getByRole('button',{name:'Wake now',exact:true}).click();await panel.getByRole('tab',{name:'Pending',exact:true}).click();
  await panel.getByLabel('Answer',{exact:true}).fill('Folder B');await panel.getByRole('button',{name:'Submit answer',exact:true}).click();
  await panel.getByRole('tab',{name:'History',exact:true}).click();await expect(panel.getByText('Folder B',{exact:false})).toBeVisible();await expect(panel.getByText('Work: completed',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Submit answer'})).toHaveCount(0);
  await panel.getByRole('button',{name:'Back to chat'}).click();await expect(message).toHaveValue('My preserved chat draft');await expect(page.getByRole('button',{name:/^Decisions/})).toBeFocused();
  await page.reload();await expect(page.getByTestId('connection')).toContainText('Connected');await expect(message).toHaveValue('My preserved chat draft');
  await expect(page.getByRole('button',{name:'Permissions',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Settings',exact:true}).click();const settings=page.getByRole('dialog',{name:'Settings',exact:true});
  const instruction=settings.getByLabel('Instruction text');await instruction.fill('Unsaved instruction draft');await settings.getByRole('tab',{name:'Permissions',exact:true}).click();await expect(settings.getByRole('alert')).toContainText('instruction changes');await settings.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(instruction).toHaveValue('Unsaved instruction draft');
  await settings.getByRole('tab',{name:'Permissions',exact:true}).click();await settings.getByRole('button',{name:'Discard changes',exact:true}).click();
  const permissions=settings.getByRole('region',{name:'Permissions',exact:true});await expect(permissions).toBeVisible();const codePermission=permissions.getByRole('listitem').filter({has:page.getByText('Read ash',{exact:true})});await expect(codePermission).toBeVisible();await expect(codePermission.getByText('Read ash',{exact:true})).toBeVisible();
  await expect(permissions.getByRole('columnheader')).toHaveCount(0);await expect(permissions.getByText('Ask requires your approval. Never blocks the action.',{exact:true})).toHaveCount(0);await expect(permissions.getByText(/configured exclusions/)).toHaveCount(0);
  const add=permissions.getByRole('button',{name:'New permission',exact:true}),categories=permissions.getByRole('tablist',{name:'Permission categories'});const addBox=(await add.boundingBox())!,tabsBox=(await categories.boundingBox())!;expect(addBox.y).toBeGreaterThanOrEqual(tabsBox.y);expect(addBox.y+addBox.height).toBeLessThanOrEqual(tabsBox.y+tabsBox.height);await expect(add.locator('svg')).toHaveCount(1);
  const pencil=codePermission.getByRole('button',{name:'Edit Read ash',exact:true});await categories.hover();await expect(pencil).toHaveCSS('opacity','0');await codePermission.hover();await expect(pencil).toHaveCSS('opacity','1');await pencil.focus();await categories.hover();await expect(pencil).toHaveCSS('opacity','1');
  await permissions.getByRole('tab',{name:'Filesystem',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(permissions.getByRole('tab',{name:'Computer use'})).toHaveAttribute('aria-selected','true');await page.keyboard.press('Home');
  await permissions.getByRole('button',{name:'New permission',exact:true}).click();await permissions.getByLabel('Permission description',{exact:true}).fill(`Don't read from ${scope}`);await permissions.getByRole('button',{name:'Suggest permissions',exact:true}).click();
  await expect(permissions.getByLabel('Access',{exact:true})).toHaveValue('deny');await expect(permissions.getByRole('region',{name:'Suggested permissions'})).toContainText(scope);
  await settings.getByRole('tab',{name:'Instructions',exact:true}).click();await expect(settings.getByRole('alert')).toContainText('permission changes');await settings.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(permissions.getByLabel('Permission description',{exact:true})).toHaveValue(`Don't read from ${scope}`);
  await permissions.getByLabel('Permission description',{exact:true}).fill(`Don't read from ${scope} `);
  await settings.getByRole('tab',{name:'Instructions',exact:true}).click();await settings.getByRole('button',{name:'Save and continue',exact:true}).click();
  await expect(settings.getByRole('tab',{name:'Permissions',exact:true})).toHaveAttribute('aria-selected','true');await expect(permissions.getByRole('alert')).toContainText('Suggest permissions');await expect(permissions.getByLabel('Permission description',{exact:true})).toHaveValue(`Don't read from ${scope} `);
  await permissions.getByRole('button',{name:'Suggest permissions',exact:true}).click();await settings.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(instruction).toBeVisible();await settings.getByRole('tab',{name:'Permissions',exact:true}).click();
  const added=permissions.getByRole('listitem').filter({hasText:scope});await expect(added).toBeVisible();expect(await settings.locator('.body').evaluate(body=>body.scrollWidth<=body.clientWidth)).toBe(true);
  await added.getByRole('button',{name:/^Edit /}).click();await permissions.getByRole('button',{name:'Describe',exact:true}).click();await permissions.getByLabel('Permission description',{exact:true}).fill(`Ask before reading from ${scope}`);await permissions.getByRole('button',{name:'Suggest permissions',exact:true}).click();await expect(permissions.getByLabel('Access',{exact:true})).toHaveValue('ask');await permissions.getByRole('button',{name:'Save permission',exact:true}).click();
  const edited=permissions.getByRole('listitem').filter({hasText:scope});await edited.getByRole('button',{name:/^Edit /}).click();await permissions.getByRole('button',{name:'Remove permission…',exact:true}).click();await permissions.getByRole('button',{name:'Keep permission',exact:true}).click();await expect(permissions.getByLabel('Resource',{exact:true})).toHaveValue(scope);await permissions.getByRole('button',{name:'Remove permission…',exact:true}).click();await permissions.getByRole('button',{name:'Remove permission',exact:true}).click();await expect(edited).toHaveCount(0);
  await permissions.getByRole('tab',{name:'Computer use',exact:true}).click();const computer=permissions.getByRole('combobox',{name:'Access for Use computer',exact:true});await expect(computer).toHaveValue('allow');await computer.selectOption('deny');await expect(permissions.getByRole('status')).toHaveText('Access saved');await expect(computer).toHaveValue('deny');
  await permissions.getByRole('tab',{name:'Interaction',exact:true}).click();await expect(permissions.getByRole('listitem').filter({hasText:'Send messages'}).getByRole('combobox')).toHaveValue('ask');await expect(permissions.getByRole('listitem').filter({hasText:'Publish public content'}).getByRole('combobox')).toHaveValue('ask');await expect(permissions.getByText('Sending as the user.',{exact:true})).toHaveCount(0);await expect(permissions.getByText('Publishing as the user.',{exact:true})).toHaveCount(0);await expect(permissions.getByText('Advanced policy',{exact:true})).toHaveCount(0);
  await settings.getByRole('button',{name:'Close Settings'}).click();await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();await settings.getByRole('tab',{name:'Permissions',exact:true}).click();await permissions.getByRole('tab',{name:'Computer use',exact:true}).click();await expect(computer).toHaveValue('deny');await computer.selectOption('ask');await expect(computer).toHaveValue('ask');await computer.selectOption('allow');await expect(computer).toHaveValue('allow');await settings.getByRole('button',{name:'Close Settings'}).click();await expect(message).toHaveValue('My preserved chat draft');
  const cfg=ServerConfig.parse(await json(join(instance.root,'server.json'))),running=await runtime(instance);
  const create=await fetch(`${running!.serverUrl}/api/decisions`,{method:'POST',headers:{authorization:`Bearer ${cfg.token}`,'content-type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),request:{kind:'permission',form:'approval',question:'Approve the fixture action?',reason:'This action requires explicit controls.',action:{operation:'fixture.send',resources:[{kind:'contact',id:'alex@example.com',label:'Alex'}],effects:['send','publish']},arguments:{recipient:'alex@example.com',body:'The complete message to review.',subject:'alex@example.com'},binding:'fixture-only',options:[{id:'approve',label:'Approve this action'},{id:'decline',label:'Decline'}]}})});expect(create.status).toBe(200);
  await page.getByRole('button',{name:/^Decisions/}).click();await expect(panel.getByRole('region',{name:'Action to approve'})).toContainText('alex@example.com');await expect(panel.getByRole('region',{name:'Action to approve'})).toContainText('The complete message to review.');await expect(panel.getByRole('region',{name:'Action to approve'}).locator('dt').filter({hasText:'Subject'})).toBeVisible();await expect(panel.getByRole('region',{name:'Action to approve'}).locator('dd').filter({hasText:'alex@example.com'})).toHaveCount(1);await expect(panel.getByRole('region',{name:'Action to approve'})).toContainText('Publish public content');await panel.getByText('Add comment',{exact:true}).click();await panel.getByLabel('Optional comment',{exact:true}).fill('Checked recipient and message.');await panel.getByRole('button',{name:'Approve this action',exact:true}).click();await panel.getByRole('tab',{name:'History',exact:true}).click();await expect(panel.getByText('Approve the fixture action?',{exact:true})).toBeVisible();await expect(panel.getByText('Checked recipient and message.',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Approve this action',exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(message).toHaveValue('My preserved chat draft');
});

test('decisions-navigation-desktop: Full-page navigation preserves scroll and returns to linked Threads',async({ash})=>{
  const {page}=ash,message=page.getByLabel('Message',{exact:true});await message.fill('Long conversation.\n'.repeat(90));await message.press('Enter');await expect(page.getByTestId('run-status')).toHaveText('completed');
  const transcript=page.locator('.transcript');await transcript.evaluate(element=>{element.scrollTop=120;element.dispatchEvent(new WheelEvent('wheel',{deltaY:-1}));element.dispatchEvent(new Event('scroll'));});await expect.poll(()=>transcript.evaluate(el=>el.scrollTop)).toBe(120);await message.fill('Keep this draft');
  await page.getByRole('button',{name:/^Decisions/}).click();const decisions=page.getByRole('main',{name:'Decisions',exact:true});await expect(message).toBeHidden();await decisions.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('dialog',{name:'Settings'}).getByRole('button',{name:'Close Settings'}).click();
  await page.keyboard.press('Escape');await expect(message).toHaveValue('Keep this draft');await expect.poll(()=>transcript.evaluate(el=>el.scrollTop)).toBe(120);
  await message.fill('Ask me to choose a target?');await message.press('Enter');await expect(page.getByTestId('run-status').filter({hasText:'waiting'})).toHaveCount(1);await message.fill('Another preserved draft');await page.getByRole('button',{name:/^Decisions/}).click();await decisions.getByRole('button',{name:'Open Thread'}).click();await expect(message).toBeVisible();await expect(message).toHaveValue('Another preserved draft');
});

test('permissions-overrides-desktop: Reviewed relationships, explicit authoring and full conditions remain usable',async({ash,instance})=>{
  const {page}=ash;await ash.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(740,650));
  await page.getByRole('button',{name:'Settings',exact:true}).click();const settings=page.getByRole('dialog',{name:'Settings'});await settings.getByRole('tab',{name:'Permissions',exact:true}).click();
  const permissions=settings.getByRole('region',{name:'Permissions',exact:true});await permissions.getByRole('tab',{name:'Interaction',exact:true}).click();await permissions.getByRole('button',{name:'New permission',exact:true}).click();
  await permissions.getByLabel('Permission description',{exact:true}).fill('Allow sending messages to John Smith (john@example.com)');await permissions.getByRole('button',{name:'Suggest permissions',exact:true}).click();
  await expect(permissions.getByRole('region',{name:'Suggested permissions'})).toContainText('Send messages to John Smith (john@example.com)');await expect(permissions.getByRole('region',{name:'Review outcomes'})).toContainText('Send messages');
  const config=ServerConfig.parse(await json(join(instance.root,'server.json'))),running=await runtime(instance);
  const request=async(path:string,body?:unknown)=>fetch(`${running!.serverUrl}/api/${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  let saved=await (await request('permissions')).json() as any[];expect(saved.some(r=>r.policy.condition?.includes('John Smith'))).toBe(false);
  // Adding an incomparable rule cannot turn this reviewed recipient allowance into a publishing grant.
  const publish=saved.find(r=>r.policy.resource?.type==='public_content');await permissions.getByRole('button',{name:'Add override for suggestion 1',exact:true}).click();await permissions.getByRole('button',{name:'Add Publish public content (Ask) as override for suggestion 1',exact:true}).click();await permissions.getByRole('button',{name:'Save permission',exact:true}).click();await expect(permissions.getByRole('alert')).toContainText('override');await expect.poll(()=>ash.errors.some(e=>e.includes('status of 422'))).toBe(true);ash.errors.splice(ash.errors.findIndex(e=>e.includes('status of 422')),1);await expect(permissions.getByRole('button',{name:'Save permission',exact:true})).toBeEnabled();
  await permissions.getByRole('button',{name:'Remove override Publish public content from suggestion 1',exact:true}).click();await expect(permissions.getByRole('button',{name:'Remove override Publish public content from suggestion 1',exact:true})).toHaveCount(0);await permissions.getByRole('button',{name:'Suggest permissions',exact:true}).click();
  await expect(permissions.getByRole('button',{name:'Save permission',exact:true})).toBeEnabled();
  // Current-rule changes invalidate the signed review while preserving the draft.
  saved=await (await request('permissions')).json() as any[];const code=saved.find(r=>r.policy.kind==='explicit'&&r.policy.resource.type==='filesystem'&&!r.policy.resource.pattern);
  expect((await request('permissions',{id:code.id,category:code.category,effect:'ask',policy:code.policy})).status).toBe(200);
  await permissions.getByRole('button',{name:'Save permission',exact:true}).click();await expect(permissions.getByRole('alert')).toContainText('changed since');await expect.poll(()=>ash.errors.some(e=>e.includes('status of 409'))).toBe(true);ash.errors.splice(ash.errors.findIndex(e=>e.includes('status of 409')),1);await expect(permissions.getByLabel('Permission description',{exact:true})).toHaveValue('Allow sending messages to John Smith (john@example.com)');
  await permissions.getByRole('button',{name:'Suggest permissions',exact:true}).click();await permissions.getByRole('button',{name:'Save permission',exact:true}).click();
  const john=permissions.getByRole('listitem').filter({has:page.getByText('Send messages to John Smith (john@example.com)',{exact:true})});await expect(john).toContainText('Overrides:');await expect(john.getByRole('combobox')).toHaveValue('allow');await john.getByRole('button',{name:'Send messages · Ask',exact:true}).click();await expect(permissions.getByRole('listitem').filter({has:page.getByText('Send messages',{exact:true})})).toBeFocused();
  await john.getByRole('combobox').selectOption('ask');await expect(permissions.getByRole('heading',{name:'Edit permission'})).toBeVisible();saved=await (await request('permissions')).json() as any[];expect(saved.find(r=>r.policy.condition?.includes('John Smith')).effect).toBe('allow');
  await permissions.getByRole('button',{name:'Suggest permissions',exact:true}).click();await permissions.getByRole('button',{name:'Save permission',exact:true}).click();await expect(john.getByRole('combobox')).toHaveValue('ask');
  // Direct explicit creation shows the actual path and scope, with no semantic interpretation needed.
  await permissions.getByRole('tab',{name:'Filesystem',exact:true}).click();await permissions.getByRole('button',{name:'New permission',exact:true}).click();await permissions.getByRole('button',{name:'Choose action',exact:true}).click();await permissions.getByLabel('Resource',{exact:true}).fill('/example/reviewed-folder/');await permissions.getByLabel('Access',{exact:true}).selectOption('deny');await permissions.getByRole('button',{name:'Save permission',exact:true}).click();await expect(permissions.getByRole('listitem').filter({hasText:'/example/reviewed-folder'}).getByRole('combobox')).toHaveValue('deny');
  await permissions.getByRole('tab',{name:'Interaction',exact:true}).click();await permissions.getByRole('button',{name:'New permission',exact:true}).click();
  const qualified='Send research notes only when every attachment has been reviewed, the destination is inside Acme, and the report belongs to the current project rather than a different client. '+ 'Keep the complete scope visible. '.repeat(7);
  await permissions.getByLabel('Permission description',{exact:true}).fill(qualified);await permissions.getByRole('button',{name:'Suggest permissions',exact:true}).click();await permissions.getByRole('button',{name:'Save permission',exact:true}).click();
  const complete=permissions.locator('.rule-title').filter({hasText:'Send research notes only when'});await expect(complete).toHaveText(qualified.trim());await expect(complete).toHaveCSS('white-space','normal');expect(await complete.evaluate(el=>el.scrollHeight>30&&el.scrollWidth<=el.clientWidth)).toBe(true);expect(await settings.locator('.body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await john.getByRole('button',{name:/^Edit /}).click();await permissions.getByRole('button',{name:'Remove permission…',exact:true}).click();await expect(permissions.getByRole('region',{name:'Remove permission'})).toBeVisible();await permissions.getByRole('button',{name:'Remove permission',exact:true}).click();await expect(john).toHaveCount(0);
  await settings.getByRole('button',{name:'Close Settings'}).click();await page.reload();await expect(page.getByTestId('connection')).toContainText('Connected');
});
