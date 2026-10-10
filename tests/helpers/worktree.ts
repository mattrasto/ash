import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { exec } from '../../scripts/dev/io.ts';

export async function makeWorktree(source:string,path:string) {
  await exec('git',['worktree','add','--detach',path,'HEAD'],{cwd:source});
  const {stdout}=await exec('git',['ls-files','-co','--exclude-standard','-z'],{cwd:source});
  // Include in-progress source, never developer credentials or ignored local state.
  for (const file of new Set(stdout.split('\0').filter(p=>/^(packages\/|scripts\/|tests\/|package.json$|pnpm-lock.yaml$|pnpm-workspace.yaml$|tsconfig.json$|compose.yaml$|\.npmrc$|\.gitignore$)/.test(p)))) {
    await mkdir(dirname(join(path,file)),{recursive:true});
    await copyFile(join(source,file),join(path,file));
  }
  await exec('pnpm',['install','--offline','--frozen-lockfile','--prod=false'],{cwd:path,timeout:120000});
}
