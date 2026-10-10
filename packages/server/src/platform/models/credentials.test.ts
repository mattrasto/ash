import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readOpenAIKey } from './credentials.ts';

test('local credentials parse quotes/comments without populating the process environment',async t=>{
  const checkout=await mkdtemp(join(tmpdir(),'ash-credentials-'));
  t.after(()=>rm(checkout,{recursive:true,force:true}));
  const before={...process.env};
  await writeFile(join(checkout,'.env.local'),'# Development key\nOPENAI_API_KEY="synthetic-private-key" # comment\nVITE_PRIVATE_KEY=must-not-load\nNODE_OPTIONS=must-not-load\nDATABASE_URL=must-not-load\n',{mode:0o600});
  assert.equal(await readOpenAIKey(checkout),'synthetic-private-key');
  assert.ok(isDeepStrictEqual({...process.env},before),'Credential loading must not change environment variables');
});

test('missing, blank, multiline, exposed and symlinked credential files fail without revealing values',async t=>{
  const checkout=await mkdtemp(join(tmpdir(),'ash-credentials-'));
  t.after(()=>rm(checkout,{recursive:true,force:true}));
  const path=join(checkout,'.env.local');
  const inherited=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='synthetic-inherited-key';
  t.after(()=>{if(inherited===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=inherited;});
  await assert.rejects(readOpenAIKey(checkout),/Create .env.local/);
  for(const content of ['OPENAI_API_KEY=','OTHER_KEY=synthetic-private-key','OPENAI_API_KEY="synthetic-private-key\nsecond-line"']) {
    await writeFile(path,content,{mode:0o600});
    await assert.rejects(readOpenAIKey(checkout),error=>error instanceof Error && /nonempty, single-line/.test(error.message) && !error.message.includes('synthetic'));
  }
  await writeFile(path,'OPENAI_API_KEY=synthetic-private-key');
  await chmod(path,0o644);
  await assert.rejects(readOpenAIKey(checkout),/owner-only permissions/);
  await rm(path);
  const target=join(checkout,'key');
  await writeFile(target,'OPENAI_API_KEY=synthetic-private-key',{mode:0o600});
  await symlink(target,path);
  await assert.rejects(readOpenAIKey(checkout),/Create .env.local/);
});
