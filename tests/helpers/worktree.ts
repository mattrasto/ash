import { measure, recordResource } from '../../scripts/dev/telemetry.ts';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { exec, id } from '../../scripts/dev/io.ts';

export async function makeWorktree(source:string,path:string) {
  return measure('checkout.prepare', async () => {
    await exec('git',['worktree','add','--detach',path,'HEAD'],{cwd:source});
    recordResource('checkouts', id(), {source,checkout:path});
    const {stdout}=await exec('git',['ls-files','-co','--exclude-standard','-z'],{cwd:source});
    const {stdout:deleted}=await exec('git',['diff','--name-only','--diff-filter=D','-z','HEAD'],{cwd:source});
    // Include in-progress source, never developer credentials or ignored local state.
    for (const file of new Set((stdout+deleted).split('\0').filter(p=>/^(packages\/|scripts\/|tests\/|specs\/data\/|package.json$|pnpm-lock.yaml$|pnpm-workspace.yaml$|tsconfig.json$|compose.yaml$|\.npmrc$|\.gitignore$)/.test(p)))) {
      await mkdir(dirname(join(path,file)),{recursive:true});
      try { await copyFile(join(source,file),join(path,file)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await rm(join(path,file),{force:true});
      }
    }
    await measure('dependencies.install', () => exec('pnpm',['install','--offline','--frozen-lockfile','--prod=false'],{cwd:path,timeout:120000}));
  });
}
