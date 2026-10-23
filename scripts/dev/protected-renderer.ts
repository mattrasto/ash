import {mkdir,writeFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {exec,childEnvironment} from './io.ts';
import {build} from 'esbuild';
import {sceneBrowserPaths} from './renderer-config.ts';

/** Candidate text is compiler input, never Node code. Restrict reads in Vite's
 * asset transforms too; those do not pass through its module-loading hooks. */
export async function buildProtectedRenderer(candidate:string,output:string,trusted:string){
  await mkdir(output,{recursive:true,mode:0o700});
  [candidate,output,trusted]=await Promise.all([realpath(candidate),realpath(output),realpath(trusted)]);
  const worker=join(output,'compiler.mjs');
  await build({entryPoints:[join(trusted,'scripts/dev/protected-renderer-worker.ts')],outfile:worker,bundle:true,format:'esm',platform:'node',logLevel:'silent',plugins:[{
    name:'trusted-compiler-dependencies',setup(plugin){plugin.onResolve({filter:/^[^./]/},async args=>{
      if(args.pluginData?.trustedResolution)return;
      if(args.path.startsWith('node:'))return {path:args.path,external:true};
      const resolved=await plugin.resolve(args.path,{resolveDir:trusted,kind:'import-statement',pluginData:{trustedResolution:true}});
      return {...resolved,external:true};
    });},
  }]});
  const reads=[candidate,join(trusted,'node_modules'),join(trusted,'packages/client/node_modules'),join(trusted,'packages/shared'),...sceneBrowserPaths(trusted),output,
    join(trusted,'package.json'),join(trusted,'tsconfig.json')];
  try{
    await exec(process.execPath,[Number(process.versions.node.split('.')[0])>=23?'--permission':'--experimental-permission','--allow-child-process','--allow-addons',
      ...reads.map(path=>'--allow-fs-read='+path),'--allow-fs-write='+output,worker,candidate,output,trusted],{
      cwd:trusted,env:{...childEnvironment(output),TSX_DISABLE_CACHE:'1'},timeout:60000,maxBuffer:2*1024*1024,
    });
  }catch(error){
    const result=error as {stdout?:string;stderr?:string};
    await writeFile(join(output,'compiler.log'),((result.stdout??'')+'\n'+(result.stderr??'')).slice(0,32000),{mode:0o600});
    throw Error('Protected renderer compilation failed. Imports and assets must stay inside the renderer, shared contracts, scene playback and trusted dependencies.');
  }
}
