import {test,expect} from '../support/fixtures.ts';
import {request} from '../support/desktop.ts';
import {fixtureManifests} from '../../packages/scenes/src/fixtures/manifests.ts';
import type {ResolvedSceneBundle} from '../../packages/scenes/src/contracts.ts';
const valleyFixture=fixtureManifests.find(scene=>scene.id==='valley-panorama-v3')!;
const lakeFixture=fixtureManifests.find(scene=>scene.id==='lake-panorama-v3')!;
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

test('scene-desktop: Cached landscape, held lighting and saved city coexist with chat',async({ash,instance},testInfo)=>{
  const {page,app}=ash;
  await expect(page.locator('[data-scene-status="ready"]')).toHaveCount(1);
  await page.emulateMedia({reducedMotion:'reduce'});
  const phase=page.getByRole('combobox',{name:'Scene lighting'});
  await phase.click();
  const lightingOptions=page.getByRole('listbox',{name:'Scene lighting'});
  await expect(lightingOptions).toHaveCSS('-webkit-app-region','no-drag');
  await lightingOptions.getByRole('option',{name:'Dawn',exact:true}).click();
  await expect(phase).toHaveValue('dawn');
  await phase.selectOption('night');
  await page.reload();
  await expect(phase).toHaveValue('night');
  await expect(page.locator('[data-scene-status="ready"]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Explore constellations'})).toHaveCount(0);
  await expect(page.locator('.readability-wash')).toHaveCount(0);
  await expect(page.getByRole('heading',{level:1})).toHaveCSS('color','rgb(52, 70, 77)');
  const sky=page.locator('.scene-host canvas');
  await expect(sky).not.toHaveAttribute('tabindex','0');
  await expect(page.locator('.scene-host')).toHaveAttribute('aria-hidden','true');
  await expect(page.locator('[data-constellation-name],.scene-host [aria-live]')).toHaveCount(0);
  await expect(sky).toHaveCSS('pointer-events','none');
  expect(await sky.evaluate(canvas=>{
    const key=new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true});canvas.dispatchEvent(key);return key.defaultPrevented;
  })).toBe(false);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:'Appearance'}).click();
  const scene=page.getByRole('combobox',{name:'Scene',exact:true});
  await expect(scene).toBeVisible();await expect(scene.locator('option',{hasText:'New Scene'})).toHaveCount(1);
  await expect(scene).toHaveValue('meadow-panorama-v3');
  await expect(scene.locator('option[value=meadow],option[value=meadow-upscaled-v1]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Render review previews|Use this background|Restore previous background/})).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:'City',exact:true})).toHaveCount(0);
  await page.getByRole('tab',{name:'General',exact:true}).click();
  const city=page.getByRole('combobox',{name:'City',exact:true});
  let citySearches=0;const countSearch=(request:{url():string})=>{if(new URL(request.url()).pathname==='/api/scenes/locations')citySearches++;};page.on('request',countSearch);
  await city.fill('T');await expect(page.getByRole('button',{name:'Clear city',exact:true})).toHaveAttribute('type','button');
  await page.getByRole('button',{name:'Clear city',exact:true}).click();await expect(city).toHaveValue('');
  await expect(page.getByRole('button',{name:'Close Settings'})).toBeVisible();expect(citySearches).toBe(0);
  await city.fill('Tokyo');await expect(page.getByRole('option',{name:'Tokyo, Japan',exact:true})).toBeVisible();
  await city.press('Escape');await expect(city).toHaveValue('');
  await expect(page.getByRole('button',{name:'Close Settings'})).toBeVisible();
  await expect(page.getByRole('listbox',{name:'Matching cities'})).toHaveCount(0);
  await city.fill('Tokyo');
  await expect(page.getByRole('option',{name:'Tokyo, Japan',exact:true})).toBeVisible();
  await city.press('ArrowDown');await city.press('Enter');
  page.off('request',countSearch);
  await expect(page.getByRole('status')).toContainText('Location saved: Tokyo');
  expect((await(await request(instance,'/api/scenes/state')).json()).location.timeZone).toBe('Asia/Tokyo');
  await expect(page.getByRole('button',{name:'Scene controls',exact:true})).toHaveCount(0);
  await page.getByRole('switch',{name:'Debug Mode',exact:true}).check();
  await page.getByRole('button',{name:'Close Settings'}).click();
  const controlsButton=page.getByRole('button',{name:'Scene controls',exact:true});
  await controlsButton.click();
  const controls=page.getByRole('dialog',{name:'Scene controls',exact:true}),debugScene=controls.getByRole('combobox',{name:'Scene',exact:true});
  await expect(controls).toBeVisible();
  await expect(controls.getByText('Scene tuning',{exact:true})).toHaveCount(0);
  await expect(controls.getByRole('button',{name:'Done',exact:true})).toHaveCount(0);
  await debugScene.click();
  const sceneOptions=page.getByRole('listbox',{name:'Scene',exact:true});
  await sceneOptions.getByRole('option',{name:'Lakeside',exact:true}).click();
  await expect(controls).toBeVisible();
  await expect(page.locator('[data-scene-status="ready"]')).toHaveAttribute('data-scene-id','lake-panorama-v3');
  await debugScene.click();
  await sceneOptions.getByRole('option',{name:'Meadow panorama',exact:true}).click();
  await expect(page.locator('[data-scene-status="ready"]')).toHaveAttribute('data-scene-id','meadow-panorama-v3');
  await debugScene.click();await page.keyboard.press('Escape');
  await expect(sceneOptions).toHaveCount(0);await expect(controls).toBeVisible();
  await page.keyboard.press('Escape');await expect(controls).toHaveCount(0);await expect(controlsButton).toBeFocused();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:'General',exact:true}).click();
  await page.getByRole('switch',{name:'Debug Mode',exact:true}).uncheck();
  await page.getByRole('button',{name:'Close Settings'}).click();
  await expect(controlsButton).toHaveCount(0);
  await page.clock.setFixedTime(new Date('2026-10-22T03:00:00Z'));
  await phase.selectOption('day');
  await expect(sky).not.toHaveAttribute('tabindex','0');
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Chat stays usable with living scenes.');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.getByTestId('run-status')).toHaveText('completed');
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const size of [[740,650],[1040,830],[1920,1080],[5120,2880]]){
    await app.evaluate(({BrowserWindow},[width,height])=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),size);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(phase).toBeVisible();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
    await expect.poll(()=>page.locator('.scene-host canvas').evaluate((canvas:HTMLCanvasElement)=>{
      const geometry=JSON.parse(canvas.dataset.sceneGeometry??'null'),bounds=canvas.getBoundingClientRect();
      if(!geometry)return false;
      const {viewport,artwork,backing,sourceCrop}=geometry;
      return canvas.dataset.framing==='cover'&&Math.abs(bounds.width-innerWidth)<1&&Math.abs(bounds.height-innerHeight)<1&&Math.abs(viewport.width-bounds.width)<1&&Math.abs(viewport.height-bounds.height)<1&&artwork.x<=0&&artwork.y<=0&&artwork.x+artwork.width>=viewport.width-.01&&artwork.y+artwork.height>=viewport.height-.01&&sourceCrop.x>=0&&sourceCrop.y>=0&&sourceCrop.x+sourceCrop.width<=1.000001&&sourceCrop.y+sourceCrop.height<=1.000001&&backing.width*backing.height<=8_294_400;
    })).toBe(true);
    // Inspect the actual scene canvas, before the chat/sidebar cover it: the former gutter color cannot form an edge band.
    const paintedEdges=await page.locator('.scene-host canvas').evaluate((canvas:HTMLCanvasElement)=>{
      const context=canvas.getContext('2d')!;
      return [[1,.25],[1,.75],[canvas.width-2,.25],[canvas.width-2,.75]].every(([x,y])=>{
        const pixels=context.getImageData(x!,Math.floor(y!*canvas.height),1,3).data;
        return [0,4,8].some(p=>pixels[p]!==216||pixels[p+1]!==224||pixels[p+2]!==213);
      });
    });
    expect(paintedEdges).toBe(true);
    await testInfo.attach(`scene-${size[0]}`,{body:await page.screenshot(),contentType:'image/png'});
  }
  await page.getByRole('button',{name:'Inspect Ash response',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Captured model request'})).toBeVisible();
  await testInfo.attach('scene-inspector',{body:await page.screenshot(),contentType:'image/png'});
  const native=await page.evaluate(()=>window.ashScenes!.state());
  expect(native.visible).toBe(true);expect(native.suspended).toBe(false);
  // The client may have missed B while displaying A; replacing it with C must retain A's bytes.
  await page.route('**/api/scenes/state',route=>route.fulfill({json:{manifest:valleyFixture,previous:lakeFixture,location:{name:'Tokyo, Japan',latitude:35.65,longitude:139.74,timeZone:'Asia/Tokyo'},source:'active'}}));
  await page.reload();
  await expect(page.locator('[data-scene-status="ready"]')).toHaveAttribute('data-scene-id',valleyFixture.id);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('ash-scene-manifests-v1')!).current.id)).toBe(valleyFixture.id);
  const previous=await page.evaluate(async()=>{
    const manifests=JSON.parse(localStorage.getItem('ash-scene-manifests-v1')!);
    const cache=await caches.open('ash-scenes-assets-v1'),keys=(await cache.keys()).map(key=>key.url.split('/').at(-1));
    return{id:manifests.previous.id,complete:Object.values(manifests.previous.assets).every((asset:any)=>keys.includes(asset.sha256))};
  });
  expect(previous).toEqual({id:'meadow-panorama-v3',complete:true});
  const retry=structuredClone(valleyFixture);retry.id='retry-valley';
  await page.route('**/api/scenes/state',route=>route.fulfill({json:{manifest:retry,previous:lakeFixture,location:{name:'Tokyo, Japan',latitude:35.65,longitude:139.74,timeZone:'Asia/Tokyo'},source:'active'}}));
  let failDepth=true;
  const bytes=await Promise.all(Object.values(retry.assets).map(async asset=>[asset.sha256,await readFile(join(instance.checkout,'packages/scenes/src/fixtures',asset.path))] as const));
  await page.route('**/api/scenes/bundles/retry-valley/assets/*',route=>{
    const hash=route.request().url().split('/').at(-1);
    return route.fulfill({contentType:'image/png',body:failDepth&&hash===retry.assets.depth.sha256?Buffer.from([0]):bytes.find(([sha])=>sha===hash)![1]});
  });
  await page.evaluate(async hash=>{const cache=await caches.open('ash-scenes-assets-v1');await cache.delete(new URL(`/__ash_scene_cache__/${hash}`,location.origin).href);},retry.assets.depth.sha256);
  await page.clock.runFor(31000);
  await expect(page.locator('[data-scene-status="error"]')).toHaveAttribute('data-scene-request','retry-valley');
  await expect(page.locator('[data-scene-status="error"]')).toHaveAttribute('data-scene-id',valleyFixture.id);
  failDepth=false;
  await page.clock.runFor(31000);
  await expect(page.locator('[data-scene-status="ready"]')).toHaveAttribute('data-scene-id','retry-valley');
});

test('scene-phase-motion: Worker-prepared lighting rotates smoothly and releases transient native frames',async({ash})=>{
  const {page}=ash;
  await page.emulateMedia({reducedMotion:'no-preference'});
  const sky=page.locator('.scene-host canvas'),phase=page.getByRole('combobox',{name:'Scene lighting'});
  await expect(page.locator('[data-scene-status="ready"]')).toHaveCount(1);
  await expect(sky).toHaveAttribute('data-lighting-worker','ready');
  await phase.selectOption('day');await expect(sky).toHaveAttribute('data-scene-transition','idle');
  await phase.selectOption('night');
  await expect(sky).toHaveAttribute('data-scene-transition','animating');
  await expect(sky).toHaveAttribute('data-preview-grade-frames','10');
  await expect(sky).toHaveAttribute('data-scene-transition','idle');
  await expect(sky).toHaveAttribute('data-grade-cache-frames','2');
  await phase.selectOption('dawn');await phase.selectOption('dusk');
  await expect(sky).toHaveAttribute('data-scene-transition','idle');
  await expect(sky).toHaveAttribute('data-grade-cache-frames','2');
  await page.emulateMedia({reducedMotion:'reduce'});await phase.selectOption('day');
  await expect(sky).toHaveAttribute('data-scene-transition','idle');
  await expect(sky).toHaveAttribute('data-grade-cache-frames','2');
});

test('scene-replacement: Atomic loading, offline cache, static water and disposal retain a good scene',async({ash,instance})=>{
  const {page}=ash;
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('[data-scene-status="ready"]')).toHaveCount(1);
  const result=await page.evaluate(async(checkout)=>{
    const {ScenePlaybackController,bundledScenes}=await import(`/@fs/${checkout}/packages/scenes/src/browser/index.ts`);
    const holder=document.createElement('div');holder.style.cssText='position:fixed;left:-10000px;top:0;width:600px;height:400px';
    const canvas=document.createElement('canvas');canvas.style.cssText='width:100%;height:100%';holder.append(canvas);document.body.append(holder);
    const states:Array<{state:string;water:string}>=[];
    let controller=new ScenePlaybackController(canvas,(state:{state:string;water:string})=>states.push(state));
    const settle=async()=>{for(let i=0;i<400&&controller.renderer.cloudPending;i++)await new Promise(resolve=>setTimeout(resolve,10));await new Promise(resolve=>setTimeout(resolve,80));};
    try{
      controller.setContext('day',undefined,true);
      controller.setContext('night',undefined,true,Date.parse('2026-10-22T03:00:00Z'));
      controller.clock(false,Date.parse('2026-10-22T23:59:59Z'));const held=controller.renderer.settings.solar.localSiderealTime;
      controller.clock(false,Date.parse('2026-10-24T00:00:01Z'));const heldAcrossMidnight=held===controller.renderer.settings.solar.localSiderealTime;
      controller.setContext('day',undefined,true);
      const meadowScene=bundledScenes.find((scene:ResolvedSceneBundle)=>scene.manifest.id==='meadow-panorama-v3')!,lakeScene=bundledScenes.find((scene:ResolvedSceneBundle)=>scene.manifest.id==='lake-panorama-v3')!,valleyScene=bundledScenes.find((scene:ResolvedSceneBundle)=>scene.manifest.id==='valley-panorama-v3')!;
      const first=await controller.load(meadowScene);await settle();
      controller.setRetainedPrevious(valleyScene.manifest);
      const lake=await controller.load(lakeScene);await settle();
      controller.setContext('night',undefined,true);
      const coverage=[];
      const noPicking=typeof controller.renderer.interact==='undefined'&&typeof controller.renderer.pickConstellation==='undefined'&&typeof controller.renderer.cycleConstellation==='undefined';
      for(const [width,height]of [[740,650],[1040,830],[1920,1080],[5120,2880]]){
        holder.style.width=`${width}px`;holder.style.height=`${height}px`;controller.renderer.resize();controller.renderer.draw();
        const geometry=controller.renderer.geometry(),{artwork,viewport,backing}=geometry;
        const water=controller.renderer.assets.water,ctx=canvas.getContext('2d')!,drawImage=ctx.drawImage.bind(ctx),calls:Array<{layer:string;args:number[]}>=[];
        ctx.drawImage=((image:CanvasImageSource,...args:number[])=>{
          const renderer=controller.renderer,layer=image===renderer.starLayer?'stars':image===renderer.cloudLayer?'clouds':image===renderer.groundLayer?'shadows':image===renderer.waterPass?.canvas?'water':'artwork';
          calls.push({layer,args});return drawImage(image,...args as [number,number,number,number]);
        }) as typeof ctx.drawImage;
        try{controller.renderer.draw();}finally{ctx.drawImage=drawImage;}
        const fullLayers=calls.filter(call=>call.layer!=='water');
        const waterCall=calls.find(call=>call.layer==='water');
        const waterAligned=controller.renderer.waterAvailable()?!!waterCall&&Math.abs(waterCall.args[0]-(artwork.x+water.x/controller.renderer.assets.w*artwork.width))<.001&&Math.abs(waterCall.args[1]-(artwork.y+water.y/controller.renderer.assets.h*artwork.height))<.001&&!waterCall.args.some(Number.isNaN):!waterCall;
        const cropAligned=['artwork','clouds','shadows','stars'].every(layer=>calls.some(call=>call.layer===layer))&&fullLayers.every(call=>call.args.length===4&&Math.abs(call.args[0]-artwork.x)<.001&&Math.abs(call.args[1]-artwork.y)<.001&&Math.abs(call.args[2]-artwork.width)<.001&&Math.abs(call.args[3]-artwork.height)<.001)&&waterAligned;
        coverage.push(artwork.x<=0&&artwork.y<=0&&artwork.x+artwork.width>=viewport.width-.001&&artwork.y+artwork.height>=viewport.height-.001&&backing.width*backing.height<=8_294_400&&cropAligned);
      }
      holder.style.width='600px';holder.style.height='400px';controller.setContext('day',undefined,true);controller.renderer.resize();controller.renderer.draw();
      const before=canvas.toDataURL();
      const corrupt=structuredClone(valleyScene);corrupt.manifest.id='corrupt-valley';corrupt.manifest.assets.depth.sha256='0'.repeat(64);
      const rejected=await controller.load(corrupt);await settle();
      const preserved=before===canvas.toDataURL();
      const originalFetch=window.fetch;let offline=false;
      try{window.fetch=async()=>{throw new TypeError('Synthetic offline source');};offline=await controller.load(meadowScene);}finally{window.fetch=originalFetch;}
      controller.dispose();
      const canvasPrototype=HTMLCanvasElement.prototype,originalContext=canvasPrototype.getContext;
      // Exercise unavailable WebGL through the browser capability boundary.
      canvasPrototype.getContext=function(this:HTMLCanvasElement,type:string,...args:unknown[]){return type==='webgl'||type==='webgl2'||type==='experimental-webgl'?null:originalContext.apply(this,[type,...args] as never);} as typeof originalContext;
      let staticWater=false;
      try{
        controller=new ScenePlaybackController(canvas,(state:{state:string;water:string})=>states.push(state));
        controller.setContext('day',undefined,true);
        await controller.load(lakeScene);await settle();
        staticWater=controller.renderer.waterPresent()&&!controller.renderer.waterAvailable()&&states.at(-1)?.water==='still';
      }finally{controller.dispose();canvasPrototype.getContext=originalContext;}
      return{first,lake,rejected,preserved,offline,staticWater,heldAcrossMidnight,coverage,noPicking};
    }finally{controller.dispose();holder.remove();}
  },instance.checkout);
  expect(result).toEqual({first:true,lake:true,rejected:false,preserved:true,offline:true,staticWater:true,heldAcrossMidnight:true,coverage:[true,true,true,true],noPicking:true});
  await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
});

test('scene-resolution: Native art survives bounded effects and adjacent grading frames',async({ash,instance},testInfo)=>{
  const {page}=ash;
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('[data-scene-status="ready"]')).toHaveCount(1);
  const resolutions=await page.evaluate(async checkout=>{
    const {SceneRenderer}=await import(`/@fs/${checkout}/packages/scenes/src/browser/engine/renderer.js`);
    const {phaseSolarState}=await import(`/@fs/${checkout}/packages/scenes/src/timing.ts`);
    const {DEFAULT_LOCATION}=await import(`/@fs/${checkout}/packages/scenes/src/contracts.ts`);
    const holder=document.createElement('div');holder.style.cssText='position:fixed;left:-10000px;top:0;width:5120px;height:2880px';
    const canvas=document.createElement('canvas');canvas.style.cssText='width:100%;height:100%';holder.append(canvas);document.body.append(holder);
    const results=[];
    try{
      for(const [width,height]of [[2048,2048],[3966,1586]]){
        const artwork=document.createElement('canvas');artwork.width=width;artwork.height=height;const paint=artwork.getContext('2d')!;
        const urls:string[]=[];
        const encoded=async()=>{const blob=await new Promise<Blob>(resolve=>artwork.toBlob(value=>resolve(value!),'image/png'));const url=URL.createObjectURL(blob);urls.push(url);return url;};
        const renderer=new SceneRenderer(canvas);
        try{
          paint.fillStyle='#9dc6dc';paint.fillRect(0,0,width,height);paint.fillStyle='#b5c36b';paint.fillRect(0,height*.4,width,height*.6);
          const patternX=Math.floor(width*.5),patternY=Math.floor(height*.55);
          for(let x=patternX;x<patternX+32;x++){paint.fillStyle=x%2?'#293847':'#d4df8d';paint.fillRect(x,patternY,1,8);}
          const source=await encoded();
          paint.fillStyle='#000';paint.fillRect(0,0,width,height);paint.fillStyle='#fff';paint.fillRect(0,0,width,Math.floor(height*.4));const mask=await encoded();
          paint.fillStyle='rgb(128,128,128)';paint.fillRect(0,0,width,height);paint.fillStyle='#000';paint.fillRect(0,0,width,Math.floor(height*.4));const depth=await encoded();
          paint.fillStyle='rgb(1,1,1)';paint.fillRect(0,0,width,height);paint.fillStyle='rgb(5,5,5)';paint.fillRect(0,0,width,Math.floor(height*.4));paint.fillStyle='rgb(3,3,3)';paint.fillRect(width*.2,height*.7,width*.6,height*.25);const surfaces=await encoded();
          renderer.pause(true);renderer.setSolar(phaseSolarState(Date.now(),DEFAULT_LOCATION,'day'),false);
          const start=performance.now();await renderer.load({width,height,source,candidate:source,mask,depth,surfaces});renderer.set({clouds:false,stars:false});renderer.draw();const startupMs=performance.now()-start;
          const raw=renderer.assets.source.getContext('2d').getImageData(patternX,patternY,2,1).data;
          const graded=renderer.frames[4].getContext('2d').getImageData(patternX,patternY,2,1).data;
          const seenFrames=new Set<HTMLCanvasElement>(),cacheCounts:number[]=[];
          for(const phase of ['day','dusk','night','dawn','day'] as const){
            renderer.setSolar(phaseSolarState(Date.now(),DEFAULT_LOCATION,phase),false);renderer.draw();
            const frames=Object.values(renderer.frames) as HTMLCanvasElement[];frames.forEach(frame=>seenFrames.add(frame));cacheCounts.push(frames.length);
            if(frames.some(frame=>frame.width!==width||frame.height!==height))throw new Error('Artwork grading lost native resolution.');
          }
          const retainedFrames=[...seenFrames].filter(frame=>frame.width>0).length;
          const durations:number[]=[];
          for(let i=0;i<12;i++){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const at=performance.now();renderer.draw();canvas.getContext('2d')!.getImageData(0,0,1,1);durations.push(performance.now()-at);}
          durations.sort((a,b)=>a-b);
          const geometry=renderer.geometry();
          results.push({width,height,native:geometry.nativeArt,effects:geometry.effects,backing:geometry.backing,cacheCounts,retainedFrames,detailPreserved:Math.abs(raw[0]-raw[4])>100&&Math.abs(graded[0]-graded[4])>100,waterPresent:renderer.waterPresent(),startupMs,paintMedianMs:durations[6],paintP95Ms:durations[11]});
        }finally{renderer.dispose();urls.forEach(url=>URL.revokeObjectURL(url));artwork.width=artwork.height=0;}
      }
      return results;
    }finally{holder.remove();}
  },instance.checkout);
  for(const result of resolutions){
    expect(result.native).toEqual({width:result.width,height:result.height});expect(Math.max(result.effects.width,result.effects.height)).toBeLessThanOrEqual(1600);
    expect(result.backing).toEqual({width:3840,height:2160});expect(result.cacheCounts).toEqual([2,2,2,2,2]);expect(result.retainedFrames).toBe(2);expect(result.detailPreserved).toBe(true);expect(result.waterPresent).toBe(true);
  }
  const waterRefresh=await page.evaluate(async checkout=>{
    const {WaterRenderer}=await import(`/@fs/${checkout}/packages/scenes/src/browser/engine/water-renderer.js`);
    const water=new WaterRenderer(),width=64,height=32,pixels=new Uint8ClampedArray(width*height*4).fill(255);
    const art=(color:string)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d')!;context.fillStyle=color;context.fillRect(0,0,width,height);return canvas;};
    const preview=art('#ff0000'),native=art('#0000ff'),settings={daylight:100,lift:false,waterPosition:0,waterStrength:0,waterReflections:0};
    try{
      water.load({x:0,y:0,width,height,sourceWidth:width,sourceHeight:height,pixels});
      const sample=(frames:HTMLCanvasElement[])=>{water.draw(frames,preview,null,settings,0,0,[[0,0,0],[0,0,0],[0,0,0]],.5);const value=new Uint8Array(4);water.gl.readPixels(1,1,1,1,water.gl.RGBA,water.gl.UNSIGNED_BYTE,value);return [...value];};
      return {preview:sample([preview,preview]),native:sample([native,native])};
    }finally{water.dispose();preview.width=preview.height=native.width=native.height=0;}
  },instance.checkout);
  expect(waterRefresh.preview).toEqual([255,0,0,255]);expect(waterRefresh.native).toEqual([0,0,255,255]);
  const performancePath=testInfo.outputPath('native-art-performance.json');
  await writeFile(performancePath,JSON.stringify(resolutions,null,2));
  await testInfo.attach('native-art-performance',{path:performancePath,contentType:'application/json'});
});
