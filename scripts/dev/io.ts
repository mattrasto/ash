import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, lstat, realpath, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const exec = promisify(execFile);
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const id = () => randomBytes(12).toString('hex');
export const secret = () => randomBytes(32).toString('hex');
export async function json<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')); }
export async function exists(path: string) { try { await lstat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
export async function atomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${id()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
}
export interface ProcessRef { pid: number; identity: string }
export async function processIdentity(pid: number): Promise<string | null> {
  if (!Number.isSafeInteger(pid) || pid < 2) return null;
  try { const { stdout } = await exec('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command=']); return stdout.trim() || null; }
  catch (error) {
    if ((error as {code?: unknown}).code === 1 && !(error as {stderr?: string}).stderr?.trim()) return null;
    throw new Error('Cannot inspect process ownership with ps; no process will be stopped');
  }
}
export async function processRef(pid: number): Promise<ProcessRef> {
  const identity = await processIdentity(pid);
  if (!identity) throw new Error(`Process ${pid} exited before registration`);
  return { pid, identity };
}
export async function alive(ref: ProcessRef) { return await processIdentity(ref.pid) === ref.identity; }
export async function stopProcess(ref: ProcessRef, group = false) {
  if (!await alive(ref)) return;
  try { process.kill(group ? -ref.pid : ref.pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 30 && await alive(ref); i++) await sleep(100);
  if (await alive(ref)) { try { process.kill(group ? -ref.pid : ref.pid, 'SIGKILL'); } catch {} }
}
export async function withLock<T>(root: string, name: string, action: () => Promise<T>): Promise<T> {
  const path = join(root, 'locks', name);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 90_000;
  while (true) {
    try { await mkdir(path, { mode: 0o700 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Serialize stale-lock recovery so two waiters cannot delete a new owner's lock.
      const recovery = `${path}.recovery`;
      let recovering = false;
      try { await mkdir(recovery); recovering = true; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      if (recovering) {
        try {
          try {
            const owner = await json<ProcessRef>(join(path, 'owner.json'));
            if (!await alive(owner)) await rm(path, { recursive: true, force: true });
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
            if (Date.now() - (await stat(path).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs > 30_000) await rm(path, { recursive: true, force: true });
          }
        } finally { await rm(recovery, {recursive:true,force:true}); }
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${name}`);
      await sleep(100);
    }
  }
  const owner = await processRef(process.pid);
  await atomic(join(path, 'owner.json'), owner);
  try { return await action(); } finally { await rm(path, { recursive: true, force: true }); }
}
export async function guardedPath(root: string, path: string) {
  const canonicalRoot = await realpath(root);
  const rel = relative(canonicalRoot, resolve(path));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Refusing path outside owned development state');
  let current = canonicalRoot;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if (await exists(current) && (await lstat(current)).isSymbolicLink()) throw new Error('Refusing symlink in development resource path');
  }
}
export async function devRoot(value = process.env.ASH_DEV_ROOT ?? join(homedir(), '.ash-dev')) {
  const path = resolve(value);
  if (path === homedir() || path === '/' || path === process.cwd()) throw new Error('Unsafe development root');
  await mkdir(path, { recursive: true, mode: 0o700 });
  const root = await realpath(path);
  await withLock(root, 'root', async () => {
    const marker = join(root, 'owner.json');
    if (!await exists(marker)) {
      if ((await readdir(root)).some(p => p !== 'locks')) throw new Error('Development root is nonempty and has no Ash ownership marker');
      await atomic(marker, { application: 'ash-development', version: 1, id: id() });
    }
    const data = await json<{ application: string; version: number }>(marker);
    if (data.application !== 'ash-development' || data.version !== 1) throw new Error('Invalid development root marker');
  });
  return root;
}
export function assertEnvironment() {
  for (const key of ['DATABASE_URL', 'ASHA_HOME', 'ASHA_SERVER_PORT', 'ASHA_SERVER_URL', 'ASH_HOME', 'ASH_SERVER_PORT', 'ASH_SERVER_URL']) {
    if (process.env[key]) throw new Error(`Unset ${key}; development connections and paths come from the instance manifest`);
  }
}
export function childEnvironment(tmp: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'DISPLAY', '__CF_USER_TEXT_ENCODING']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.TMPDIR = tmp;
  return env;
}
export async function fingerprint(checkout: string) {
  const { stdout } = await exec('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: checkout });
  const files = [...new Set(stdout.split('\0').filter(p => /^(packages\/|scripts\/|tests\/|specs\/|docs\/|\.codex\/|AGENTS.md$|package.json$|pnpm-lock.yaml$|pnpm-workspace.yaml$|tsconfig.json$|compose.yaml$|\.npmrc$)/.test(p)))].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    let bytes: Buffer;
    try { bytes = await readFile(join(checkout, file)); }
    catch (error) {
      // Git still lists tracked files deleted in the working tree until they are staged.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    hash.update(`${file}\0`); hash.update(bytes); hash.update('\0');
  }
  const { stdout: head } = await exec('git', ['rev-parse', 'HEAD'], { cwd: checkout });
  return { commit: head.trim(), hash: hash.digest('hex'), lockfileHash: createHash('sha256').update(await readFile(join(checkout, 'pnpm-lock.yaml'))).digest('hex') };
}
