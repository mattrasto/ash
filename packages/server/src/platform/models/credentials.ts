import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

// Read only the selected key; never load the file into process.env or expose its contents in errors.
export async function readOpenAIKey(checkout: string): Promise<string> {
  return readProviderKey(checkout,'OPENAI_API_KEY');
}
export async function readGeminiKey(checkout:string):Promise<string>{return readProviderKey(checkout,'GEMINI_API_KEY');}
async function readProviderKey(checkout:string,name:'OPENAI_API_KEY'|'GEMINI_API_KEY'):Promise<string>{
  const file = await open(join(checkout,'.env.local'),constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => {
    throw new Error('Create .env.local in this checkout with '+name+' and run chmod 600 .env.local.');
  });
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('.env.local must be a regular file with owner-only permissions; run chmod 600 .env.local.');
    let key: string | undefined;
    try { key = parseEnv(await file.readFile('utf8'))[name]?.trim(); }
    catch { throw new Error('Could not parse .env.local. Check its '+name+' entry.'); }
    if (!key || /[\r\n]/.test(key)) throw new Error('Set a nonempty, single-line '+name+' in .env.local.');
    return key;
  } finally { await file.close(); }
}
