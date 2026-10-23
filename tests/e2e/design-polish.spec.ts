import {test,expect} from '../support/fixtures.ts';
import type {Locator,Page} from '@playwright/test';
import type {ElectronApplication} from 'playwright';
import {screenshotFixture} from '../../packages/server/test/fixtures/images.ts';

async function centeredClose(button:Locator){
  const geometry=await button.evaluate(el=>{
    const target=el.getBoundingClientRect(),glyph=el.querySelector('svg')!.getBoundingClientRect();
    const row=el.closest('header,.draft-image'),rect=row?.getBoundingClientRect(),style=row?getComputedStyle(row):undefined;const top=parseFloat(style?.paddingTop??'0'),bottom=parseFloat(style?.paddingBottom??'0');
    return {alignment:rect?Math.abs(target.y+target.height/2-(rect.y+top+(rect.height-top-bottom)/2)):0,width:target.width,height:target.height,glyph:glyph.width,dx:Math.abs(target.x+target.width/2-glyph.x-glyph.width/2),dy:Math.abs(target.y+target.height/2-glyph.y-glyph.height/2)};
  });
  expect(geometry.width).toBe(30);expect(geometry.height).toBe(30);expect(geometry.glyph).toBe(16);expect(geometry.dx).toBeLessThan(.5);expect(geometry.dy).toBeLessThan(.5);expect(geometry.alignment).toBeLessThan(.5);
}
async function samples(button:Locator,selector:string,axis:'x'|'width'){
  return button.evaluate(async(el,{selector,axis})=>{
    const values:number[]=[];const initial=document.querySelector(selector);if(initial)values.push(initial.getBoundingClientRect()[axis]);
    (el as HTMLElement).click();const start=performance.now();
    while(performance.now()-start<500){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const node=document.querySelector(selector);if(node)values.push(node.getBoundingClientRect()[axis]);}
    return values;
  },{selector,axis});
}
function movedGradually(values:number[]){const first=values[0],last=values.at(-1)!;expect(Math.abs(last-first)).toBeGreaterThan(100);expect(values.some(value=>value>Math.min(first,last)+2&&value<Math.max(first,last)-2)).toBe(true);}
async function resize(page:Page,app:ElectronApplication,width:number,height:number){await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(size.width,size.height),{width,height});await expect.poll(()=>page.evaluate(()=>[innerWidth,innerHeight])).toEqual([width,height]);}

test('design-dismissal: Outside gestures respect popup ownership, draft guards and shared close geometry',async({ash})=>{
  const {page}=ash;
  await page.getByRole('button',{name:'Processing',exact:true}).click();const processing=page.getByRole('dialog',{name:'Incoming processing'});
  await centeredClose(processing.getByRole('button',{name:'Close processing'}));
  // A drag beginning inside the dialog is not an outside click.
  const title=await processing.getByRole('heading',{name:'Processing',exact:true}).boundingBox();await page.mouse.move(title!.x+5,title!.y+5);await page.mouse.down();await page.mouse.move(4,100);await page.mouse.up();await expect(processing).toBeVisible();
  await page.mouse.click(4,100);await expect(processing).toHaveCount(0);
  await page.getByRole('button',{name:'Settings',exact:true}).click();const settings=page.getByRole('dialog',{name:'Settings'});await centeredClose(settings.getByRole('button',{name:'Close Settings'}));
  const text=settings.getByLabel('Instruction text',{exact:true});await expect(text).toBeEnabled();await settings.getByLabel('Instruction owner',{exact:true}).click();await expect(page.getByRole('listbox')).toBeVisible();
  await page.mouse.click(4,100);await expect(page.getByRole('listbox')).toHaveCount(0);await expect(settings).toBeVisible();
  await text.fill('Preserve my unsaved instructions');await page.mouse.click(4,100);await expect(settings.getByRole('alert')).toContainText('Save your instruction changes before leaving?');await settings.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(text).toHaveValue('Preserve my unsaved instructions');
  await settings.getByRole('button',{name:'Cancel changes',exact:true}).click();await page.mouse.click(4,100);await expect(settings).toHaveCount(0);
  await page.getByRole('button',{name:'New Topic',exact:true}).click();await expect(page.getByRole('dialog',{name:'New Topic'})).toBeVisible();await page.mouse.click(4,100);await expect(page.getByRole('dialog',{name:'New Topic'})).toHaveCount(0);
  await page.getByLabel('Choose images or videos',{exact:true}).setInputFiles({name:'polish.png',mimeType:'image/png',buffer:await screenshotFixture('CLOSE CONTROL')});
  const preview=page.getByRole('button',{name:'Preview polish.png',exact:true});await expect(preview).toBeEnabled();await centeredClose(page.getByRole('button',{name:'Remove polish.png',exact:true}));await preview.click();
  const viewer=page.getByRole('dialog',{name:'Image viewer: polish.png',exact:true});await expect(viewer).toBeVisible();await centeredClose(viewer.getByRole('button',{name:'Close image viewer',exact:true}));await page.mouse.click(4,100);await expect(viewer).toHaveCount(0);await expect(page.getByTestId('draft-image')).toHaveCount(1);
});

test('design-rails: Real overflow and sidebar movement preserve the live workspace',async({ash})=>{
  const {page,app}=ash;await resize(page,app,1400,1000);
  const message=page.getByLabel('Message',{exact:true}),bar=page.locator('.transcript-frame > .ash-scrollbar');
  await expect(bar).toHaveAttribute('data-visible','false');await message.fill('A short conversation');await message.press('Enter');await expect(page.getByTestId('run-status')).toHaveText('completed');
  await expect.poll(()=>page.locator('.transcript').evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(1);await expect(bar).toHaveAttribute('data-visible','false');
  await message.fill('Keep this draft through every sidebar change');const live=await message.elementHandle();
  movedGradually(await samples(page.getByRole('button',{name:'Hide sidebar',exact:true}),'.main-column','x'));await expect(page.getByRole('complementary',{name:'Thread sidebar'})).toHaveCount(0);
  movedGradually(await samples(page.getByRole('button',{name:'Show sidebar',exact:true}),'.main-column','x'));
  movedGradually(await samples(page.getByRole('button',{name:'Inspect Ash response',exact:true}),'.main-column','width'));
  movedGradually(await samples(page.getByRole('button',{name:'Close inspector',exact:true}),'.main-column','width'));
  await resize(page,app,1040,830);const width=await page.locator('.main-column').evaluate(el=>el.getBoundingClientRect().width);
  const overlay=await samples(page.getByRole('button',{name:'Inspect Ash response',exact:true}),'.inspector-rail','x');expect(overlay.some(value=>value>overlay.at(-1)!+2)).toBe(true);expect(await page.locator('.main-column').evaluate(el=>el.getBoundingClientRect().width)).toBe(width);
  await page.getByRole('button',{name:'Close inspector',exact:true}).click();await expect(page.getByRole('complementary',{name:'Artifact inspector'})).toHaveCount(0);
  expect(await live!.evaluate(el=>el===document.getElementById('message'))).toBe(true);await expect(message).toHaveValue('Keep this draft through every sidebar change');
  for(let i=0;i<3;i++){
    const before=await page.getByTestId('run-status').count();await message.fill(`More content ${i+1}`);await message.press('Enter');
    await expect(page.getByTestId('run-status')).toHaveCount(before+1);await expect(page.getByTestId('run-status').last()).toHaveText('completed');
  }
  await expect(bar).toHaveAttribute('data-visible','true');
  await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(()=>page.evaluate(()=>matchMedia('(prefers-reduced-motion:reduce)').matches)).toBe(true);
  await page.getByRole('button',{name:'Hide sidebar',exact:true}).click();await expect(page.getByRole('complementary',{name:'Thread sidebar'})).toHaveCount(0);await page.getByRole('button',{name:'Show sidebar',exact:true}).click();
  // A zero-duration transition may still have an animation object until its cleanup frame.
  const durations=await page.locator('.ash-rail').evaluateAll(nodes=>nodes.flatMap(node=>node.getAnimations().map(animation=>animation.effect?.getTiming().duration)));expect(durations.every(duration=>duration===0)).toBe(true);
  await expect.poll(()=>page.locator('.ash-rail').evaluateAll(nodes=>nodes.flatMap(node=>node.getAnimations()).length)).toBe(0);
});

test('design-reading: Links stay readable and nested editors retain wheel scrolling',async({ash})=>{
  const {page,app}=ash;await resize(page,app,740,650);
  const message=page.getByLabel('Message',{exact:true});await message.fill('[Learn more](https://example.com)');await message.press('Enter');await expect(page.getByTestId('run-status')).toHaveText('completed');
  const link=page.getByRole('link',{name:'Learn more',exact:true});
  await expect(link).toHaveCSS('color','rgb(52, 70, 77)');await expect(link).toHaveCSS('text-decoration-color','rgb(114, 174, 238)');
  await link.focus();await expect(link).toBeFocused();
  await page.getByRole('button',{name:'Settings',exact:true}).click();const settings=page.getByRole('dialog',{name:'Settings'}),body=settings.locator('.body'),editor=settings.getByLabel('Instruction text',{exact:true});
  await expect(editor).toBeEnabled();await editor.fill('A long instruction line.\n'.repeat(100));await expect(settings).toHaveAttribute('data-forming','false');
  await expect.poll(()=>body.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeGreaterThan(50);
  await editor.hover();await editor.evaluate(el=>{el.scrollTop=0;(el as HTMLTextAreaElement).setSelectionRange(0,0);});await body.evaluate(el=>el.scrollTop=0);
  await page.mouse.wheel(0,100);await expect.poll(()=>editor.evaluate(el=>el.scrollTop)).toBeGreaterThan(50);await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBe(0);
  await page.mouse.wheel(0,-100);await expect.poll(()=>editor.evaluate(el=>el.scrollTop)).toBeLessThanOrEqual(1);await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBe(0);
  // At the editor's boundary, ordinary scroll chaining still reaches Settings.
  await editor.evaluate(el=>el.scrollTop=el.scrollHeight);await page.mouse.wheel(0,100);await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBeGreaterThan(50);
  await settings.getByRole('button',{name:'Cancel changes',exact:true}).click();await settings.getByRole('button',{name:'Close Settings',exact:true}).click();await expect(settings).toHaveCount(0);
});
