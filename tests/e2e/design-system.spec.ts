import { test,expect } from '../support/fixtures.ts';
import type { Page } from '@playwright/test';
async function specimen(page:Page){const url=new URL(page.url());url.search='specimen=design';await page.goto(url.href);await page.getByRole('main',{name:'Design specimen'}).waitFor();}

test('design-controls: Shared states, grouped popups and dialog focus remain operable',async({ash})=>{
  const {page}=ash;await specimen(page);
  await expect.poll(()=>page.evaluate(()=>document.fonts.check('375 14px "Albert Sans"'))).toBe(true);
  await expect(page.getByRole('alert').getByText('Action failed',{exact:true})).toHaveCSS('color','rgb(155, 79, 85)');
  await expect(page.getByText('The saved content remains available.',{exact:true})).toHaveCSS('color','rgb(52, 70, 77)');
  const readonly=page.getByLabel('Read-only field',{exact:true});await readonly.focus();await readonly.press('End');await readonly.press('x');await expect(readonly).toHaveValue('Selectable, without editing');
  await expect(readonly).toHaveCSS('backdrop-filter','none');
  const invalid=page.getByLabel('Invalid field',{exact:true});await expect(invalid).toHaveAttribute('aria-describedby','specimen-error');
  const disabled=page.getByRole('button',{name:'Disabled action',exact:true});const rest=await disabled.evaluate(el=>getComputedStyle(el).backgroundColor);await disabled.hover();expect(await disabled.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(rest);
  const primary=page.getByRole('button',{name:'Primary action',exact:true});await primary.hover();await primary.evaluate(async el=>{getComputedStyle(el).backgroundColor;await Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{})));});const hover=await primary.evaluate(el=>getComputedStyle(el).backgroundColor);await page.mouse.down();expect(await primary.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(hover);await page.mouse.up();
  const select=page.getByRole('combobox',{name:'Grouped select',exact:true});await select.click();await expect(page.getByRole('listbox')).toBeVisible();await select.press('ArrowDown');await select.press('Enter');await expect(select).toHaveValue('Afternoon');
  await expect(page.getByRole('listbox')).toHaveCount(0);await select.press('Enter');await select.press('e');await select.press('Enter');await expect(select).toHaveValue('Evening');
  const search=page.getByRole('searchbox',{name:'Search',exact:true});await search.fill('An editable search');await search.press('Escape');await expect(search).toHaveValue('');await expect(search).toBeFocused();
  const count=page.getByRole('spinbutton',{name:'Count',exact:true});await count.fill('3');await expect(page.getByRole('button',{name:'Increase count'})).toHaveAttribute('aria-disabled','true');await page.getByRole('button',{name:'Increase count'}).focus();await expect(page.getByRole('button',{name:'Increase count'})).toBeFocused();
  await page.getByRole('button',{name:'Open dialog',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Specimen dialog'});await expect(dialog).toBeVisible();const choice=page.getByRole('combobox',{name:'Dialog choice',exact:true});await choice.click();await expect(page.getByRole('listbox')).toBeVisible();await choice.press('Escape');await expect(page.getByRole('listbox')).toHaveCount(0);await expect(dialog).toBeVisible();await expect(choice).toBeFocused();
  await page.getByRole('button',{name:'Open dialog actions'}).click();const nested=page.getByRole('menuitem',{name:'Nested actions'});await nested.focus();await nested.press('ArrowRight');await expect(page.getByRole('menu',{name:'Nested actions'})).toBeVisible();await page.keyboard.press('Escape');await expect(nested).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Open dialog actions'})).toBeFocused();await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'Open actions',exact:true}).click();const editable=page.getByLabel('Editable field',{exact:true});await editable.evaluate(el=>el.addEventListener('pointerdown',event=>event.stopPropagation(),{once:true}));await editable.click();await expect(page.getByRole('menu')).toHaveCount(0);await expect(editable).toBeFocused();
});

test('design-presence: Reversal, layout changes and fallbacks leave no stale interactive surface',async({ash})=>{
  const {page}=ash;await specimen(page);const panel=page.getByTestId('reversible-surface'),toggle=page.getByRole('button',{name:'Toggle surface'});
  await expect(panel).toHaveAttribute('data-forming','false');const draft=page.getByLabel('Surface draft');await draft.fill('Keep this exact draft');
  await toggle.click();await expect.poll(()=>panel.evaluate(el=>(el as HTMLElement).inert)).toBe(true);await expect(panel).toHaveAttribute('aria-hidden','true');await toggle.click();await expect(panel).toHaveCount(1);await expect(panel).toHaveAttribute('data-forming','false');await expect(draft).toHaveValue('Keep this exact draft');
  await expect.poll(()=>page.locator('svg[id^="ash-mist-"]').count()).toBe(0);
  await draft.fill('Resizing does not replay the material');await expect(panel).toHaveAttribute('data-forming','false');
  const select=page.getByRole('combobox',{name:'Grouped select',exact:true});await select.press('Enter');await expect(page.getByRole('listbox').locator(':scope > .surface-content')).toHaveCSS('opacity','1');await expect(page.getByRole('listbox')).toHaveAttribute('data-forming','false');
  const continued=await select.evaluate(el=>{
    const original=document.querySelector('.ash-select-popup');
    el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return original===document.querySelector('.ash-select-popup')&&!original?.hasAttribute('aria-hidden');
  });
  expect(continued).toBe(true);await expect(page.getByRole('listbox')).toHaveCount(1);await select.press('Escape');await expect(page.getByRole('listbox')).toHaveCount(0);
  // A close before the first painted frame may finish immediately; reopening still owns one live popup.
  await select.evaluate(el=>{for(const key of ['Enter','Escape','Enter'])el.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));});
  await expect(page.locator('.ash-select-popup')).toHaveCount(1);await expect(select).toHaveAttribute('aria-expanded','true');await expect(page.getByRole('listbox').locator(':scope > .surface-content')).toHaveCSS('opacity','1');await select.press('Escape');await expect(page.locator('.ash-select-popup')).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'reduce'});await toggle.click();await expect(panel).toHaveCount(0);await toggle.click();await expect(panel).toHaveAttribute('data-forming','false');
  await page.emulateMedia({forcedColors:'active'});await expect(page.getByRole('combobox',{name:'Grouped select'})).toHaveCSS('appearance','auto');await page.getByRole('combobox',{name:'Grouped select'}).selectOption('Night');await expect(page.getByRole('combobox',{name:'Grouped select'})).toHaveValue('Night');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('design-replacement: Replacement preserves live inputs and nested reading positions',async({ash})=>{
  const {page}=ash;await specimen(page);const draft=page.getByRole('textbox',{name:'Replacement draft',exact:true});await draft.fill('Keep my unsaved replacement draft');
  const scroll=page.getByRole('region',{name:'Replacement scroll',exact:true});await scroll.evaluate(el=>el.scrollTop=65);
  const before=await scroll.evaluate(el=>el.scrollTop);const action=page.getByRole('button',{name:'Replace content'});await action.focus();await page.keyboard.press('Enter');
  await expect.poll(()=>page.locator('.ash-replacement-copy').count()).toBe(1);
  expect(await page.locator('.ash-replacement-copy').evaluate(el=>(el as HTMLElement).inert&&el.getAttribute('aria-hidden')==='true')).toBe(true);
  expect(await page.locator('.ash-replacement-copy [id],.ash-replacement-copy [name],.ash-replacement-copy [aria-label],.ash-replacement-copy label').count()).toBe(0);
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');
  await expect(page.locator('.ash-replacement-copy')).toHaveCount(0);await expect(draft).toHaveValue('Keep my unsaved replacement draft');expect(await scroll.evaluate(el=>el.scrollTop)).toBe(before);
  const bar=page.getByRole('scrollbar',{name:'Replacement scroll'});await bar.scrollIntoViewIfNeeded();await scroll.evaluate(el=>el.scrollTop=0);
  const track=await bar.boundingBox();const x=track!.x+track!.width/2,y=track!.y+track!.height-3;
  await page.mouse.move(x,y);await page.mouse.down();
  try{
    await expect.poll(()=>scroll.evaluate(el=>el.scrollTop/(el.scrollHeight-el.clientHeight))).toBeGreaterThan(.8);
    await page.mouse.move(x,y-1);
    const positions=await scroll.evaluate(async el=>{const values:number[]=[];const start=performance.now();while(performance.now()-start<250){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));values.push(el.scrollTop/(el.scrollHeight-el.clientHeight));}return values;});
    expect(Math.min(...positions)).toBeGreaterThan(.8);
  }finally{await page.mouse.up();}
  // Grabbing the edge of the thumb must retain its pointer offset.
  await bar.press('Home');await scroll.evaluate(el=>el.scrollTop=100);await expect(bar).toHaveAttribute('aria-valuenow','100');const thumb=await bar.locator('.ash-scroll-thumb').boundingBox();
  await page.mouse.move(x,thumb!.y+2);await page.mouse.down();
  try{const settled=await scroll.evaluate(async el=>{await new Promise(resolve=>setTimeout(resolve,250));return el.scrollTop;});expect(settled).toBeCloseTo(100,0);}finally{await page.mouse.up();}
  await bar.focus();await bar.press('End');await expect.poll(()=>scroll.evaluate(el=>Math.abs(el.scrollTop-(el.scrollHeight-el.clientHeight)))).toBeLessThan(2);
  await page.emulateMedia({reducedMotion:'reduce'});await action.click();await expect(page.locator('.ash-replacement-copy')).toHaveCount(0);
});
