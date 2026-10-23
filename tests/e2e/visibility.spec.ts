import {test,expect} from '../support/fixtures.ts';
import {request} from '../support/desktop.ts';
import {screenshotFixture} from '../../packages/server/test/fixtures/images.ts';
test('visibility-decisions-desktop',async({ash},testInfo)=>{
 const {page,app}=ash,message=page.getByLabel('Message',{exact:true});
 await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});});
 await message.fill('Ask me which target to use?');await message.press('Enter');await expect(page.getByTestId('run-status')).toHaveText('waiting');
 const id=await page.evaluate(()=>localStorage.getItem('ash-chat-selected')!);
 await message.fill('A draft kept while waiting');
 await page.locator(`[data-thread-actions="${id}"]`).click();await page.getByRole('menuitem',{name:'Visibility and naming',exact:true}).click();
 const visibility=page.getByRole('complementary',{name:'Thread visibility'});await expect(visibility).toContainText('waiting work and unanswered Decisions');
 await visibility.getByRole('button',{name:'Close visibility'}).click();await page.getByRole('button',{name:/^Decisions/}).click();
 const decisions=page.getByRole('main',{name:'Decisions',exact:true});await expect(message).toBeHidden();
 // Complete a response in the selected, obscured conversation while its window is focused.
 await page.evaluate(async id=>{const response=await fetch(`/api/threads/${id}/messages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestKey:crypto.randomUUID(),text:'Hello from another client',mode:'normal'})});if(!response.ok)throw new Error(await response.text());},id);
 await expect.poll(()=>page.evaluate(async id=>(await (await fetch(`/api/threads/${id}`)).json()).thread.unread,id)).toBe(true);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(decisions).toBeVisible();await expect.poll(()=>page.evaluate(async id=>(await (await fetch(`/api/threads/${id}`)).json()).thread.unread,id)).toBe(true);
 for(const [width,height] of [[1040,830],[740,650]]){
  await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(size[0],size[1]),[width,height]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`decisions-unread-${width}.png`)});
 }
 await page.keyboard.press('Escape');await expect(message).toHaveValue('A draft kept while waiting');
 await expect(page.getByTestId('run-status').filter({hasText:'waiting'})).toHaveCount(1);
 await page.getByRole('article',{name:'Ash response'}).last().scrollIntoViewIfNeeded();
 await expect.poll(()=>page.evaluate(async id=>(await (await fetch(`/api/threads/${id}`)).json()).thread.unread,id)).toBe(false);
});
test('visibility-desktop',async({ash,instance},testInfo)=>{
 test.setTimeout(180000);
 const {page}=ash;
 // The real Electron window remains hidden/non-focusable. Control only its focus observation
 // to exercise renderer acknowledgments without stealing the user's desktop focus.
 await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});});
 await expect(page.getByRole('heading',{name:'Untitled',exact:true})).toBeVisible();
 await page.getByLabel('Message',{exact:true}).fill('Synthetic visibility journey');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByTestId('run-status')).toHaveText('completed');
 await expect(page.getByRole('article',{name:'Ash response'})).toHaveCount(1);
 await expect(page.getByTestId('thread-event').filter({hasText:'Ash named this Thread “Synthetic visibility journey”'})).toHaveCount(1);
 const id=await page.evaluate(()=>localStorage.getItem('ash-chat-selected')!);
 await expect.poll(()=>page.evaluate(async id=>(await (await fetch(`/api/threads/${id}`)).json()).thread.unread,id)).toBe(false);
 await page.getByRole('button',{name:'Actions for Synthetic visibility journey',exact:true}).click();await page.getByRole('menuitem',{name:'Pin',exact:true}).click();
 await expect.poll(()=>page.evaluate(async id=>(await (await fetch(`/api/threads/${id}`)).json()).thread.isPinned,id)).toBe(true);
 await page.getByRole('button',{name:'Actions for Synthetic visibility journey',exact:true}).click();await page.getByRole('menuitem',{name:'Visibility and naming',exact:true}).click();
 const panel=page.getByRole('complementary',{name:'Thread visibility'});await expect(panel).toContainText('Pinned');await panel.getByRole('button',{name:'Recalculate visibility'}).click();await expect(panel.getByRole('button',{name:/visibility · applied/})).toBeVisible({timeout:75000});
 await expect(panel.getByRole('heading',{name:'Application history',exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:/pinned · manual/})).toBeVisible();
 const attempt=await page.evaluate(async id=>(await (await fetch(`/api/threads/${id}/assessments`)).json())[0],id);
 expect((await request(instance,`/api/artifacts/${attempt.id}`)).status).toBe(404);
 await page.screenshot({path:testInfo.outputPath('visibility-panel.png')});
 await panel.getByRole('button',{name:/visibility · applied/}).first().click();await expect(page.getByRole('complementary',{name:'Thread inspector'})).toBeVisible();await expect(page.getByRole('heading',{name:'Captured model request',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open source message',exact:true}).click();await expect(page.getByRole('complementary',{name:'Artifact inspector'})).toBeVisible();await page.getByRole('button',{name:'Close inspector'}).click();
 await page.getByLabel('Message',{exact:true}).fill('Preserved draft through archival');
 await expect.poll(()=>page.evaluate(async id=>Object.values((await (await fetch(`/api/threads/${id}`)).json()).thread.lifecycle.drafts).some((draft:any)=>draft.present),id)).toBe(true);
 // Automatic archive is covered by the real scheduler integration tests; here a second
 // client archives through the public command so polling receives an archive transition.
 await page.evaluate(async id=>{const t=(await (await fetch(`/api/threads/${id}`)).json()).thread;await fetch(`/api/threads/${id}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({isArchived:true,expectedVersion:t.lifecycle.version,requestId:crypto.randomUUID()})});},id);
 await expect(page.getByText('Archived',{exact:true})).toBeVisible();await expect(page.getByLabel('Message',{exact:true})).toHaveValue('Preserved draft through archival');
 await expect(page.getByTestId('thread-event').filter({hasText:'You archived this Thread'})).toHaveCount(1);
 await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByText('Archived',{exact:true})).toHaveCount(0);await expect(page.getByRole('article',{name:'Ash response'})).toHaveCount(2);await expect(page.getByTestId('run-status').last()).toHaveText('completed');
 await expect(page.getByTestId('thread-event').filter({hasText:'Thread unarchived after new activity'})).toHaveCount(1);
 await expect.poll(()=>page.evaluate(async id=>Object.values((await (await fetch(`/api/threads/${id}`)).json()).thread.lifecycle.drafts).some((draft:any)=>draft.present),id)).toBe(false);
 await page.evaluate(()=>Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false}));
 const incoming=async(text:string)=>page.evaluate(async({id,text})=>{const response=await fetch('/api/incoming',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),targetThreadId:id,text,source:{name:'synthetic',eventId:crypto.randomUUID(),label:'Synthetic inbox'}})});if(!response.ok)throw new Error('Synthetic intake failed');},{id,text});
 await incoming('Useful unseen source update');await expect(page.getByRole('article',{name:'Source entry'})).toHaveCount(1);
 await page.getByRole('article',{name:'Source entry'}).last().scrollIntoViewIfNeeded();
 await expect.poll(()=>page.evaluate(async id=>(await (await fetch(`/api/threads/${id}`)).json()).thread.unread,id)).toBe(true);
 await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});window.dispatchEvent(new Event('focus'));});
 await expect.poll(()=>page.evaluate(async id=>(await (await fetch(`/api/threads/${id}`)).json()).thread.unread,id)).toBe(false);
 await page.getByRole('main').evaluate(element=>element.scrollTo(0,0));
 await incoming('Another useful source update outside the current view');await expect(page.getByRole('article',{name:'Source entry'})).toHaveCount(2);
 await expect.poll(()=>page.evaluate(async id=>(await (await fetch(`/api/threads/${id}`)).json()).thread.unread,id)).toBe(true);
 await page.getByRole('article',{name:'Source entry'}).last().scrollIntoViewIfNeeded();await expect.poll(()=>page.evaluate(async id=>(await (await fetch(`/api/threads/${id}`)).json()).thread.unread,id)).toBe(false);
 await page.getByRole('button',{name:'Actions for Synthetic visibility journey',exact:true}).click();await page.getByRole('menuitem',{name:'Rename',exact:true}).click();await page.getByLabel('Thread title',{exact:true}).fill('My stable name');await page.getByRole('button',{name:'Save title',exact:true}).click();
 await expect(page.getByRole('heading',{name:'My stable name',exact:true})).toBeVisible();await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByRole('heading',{name:'Synthetic visibility journey',exact:true})).toBeVisible();
 const stored=await page.evaluate(async id=>(await (await fetch(`/api/threads/${id}`)).json()),id);
 assertHistory(stored);
 await page.getByLabel('Message',{exact:true}).fill('A persistent draft');await page.reload();await expect(page.getByLabel('Message',{exact:true})).toHaveValue('A persistent draft');
 await expect(page.getByTestId('thread-event').filter({hasText:'renamed this Thread'})).toHaveCount(2);
 await expect(page.getByTestId('thread-event').filter({hasText:'Undo'})).toHaveCount(1);
 await page.getByTestId('thread-event').last().scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('thread-system-history.png')});
 // Keep the inspector beside the conversation so Retry remains reachable while history is open.
 await ash.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,830));
 await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(1280);
 await page.getByRole('button',{name:/Inspect: You renamed this Thread/}).last().click();await expect(page.getByRole('complementary',{name:'Thread inspector'})).toContainText('Recorded change');
 await page.getByRole('button',{name:'Retry response',exact:true}).last().click();
 await expect(page.getByRole('article',{name:'Ash response'})).toHaveCount(3);
 await expect(page.getByTestId('run-status').last()).toHaveText('completed');
 await expect(page.getByRole('complementary',{name:'Thread inspector'})).toContainText('Recorded change');
 await expect(page.getByRole('alert')).toHaveCount(0);
 await page.getByRole('button',{name:'Close inspector'}).click();
 await page.getByRole('button',{name:'New Thread',exact:true}).click();
 await page.getByLabel('Message',{exact:true}).fill('VIS_TEST_DUE Draft protection');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByTestId('run-status')).toHaveText('completed');
 const drafted=await page.evaluate(()=>localStorage.getItem('ash-chat-selected')!);
 const state=()=>page.evaluate(async id=>(await (await fetch(`/api/threads/${id}`)).json()).thread,drafted);
 // Read the response, then retain a draft across the actual model-set deadline and reload.
 await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});window.dispatchEvent(new Event('focus'));});
 await expect.poll(async()=>(await state()).unread).toBe(false);
 await page.getByLabel('Message',{exact:true}).fill('Do not archive while this draft exists.');
 await expect.poll(async()=>(await state()).lifecycle.kind,{timeout:25000}).toBe('until');
 const due=Date.parse((await state()).lifecycle.deadline);
 await page.getByRole('button',{name:'Synthetic visibility journey',exact:true}).click();
 await page.getByRole('button',{name:'VIS_TEST_DUE Draft protection',exact:true}).click();
 await page.reload();await expect(page.getByLabel('Message',{exact:true})).toHaveValue('Do not archive while this draft exists.');
 await expect.poll(()=>Date.now()>due+5500,{timeout:20000}).toBe(true);expect((await state()).isArchived).toBe(false);
 const count=await page.evaluate(async id=>(await (await fetch(`/api/threads/${id}/assessments`)).json()).length,drafted);
 await page.getByLabel('Choose images or videos',{exact:true}).setInputFiles({name:'draft-hold.png',mimeType:'image/png',buffer:await screenshotFixture('DRAFT HOLD')});
 await expect(page.getByTestId('draft-image')).toHaveCount(1);
 await page.getByLabel('Message',{exact:true}).fill('');
 await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Actions for VIS_TEST_DUE Draft protection',exact:true}).click();await page.getByRole('menuitem',{name:'Visibility and naming',exact:true}).click();
 await expect(panel).toContainText('A saved draft keeps this Thread visible');expect((await state()).isArchived).toBe(false);
 await page.getByRole('button',{name:'Close visibility'}).click();await page.getByRole('button',{name:'Remove draft-hold.png',exact:true}).click();
 await expect.poll(async()=>(await state()).isArchived,{timeout:10000}).toBe(true);
 expect(await page.evaluate(async id=>(await (await fetch(`/api/threads/${id}/assessments`)).json()).length,drafted)).toBe(count);
 await expect(page.getByRole('heading',{name:'VIS_TEST_DUE Draft protection',exact:true})).toBeVisible();
 await expect(page.getByTestId('thread-event').filter({hasText:'Ash archived this Thread'})).toHaveCount(1);
 // Switch while both history requests for the previous Thread are delayed.
 await page.getByRole('button',{name:'New Thread',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Untitled',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Actions for Synthetic visibility journey',exact:true}).click();await page.getByRole('menuitem',{name:'Visibility and naming',exact:true}).click();
 await expect(panel.getByRole('button',{name:/pinned · manual/})).toBeVisible();
 let release!:()=>void,held=0,delivered=0;
 const delayed=new Promise<void>(resolve=>release=resolve);
 await page.route(new RegExp(`/api/threads/${id}/(assessments|changes)$`),async route=>{const response=await route.fetch();held++;await delayed;await route.fulfill({response});delivered++;});
 await expect.poll(()=>held).toBe(2);
 await page.getByRole('button',{name:'Actions for Untitled',exact:true}).click();await page.getByRole('menuitem',{name:'Visibility and naming',exact:true}).click();
 await expect(panel.getByRole('heading',{name:'Untitled',exact:true})).toBeVisible();
 await expect(panel).toContainText('No changes yet.');await expect(panel).toContainText('No assessments yet.');
 release();await expect.poll(()=>delivered).toBe(2);
 await expect(panel.getByRole('button',{name:/pinned · manual/})).toHaveCount(0);
 await expect(panel).toContainText('No changes yet.');await expect(panel).toContainText('No assessments yet.');
 await page.screenshot({path:testInfo.outputPath('visibility-switched-thread.png')});
});

test('visibility-recording-recovery',async({ash},testInfo)=>{
 test.setTimeout(90000);
 const {page,app}=ash;
 await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});});
 await page.getByLabel('Message',{exact:true}).fill('VIS_TEST_DUE Recover recording');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByTestId('run-status')).toHaveText('completed');
 const id=await page.evaluate(()=>localStorage.getItem('ash-chat-selected')!);
 const state=()=>page.evaluate(async id=>(await (await fetch(`/api/threads/${id}`)).json()).thread,id);
 await expect.poll(async()=>(await state()).unread).toBe(false);
 await page.getByLabel('Message',{exact:true}).fill('Temporary recovery fixture');
 await expect.poll(async()=>Object.values((await state()).lifecycle.drafts).some((draft:any)=>draft.present)).toBe(true);
 // At the native boundary, simulate an interrupted recording whose journal loads late.
 // Its persisted presence exists, but no text/attachment draft has been restored yet.
 await app.evaluate(({ipcMain},threadId)=>{
  ipcMain.removeHandler('recording:recover');
  ipcMain.handle('recording:recover',()=>new Promise(resolve=>{(globalThis as any).releaseRecovery=()=>resolve([{id:crypto.randomUUID(),threadId,filename:'recovered.webm',size:100,createdAt:new Date().toISOString(),incomplete:true}]);}));
  ipcMain.removeHandler('recording:upload');ipcMain.handle('recording:upload',()=>{throw new Error('Synthetic upload unavailable; retain the local draft.');});
  ipcMain.removeHandler('recording:discard');ipcMain.handle('recording:discard',()=>{});
 },id);
 // Clear the saved text before the next app boots; the old document may save its in-memory draft while reloading.
 await page.addInitScript(id=>{const drafts=JSON.parse(localStorage.getItem('ash-chat-drafts')??'{}');delete drafts[id];localStorage.setItem('ash-chat-drafts',JSON.stringify(drafts));},id);
 await page.reload();await expect(page.getByTestId('connection')).toContainText('Connected');
 await expect(page.getByLabel('Message',{exact:true})).toHaveValue('');
 await expect.poll(async()=>(await state()).lifecycle.kind,{timeout:25000}).toBe('until');
 const due=Date.parse((await state()).lifecycle.deadline);
 await expect.poll(()=>Date.now()>due+5500,{timeout:25000}).toBe(true);
 expect((await state()).isArchived).toBe(false);
 expect(Object.values((await state()).lifecycle.drafts).some((draft:any)=>draft.present)).toBe(true);
 await app.evaluate(()=>{(globalThis as any).releaseRecovery();});
 await expect(page.getByTestId('draft-image')).toHaveCount(1);await expect(page.getByTestId('draft-image')).toContainText('Synthetic upload unavailable');
 expect((await state()).isArchived).toBe(false);
 await page.screenshot({path:testInfo.outputPath('recording-recovered-draft.png')});
 await page.getByRole('button',{name:'Remove recovered.webm',exact:true}).click();
 await expect.poll(async()=>(await state()).isArchived,{timeout:10000}).toBe(true);
});

function assertHistory(detail:any){
 expect(detail.artifacts.every((a:any)=>a.payload.type==='message')).toBe(true);
 expect(detail.changes.flatMap((c:any)=>c.events).filter((e:any)=>e.event==='renamed')).toHaveLength(3);
}
