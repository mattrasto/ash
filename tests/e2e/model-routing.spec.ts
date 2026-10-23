import { test, expect } from '../support/fixtures.ts';

test('model-routing-desktop: Routing Instruction and advanced Thread overrides preserve composer simplicity',async({ash},testInfo)=>{
 const {page}=ash;
 // Exercise the live-model controls against a controlled API boundary; no paid calls.
 let rejectSave=false;
 let routing={version:0,upgraded:false,override:'auto'};
 await ash.network.add('**/api/info',async route=>{const response=await route.fetch();const value=await response.json();value.model.routingEnabled=true;await route.fulfill({response,json:value});});
 await ash.network.add('**/api/threads/*',async route=>{
   if(route.request().method()!=='GET'){await route.continue();return;}
   const response=await route.fetch();const value=await response.json();
   if(value.thread?.lifecycle)value.thread.lifecycle.modelRouting=routing;
   await route.fulfill({response,json:value});
 });
 await ash.network.add('**/api/threads/*/model-routing',async route=>{
   if(rejectSave){await route.fulfill({status:503,json:{error:'Could not save the model override.'}});return;}
   const command=route.request().postDataJSON();expect(command.expectedVersion).toBe(routing.version);
   routing={...routing,version:routing.version+1,override:command.override};await route.fulfill({json:{}});
 });
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
 await dialog.getByLabel('Instruction owner').selectOption('global:model-routing');
 await expect(dialog.getByText(/Guides automatic model selection/)).toBeVisible();
 const text=dialog.getByLabel('Instruction text');await expect(text).toHaveValue(/Prefer the strong model/);
 await text.fill('Use Sol for architecture. Use Luna for simple formatting.');
 await dialog.getByRole('button',{name:'Save instructions',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Instructions saved');
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
 const summary=page.getByRole('button',{name:/^Model settings/});await expect(summary).toBeVisible();await summary.click();
 const model=page.getByLabel('Thread model',{exact:true});await expect(model).toHaveValue('auto');
 await model.selectOption('fast');await expect(model).toHaveValue('fast');await expect(summary).toContainText('override');
 await expect(page.getByRole('option',{name:'Private · not configured'})).toBeDisabled();
 await testInfo.attach('routing-override-panel',{body:await page.screenshot(),contentType:'image/png'});
 await model.selectOption('auto');await expect(model).toHaveValue('auto');
 rejectSave=true;await model.selectOption('strong');await expect(page.getByRole('alert')).toContainText('Could not save the model override.');await expect(model).toHaveValue('auto');rejectSave=false;
 const resourceError=ash.errors.findIndex(value=>value.includes('503 (Service Unavailable)'));expect(resourceError).toBeGreaterThanOrEqual(0);ash.errors.splice(resourceError,1);
 await model.focus();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Model settings',exact:true})).not.toBeVisible();await expect(summary).toBeFocused();
 // Controls stay outside the composer, and global routing edits persisted in the actual app.
 await expect(page.locator('.composer select[aria-label="Thread model"]')).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await dialog.getByLabel('Instruction owner').selectOption('global:model-routing');await expect(text).toHaveValue('Use Sol for architecture. Use Luna for simple formatting.');
 await page.keyboard.press('Escape');
 await testInfo.attach('routing-controls',{body:await page.screenshot(),contentType:'image/png'});
 // The fixture stops polling before removing its network routes.
});
