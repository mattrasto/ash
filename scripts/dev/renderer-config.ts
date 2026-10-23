import {transformWithEsbuild,type InlineConfig} from 'vite';
import {svelte,vitePreprocess} from '@sveltejs/vite-plugin-svelte';
import {realpathSync,existsSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';

export function rendererConfig(checkout: string, output: string, trustedCheckout?:string): InlineConfig {
  const tsconfigRaw=JSON.stringify({compilerOptions:{target:'ES2022',useDefineForClassFields:true,verbatimModuleSyntax:true}});
  const preprocess=trustedCheckout?{name:'ash-protected-typescript',script:async({content,attributes,filename}:{content:string;attributes:Record<string,string|boolean>;filename?:string})=>attributes.lang==='ts'?transformWithEsbuild(content,filename??'component.ts',{loader:'ts',target:'esnext',tsconfigRaw}):undefined}:vitePreprocess({script:true});
  return {
    configFile: false, root: join(checkout, 'packages/client'), envFile:false,...(trustedCheckout?{publicDir:false,esbuild:{tsconfigRaw},css:{postcss:{plugins:[]}},server:{fs:{allow:[join(checkout,'packages/client/src/renderer')]}}}:{}),plugins: [...(trustedCheckout?[rendererBoundary(checkout,trustedCheckout,output)]:[]),svelte({ configFile:false,preprocess })],
    cacheDir: join(output, 'vite-cache'), logLevel: 'warn',
    resolve: { conditions: ['browser', 'module', 'import', 'default'] },
    build: { outDir: join(output, 'renderer'), emptyOutDir: true },
  };
}
/** Applies before Vite's filesystem loader, including transitive imports and ?raw. */
function rendererBoundary(candidate:string,trusted:string,output:string):import('vite').Plugin {
  const roots=[join(candidate,'packages/client/src/renderer'),join(trusted,'node_modules'),join(trusted,'packages/shared'),join(output,'vite-cache')].map(path=>existsSync(path)?realpathSync(path):resolve(path));
  const index=join(candidate,'packages/client/index.html');
  return {name:'ash-renderer-preview-boundary',enforce:'pre',configureServer(server){
    server.middlewares.use((request,response,next)=>{
      if(request.url?.includes('__open-in-editor')){response.writeHead(403).end('Editor control unavailable in renderer previews.');return;}
      next();
    });
  },load(id){
    const path=id.split('?')[0];
    if(path.startsWith('/')&&existsSync(path)){
      const canonical=realpathSync(path);
      if(canonical!==index&&!roots.some(root=>canonical===root||canonical.startsWith(root+sep)))throw new Error('Preview import outside the renderer boundary.');
    }
    return null;
  }};
}
