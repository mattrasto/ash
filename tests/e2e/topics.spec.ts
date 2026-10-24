import { test,expect } from '../support/fixtures.ts';
import { ServerConfig, type OwnedInstruction } from '../../packages/shared/src/index.ts';
import { json } from '../../scripts/dev/io.ts';
import { runtime } from '../../scripts/dev/lifecycle.ts';
import { join } from 'node:path';

test('topics-settings-desktop: Sidebar Topics and fixed Settings preserve ownership and drafts',async({ash,instance},testInfo)=>{
  const {page,app}=ash;
  const message=page.getByLabel('Message',{exact:true});
  await message.fill('Insurance thread');await message.press('Enter');await expect(page.getByTestId('run-status')).toHaveText('completed');
  await message.fill('Draft survives organization');
  for(const name of ['Insurance','Home']){
    await page.getByRole('button',{name:'New Topic',exact:true}).click();const create=page.getByRole('dialog',{name:'New Topic',exact:true});
    await expect(create.getByLabel('Topic name',{exact:true})).toBeFocused();await create.getByLabel('Topic name',{exact:true}).fill(name);
    await create.getByRole('button',{name:'Create Topic',exact:true}).click();await expect(create).not.toBeVisible();
  }
  const topic=(name:string)=>page.getByRole('region',{name:`Topic ${name}`,exact:true});
  await expect(topic('Insurance').getByRole('button',{name:'Insurance thread',exact:true})).toHaveCount(0);
  const threadMenu=async()=>{await page.getByRole('button',{name:'Actions for Insurance thread',exact:true}).first().click();};
  await threadMenu();const topicsItem=page.getByRole('menuitem',{name:'Topics',exact:true});
  await expect(topicsItem).toBeFocused();await topicsItem.press('ArrowRight');const membership=page.getByRole('menu',{name:'Topics',exact:true});
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const insurance=membership.getByRole('menuitemcheckbox',{name:'Insurance',exact:true});
  await expect(membership.getByRole('menuitemcheckbox',{name:'Home',exact:true})).toBeFocused();await membership.getByRole('menuitemcheckbox',{name:'Home',exact:true}).press('ArrowDown');await expect(insurance).toBeFocused();await insurance.press('Space');await expect(insurance).toHaveAttribute('aria-checked','true');await expect(insurance).toHaveAttribute('aria-disabled','false');
  await insurance.press('ArrowLeft');await expect(topicsItem).toBeFocused();await topicsItem.press('Escape');await expect(topic('Insurance').getByRole('button',{name:'Actions for Insurance thread',exact:true})).toBeFocused();
  // Dropping adds a link, even when the destination is collapsed, and keeps the source link.
  await page.getByRole('button',{name:'Topic Home',exact:true}).click();
  await topic('Insurance').getByRole('button',{name:'Insurance thread',exact:true}).dragTo(topic('Home').getByRole('button',{name:'Topic Home',exact:true}));
  for(const name of ['Insurance','Home'])await expect(topic(name).getByRole('button',{name:'Insurance thread',exact:true})).toBeVisible();
  await expect(message).toHaveValue('Draft survives organization');await expect(page.getByTestId('message')).toHaveCount(2);
  await topic('Insurance').getByRole('button',{name:'Insurance thread',exact:true}).dragTo(topic('Home').getByRole('button',{name:'Topic Home',exact:true}));
  await expect(page.getByRole('button',{name:'Insurance thread',exact:true})).toHaveCount(2);
  await threadMenu();await topicsItem.click();
  for(const name of ['Insurance','Home'])await expect(membership.getByRole('menuitemcheckbox',{name,exact:true})).toHaveAttribute('aria-checked','true');
  await testInfo.attach('topics-submenu-1040',{body:await page.screenshot(),contentType:'image/png'});
  // A rejected save keeps the saved checkmarks and reports the error in the submenu.
  // Keep interception installed: disabling it can abort unrelated in-flight polling requests in Electron.
  let membershipFailure:{status:number;error:string}|null={status:409,error:'Topic membership changed elsewhere. Refresh before saving.'};
  await page.route('**/api/threads/*/topics',async route=>{const failure=membershipFailure;if(route.request().method()==='POST'&&failure)await route.fulfill({status:failure.status,contentType:'application/json',body:JSON.stringify({error:failure.error})});else await route.continue();});
  await membership.getByRole('menuitemcheckbox',{name:'Home',exact:true}).click();await expect(membership.getByRole('alert')).toContainText('changed elsewhere');await expect(membership.getByRole('menuitemcheckbox',{name:'Home',exact:true})).toHaveAttribute('aria-checked','true');
  membershipFailure=null;expect(ash.errors).toContain('Failed to load resource: the server responded with a status of 409 (Conflict)');ash.errors.splice(ash.errors.indexOf('Failed to load resource: the server responded with a status of 409 (Conflict)'),1);
  await membership.getByRole('menuitemcheckbox',{name:'Home',exact:true}).click();await expect(membership.getByRole('menuitemcheckbox',{name:'Home',exact:true})).toHaveAttribute('aria-checked','false');await expect(membership.getByRole('menuitemcheckbox',{name:'Home',exact:true})).toHaveAttribute('aria-disabled','false');
  await membership.getByRole('menuitemcheckbox',{name:'Home',exact:true}).press('Escape');await topicsItem.press('Escape');
  membershipFailure={status:503,error:'Could not save Topic link. Try again.'};
  await topic('Insurance').getByRole('button',{name:'Insurance thread',exact:true}).dragTo(topic('Home').getByRole('button',{name:'Topic Home',exact:true}));
  await expect(page.getByRole('alert')).toContainText('Could not save Topic link. Try again.');await expect(topic('Home').getByRole('button',{name:'Insurance thread',exact:true})).toHaveCount(0);await expect(message).toHaveValue('Draft survives organization');
  membershipFailure=null;expect(ash.errors).toContain('Failed to load resource: the server responded with a status of 503 (Service Unavailable)');ash.errors.splice(ash.errors.indexOf('Failed to load resource: the server responded with a status of 503 (Service Unavailable)'),1);
  await topic('Insurance').getByRole('button',{name:'Insurance thread',exact:true}).dragTo(topic('Home').getByRole('button',{name:'Topic Home',exact:true}));await expect(topic('Home').getByRole('button',{name:'Insurance thread',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Actions for Topic Insurance',exact:true}).click();await page.getByRole('menuitem',{name:'Instructions',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Settings',exact:true}),text=dialog.getByLabel('Instruction text'),owner=dialog.getByLabel('Instruction owner');
  await expect(dialog.getByText(/Guides autonomous placement of incoming items/)).toBeVisible();await expect(text).toHaveValue('');
  const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight})),bounds=await dialog.boundingBox();expect(bounds?.width).toBeGreaterThan(760);expect(bounds?.height).toBeGreaterThan(640);
  await text.fill('Add homeowners and car insurance items to Insurance.');await dialog.getByRole('button',{name:'Save instructions',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Instructions saved');expect(await dialog.boundingBox()).toEqual(bounds);
  await owner.selectOption({label:'Image descriptions'});await expect(dialog.getByText(/Applies only when describing/)).toBeVisible();expect(await dialog.boundingBox()).toEqual(bounds);
  await owner.selectOption({label:'Response guidance'});await text.fill('Draft global guidance');await owner.selectOption({label:'Image descriptions'});
  await expect(dialog.getByText('Save your instruction changes before leaving?')).toBeVisible();expect(await dialog.boundingBox()).toEqual(bounds);
  await dialog.getByRole('button',{name:'Keep editing'}).click();await expect(text).toHaveValue('Draft global guidance');await dialog.getByRole('button',{name:'Cancel changes'}).click();
  await text.fill('Global response guidance from Settings.');await dialog.getByRole('button',{name:'Save instructions',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Instructions saved');
  const cfg=ServerConfig.parse(await json(join(instance.root,'server.json'))),live=(await runtime(instance))!;
  const headers={authorization:`Bearer ${cfg.token}`,'content-type':'application/json'};
  const old=await (await fetch(`${live.serverUrl}/api/instructions/global/response`,{headers})).json() as OwnedInstruction;
  await fetch(`${live.serverUrl}/api/instructions`,{method:'POST',headers,body:JSON.stringify({owner:old.owner,text:'Concurrent saved guidance',expected:{id:old.document!.id,updatedAt:old.document!.updatedAt}})});
  await text.fill('My preserved draft');await dialog.getByRole('button',{name:'Save instructions',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('changed elsewhere');await expect(text).toHaveValue('My preserved draft');expect(await dialog.boundingBox()).toEqual(bounds);
  expect(ash.errors.filter(x=>x==='Failed to load resource: the server responded with a status of 409 (Conflict)')).toHaveLength(1);
  ash.errors.splice(ash.errors.indexOf('Failed to load resource: the server responded with a status of 409 (Conflict)'),1);
  await dialog.getByRole('button',{name:'Compare latest saved text'}).click();await expect(dialog.locator('pre')).toHaveText('Concurrent saved guidance');
  expect(await dialog.boundingBox()).toEqual(bounds);
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,650),viewport.width);await expect.poll(()=>page.evaluate(()=>innerHeight)).toBe(650);
  expect(await dialog.locator('.body').evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);expect(await dialog.evaluate(el=>el.scrollHeight<=el.clientHeight)).toBe(true);
  await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(size.width,size.height),viewport);await expect.poll(()=>page.evaluate(()=>innerHeight)).toBe(viewport.height);expect(await dialog.boundingBox()).toEqual(bounds);
  await dialog.getByRole('button',{name:'Save instructions',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Instructions saved');
  const threadOption=await owner.locator('option').filter({hasText:' · current'}).getAttribute('value');await owner.selectOption(threadOption!);await expect(text).toHaveValue('');
  await text.fill('Thread-specific response guidance.');await dialog.getByRole('button',{name:'Close Settings',exact:true}).click();await dialog.getByRole('button',{name:'Save and continue'}).click();await expect(dialog).not.toBeVisible();
  await expect(message).toHaveValue('Draft survives organization');
  await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(text).toBeVisible();
  for(const [width,height] of [[1040,830],[740,650]]){
    await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(size[0],size[1]),[width,height]);await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(width);
    const size=await dialog.boundingBox();expect(size?.width).toBe(Math.min(1080,width-40));expect(size?.height).toBe(Math.min(860,height-48));
    await owner.selectOption(threadOption!);await expect(text).toHaveValue('Thread-specific response guidance.');expect(await dialog.boundingBox()).toEqual(size);
    await owner.selectOption({label:'Image descriptions'});await expect(dialog.getByText(/Applies only when describing/)).toBeVisible();expect(await dialog.boundingBox()).toEqual(size);
    expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await testInfo.attach(`settings-${width}`,{body:await page.screenshot(),contentType:'image/png'});
  }
  await dialog.getByRole('button',{name:'Close Settings',exact:true}).click();await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Actions for Topic Home',exact:true}).click();await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
  const rename=page.getByRole('dialog',{name:'Rename Topic',exact:true});await rename.getByLabel('Topic name',{exact:true}).fill('House');await rename.getByRole('button',{name:'Save name',exact:true}).click();await expect(topic('House')).toBeVisible();
  await page.getByRole('button',{name:'Actions for Topic House',exact:true}).click();await page.getByRole('menuitem',{name:'Delete Topic',exact:true}).click();
  const remove=page.getByRole('dialog',{name:'Delete Topic',exact:true});await expect(remove.getByText('Threads, images and captured context will remain.')).toBeVisible();await remove.getByRole('button',{name:'Delete Topic',exact:true}).click();await expect(topic('House')).toHaveCount(0);
  await expect(topic('Insurance').getByRole('button',{name:'Insurance thread',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Topic Insurance',exact:true}).click();await expect(page.getByRole('button',{name:'Topic Insurance',exact:true})).toHaveAttribute('aria-expanded','false');
  // Collapsing the selected Thread's group survives sidebar remount and reload.
  await page.getByRole('button',{name:'Hide sidebar',exact:true}).click();await page.getByRole('button',{name:'Show sidebar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Topic Insurance',exact:true})).toHaveAttribute('aria-expanded','false');
  await page.reload();await expect(page.getByLabel('Thread Topics',{exact:true})).toHaveText('Insurance');
  await expect(page.getByRole('button',{name:'Topic Insurance',exact:true})).toHaveAttribute('aria-expanded','false');
  // A slow creation cannot send the previous Thread's draft while switching.
  let entered!:()=>void,release!:()=>void,finished!:()=>void;
  const entering=new Promise<void>(resolve=>entered=resolve),released=new Promise<void>(resolve=>release=resolve),completion=new Promise<void>(resolve=>finished=resolve);
  await page.route('**/api/threads',async route=>{if(route.request().method()==='POST'){entered();await released;try{await route.continue();}finally{finished();}}else await route.continue();});
  try{
    await page.getByRole('button',{name:'New Thread in Insurance',exact:true}).click();await entering;
    await expect(message).toBeDisabled();await expect(message).toHaveValue('Draft survives organization');
    await expect(page.getByRole('button',{name:'Attach images or videos',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
    await expect(page.getByText('Creating Thread…',{exact:true})).toBeVisible();await expect(page.getByTestId('message')).toHaveCount(2);
  }finally{release();await completion;await page.unroute('**/api/threads');}
  await expect(page.getByTestId('message')).toHaveCount(0);await expect(page.getByLabel('Thread Topics',{exact:true})).toHaveText('Insurance');await expect(message).toBeFocused();
  await page.getByTitle('New Thread · ⌘N',{exact:true}).click();await expect(page.getByLabel('Thread Topics',{exact:true})).toHaveText('No Topics');
  await topic('Insurance').getByRole('button',{name:'Insurance thread',exact:true}).click();await expect(message).toHaveValue('Draft survives organization');
  await threadMenu();await topicsItem.click();await expect(insurance).toHaveAttribute('aria-disabled','false');const menuBounds=await membership.boundingBox();expect(menuBounds!.x).toBeGreaterThanOrEqual(0);expect(menuBounds!.x+menuBounds!.width).toBeLessThanOrEqual(740);await testInfo.attach('topics-submenu-740',{body:await page.screenshot(),contentType:'image/png'});await insurance.click();await expect(insurance).toHaveAttribute('aria-checked','false');await expect(insurance).toHaveAttribute('aria-disabled','false');await insurance.press('Escape');await topicsItem.press('Escape');
  await expect(page.getByRole('button',{name:'Actions for Insurance thread',exact:true})).toBeFocused();
  await expect(page.getByRole('button',{name:'Insurance thread',exact:true})).toHaveCount(1);await expect(page.getByTestId('message')).toHaveCount(2);await expect(message).toHaveValue('Draft survives organization');
  await page.getByRole('button',{name:'Topic Insurance',exact:true}).click();await expect(page.getByRole('button',{name:'Topic Insurance',exact:true})).toHaveAttribute('aria-expanded','false');await page.reload();await expect(page.getByRole('button',{name:'Topic Insurance',exact:true})).toHaveAttribute('aria-expanded','false');
  // A Topic removed just before creation must not trap later creation in a failed retry.
  await page.getByRole('button',{name:'New Topic',exact:true}).click();const transient=page.getByRole('dialog',{name:'New Topic',exact:true});await transient.getByLabel('Topic name',{exact:true}).fill('Temporary');await transient.getByRole('button',{name:'Create Topic',exact:true}).click();await expect(transient).not.toBeVisible();
  const all=await (await fetch(`${live.serverUrl}/api/topics`,{headers})).json() as {id:string;name:string;updatedAt:string}[];
  const removed=all.find(topic=>topic.name==='Temporary')!;
  await page.route('**/api/threads',async route=>{if(route.request().method()==='POST')await fetch(`${live.serverUrl}/api/topics/${removed.id}`,{method:'POST',headers,body:JSON.stringify({deleted:true,expectedUpdatedAt:removed.updatedAt})});await route.continue();});
  await page.getByRole('button',{name:'New Thread in Temporary',exact:true}).click();await expect(page.getByText('This Topic is no longer available. Choose another Topic.',{exact:true})).toBeVisible();
  await page.unroute('**/api/threads');
  expect(ash.errors.filter(x=>x==='Failed to load resource: the server responded with a status of 409 (Conflict)')).toHaveLength(1);ash.errors.splice(ash.errors.indexOf('Failed to load resource: the server responded with a status of 409 (Conflict)'),1);
  await page.getByTitle('New Thread · ⌘N',{exact:true}).click();await expect(page.getByTestId('message')).toHaveCount(0);await expect(page.getByLabel('Thread Topics',{exact:true})).toHaveText('No Topics');
  // Ambiguous delivery retries keep their identity only while the chosen destination is unchanged.
  await page.getByRole('button',{name:'New Topic',exact:true}).click();await transient.getByLabel('Topic name',{exact:true}).fill('Retry destination');await transient.getByRole('button',{name:'Create Topic',exact:true}).click();await expect(transient).not.toBeVisible();
  const createIn=async(name?:string)=>{await (name?page.getByRole('button',{name:`New Thread in ${name}`,exact:true}):page.getByTitle('New Thread · ⌘N',{exact:true})).click();};
  for(const destination of ['Insurance','Retry destination',undefined]){
    const attempts:{id:string;topicId?:string}[]=[];
    await page.route('**/api/threads',async route=>{
      if(route.request().method()!=='POST'){await route.continue();return;}
      attempts.push(route.request().postDataJSON());
      // The server accepted creation, but the client lost its response.
      if(attempts.length===1){await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Creation response unavailable. Try again.'})});}
      else await route.continue();
    });
    try{
      await createIn('Insurance');await expect(page.getByRole('alert')).toContainText('Creation response unavailable. Try again.');
      await createIn(destination);await expect(page.getByLabel('Thread Topics',{exact:true})).toHaveText(destination??'No Topics');
      await expect(page.getByRole('alert')).toHaveCount(0);expect(attempts).toHaveLength(2);
      expect(attempts[1].id===attempts[0].id).toBe(destination==='Insurance');
      const saved=await (await fetch(`${live.serverUrl}/api/threads/${attempts[1].id}/topics`,{headers})).json() as {topics:{name:string}[]};
      expect(saved.topics.map(topic=>topic.name)).toEqual(destination?[destination]:[]);
      const first=await (await fetch(`${live.serverUrl}/api/threads/${attempts[0].id}/topics`,{headers})).json() as {topics:{name:string}[]};
      expect(first.topics.map(topic=>topic.name)).toEqual(['Insurance']);
    }finally{await page.unroute('**/api/threads');}
    expect(ash.errors).toContain('Failed to load resource: the server responded with a status of 503 (Service Unavailable)');ash.errors.splice(ash.errors.indexOf('Failed to load resource: the server responded with a status of 503 (Service Unavailable)'),1);
  }
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible()||w.isFocused()||w.isFocusable()))).toBe(false);
});

test('context-inspection-desktop: Captured instructions and scope survive later edits',async({ash})=>{
  const {page}=ash;
  await expect(page.getByTestId('run-status')).toHaveText('completed');
  await page.getByRole('button',{name:'Settings',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Settings'});
  await dialog.getByLabel('Instruction text').fill('Frozen global instructions');await dialog.getByRole('button',{name:'Save instructions',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Instructions saved');await dialog.getByRole('button',{name:'Close Settings',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.getByLabel('Message',{exact:true}).fill('Second answer');await page.getByLabel('Message',{exact:true}).press('Enter');await expect(page.getByTestId('message')).toHaveCount(4);await expect(page.getByTestId('run-status').last()).toHaveText('completed');
  await page.getByRole('button',{name:'Inspect Ash response',exact:true}).last().click();
  const context=page.getByRole('region',{name:'Captured context'});await expect(context.getByText('Frozen global instructions',{exact:true})).toHaveCount(2);
  await context.getByText('Available Topics · 0',{exact:true}).click();await expect(context.getByText('No cross-thread Topic retrieval.')).toBeVisible();
  await context.getByText('Context limits',{exact:true}).click();await expect(context.getByText(/12,000 character limit/)).toBeVisible();
  await expect(context.getByRole('button',{name:'Open source message'})).toHaveCount(3);
  await page.getByRole('button',{name:'Close inspector',exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();await dialog.getByLabel('Instruction text').fill('Edited later');await dialog.getByRole('button',{name:'Save instructions',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Instructions saved');await dialog.getByRole('button',{name:'Close Settings',exact:true}).click();
  await page.reload();await page.getByRole('button',{name:'Inspect Ash response',exact:true}).last().click();await expect(context.getByText('Frozen global instructions',{exact:true})).toHaveCount(2);await expect(context.getByText('Edited later',{exact:true})).toHaveCount(0);
});
