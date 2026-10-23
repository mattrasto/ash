import {readdir,readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {git} from '../../packages/server/src/modules/adapt/source.ts';

/** Trusted compiler input boundary, shared by preview and local release preparation. */
export async function prepareRenderer(candidate:string,baseTree:string,trusted:string){
        const changes=await git(candidate,['diff','--cached','--raw','--no-renames',baseTree]);
        for(const line of changes.split('\n').filter(Boolean)){
          const [header,path]=line.split('\t'),[before,after]=header.slice(1).split(' ');
          if(!path?.startsWith('packages/client/src/renderer/')||/(^|\/)(?:package\.json|(?:ts|js)config(?:\.[^/]*)?\.json|\.env(?:\.[^/]*)?|(?:vite|svelte|postcss)\.config\.[^/]+)$/.test(path)||![before,after].every(mode=>['100644','000000'].includes(mode)))throw new Error('UI preview accepts only ordinary files under packages/client/src/renderer/. Backend, native, dependency and configuration changes require another preview environment.');
        }
        // Vite's CSS/glob preprocessors can read files before ordinary module loading.
        // This slice supports plain CSS and explicit imports; keep those alternate
        // filesystem expansion paths closed until a compiler sandbox supports them.
        const inspect=async(path:string):Promise<void>=>{
          for(const entry of await readdir(path,{withFileTypes:true})){
            const file=join(path,entry.name);if(entry.isSymbolicLink())throw new Error('Renderer preview does not accept symlinks.');
            if(entry.isDirectory())await inspect(file);
            else if(/\.(svelte|css|[cm]?[jt]sx?)$/.test(entry.name)){
              const text=await readFile(file,'utf8');
              const styleLanguages=[...text.matchAll(/<style\b[^>]*\blang\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)];
              if(/@(?:import|use|forward)\b|import\s*\.\s*meta\s*\.\s*glob/i.test(text)||styleLanguages.some(match=>(match[1]??match[2]??match[3])!=='css'))throw new Error('Renderer preview supports plain CSS and explicit imports. CSS imports, preprocessors and import.meta.glob require another preview environment.');
            }
          }
        };await inspect(join(candidate,'packages/client/src/renderer'));
        // Ignore all candidate manifests/configuration. Only the renderer and trusted dependencies resolve.
        for(const [link,target] of [[join(candidate,'node_modules'),join(trusted,'node_modules')],[join(candidate,'packages/client/node_modules'),join(trusted,'packages/client/node_modules')],[join(candidate,'packages/shared'),join(trusted,'packages/shared')]]){
          await rm(link,{recursive:true,force:true});await symlink(target,link,'dir');
        }
}
