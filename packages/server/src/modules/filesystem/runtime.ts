import { constants } from 'node:fs';
import { open, opendir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ToolAction, ToolAuthorization, ToolReference, ToolResult, ToolJson } from '@ash/shared';
import { registerTool, toolCitationId, ToolActionFailure, type ToolAvailability, type ToolContext, type ToolRuntime } from '../tools/contract.ts';

export const FilesystemOperation = z.enum(['list', 'read', 'glob', 'search']);
type Operation = z.infer<typeof FilesystemOperation>;
export const FilesystemConfig = z.object({
  version: z.literal(1),
  scopes: z.array(z.object({ path: z.string().min(1).max(4096), operations: z.array(FilesystemOperation),
    excludedNames: z.array(z.string().min(1).max(256)).default([]),
  }).strict()).max(64),
}).strict();
export type FilesystemConfig = z.infer<typeof FilesystemConfig>;
export class FilesystemFailure extends ToolActionFailure {
  constructor(code: string, message: string) { super(code, message, code === 'access_denied'); }
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const inside = (root: string, path: string) => path === root || path.startsWith(root + (root.endsWith(sep) ? '' : sep));
const operations: Operation[] = ['list', 'read', 'glob', 'search'];

// Bounded wildcard matching: no regex engine or nested expansion. ** crosses directories.
export function globMatch(pattern: string, value: string): boolean {
  let previous = new Uint8Array(value.length + 1); previous[0] = 1;
  for (let p = 0; p < pattern.length; p++) {
    const character = pattern[p], double = character === '*' && pattern[p + 1] === '*';
    if (double) p++;
    if (double && pattern[p + 1] === '/') {
      // **/ consumes zero or more complete directories, including in the middle of a pattern.
      const current = previous.slice();
      let reachable = false;
      for (let i = 1; i <= value.length; i++) {
        reachable ||= !!previous[i - 1];
        if (reachable && value[i - 1] === '/') current[i] = 1;
      }
      previous = current; p++; continue;
    }
    const current = new Uint8Array(value.length + 1);
    if (character === '*') current[0] = previous[0];
    for (let i = 1; i <= value.length; i++) {
      const allowed = double || value[i - 1] !== '/';
      current[i] = character === '*' ? Number(!!previous[i] || (!!current[i - 1] && allowed))
        : Number(!!previous[i - 1] && (character === '?' ? allowed : character === value[i - 1]));
    }
    previous = current;
  }
  return !!previous[value.length];
}

export async function loadFilesystemConfig(checkout: string): Promise<FilesystemConfig> {
  try {
    const file = await open(join(checkout, '.ash-tools.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if ((await file.stat()).size > 32768) throw new Error('Oversized configuration');
      return FilesystemConfig.parse(JSON.parse(await file.readFile('utf8')));
    } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, scopes: [] };
    throw new FilesystemFailure('scope_configuration', 'Filesystem configuration is invalid; access is disabled.');
  }
}

function validatePath(path: string) {
  if (!isAbsolute(path) || path.includes('\0') || path.includes('\\'))
    throw new FilesystemFailure('invalid_path', 'Use an absolute filesystem path without NUL or alternate separators.');
}
function action(operation: Operation, path: string): ToolAction {
  return { operation: `filesystem.${operation}`, effects: ['read'], resources: [{ kind: 'filesystem', id: path, label: path }] };
}
async function allowed(context: ToolContext, operation: Operation, path: string) {
  context.signal.throwIfAborted();
  const decision = await context.authorize(action(operation, path));
  if (decision.outcome !== 'allowed') throw new FilesystemFailure('access_denied', decision.message);
}

export function filesystemRuntime(configuration: () => Promise<FilesystemConfig>): ToolRuntime {
  const configurationIssue = { code: 'scope_configuration', message: 'Filesystem tools are unavailable. Fix .ash-tools.json: use valid operations and existing canonical scope paths.' };
  async function config() {
    const parsed = FilesystemConfig.parse(await configuration());
    const seen = new Set<string>();
    for (const scope of parsed.scopes) {
      validatePath(scope.path); scope.path = resolve(scope.path);
      if (seen.has(scope.path) || new Set(scope.operations).size !== scope.operations.length)
        throw new FilesystemFailure('scope_configuration', 'Filesystem scopes must be unambiguous.');
      seen.add(scope.path);
      // Configuration names canonical resources, not aliases that may later be redirected.
      if (await realpath(scope.path) !== scope.path) throw new FilesystemFailure('scope_configuration', 'Configure canonical filesystem scope paths.');
    }
    return parsed;
  }
  async function authorize(proposal: ToolAction): Promise<ToolAuthorization> {
    let settings: FilesystemConfig;
    try { settings = await config(); }
    catch { return { outcome: 'denied', ...configurationIssue, configurationRevision: 'unavailable', evaluator: 'not-performed' }; }
    const configurationRevision = hash(JSON.stringify(settings));
    const deny = (): ToolAuthorization => ({ outcome: 'denied', code: 'outside_scope', message: 'This action is outside the configured filesystem access.', configurationRevision, evaluator: 'not-performed' });
    const operation = proposal.operation.replace('filesystem.', '') as Operation;
    if (!operations.includes(operation) || proposal.effects.some(effect => effect !== 'read') || !proposal.resources.length) return deny();
    for (const resource of proposal.resources) {
      if (resource.kind !== 'filesystem') return deny();
      validatePath(resource.id);
      const lexical = resolve(resource.id);
      const check = (path: string) => {
        const scopes = settings.scopes.filter(scope => inside(scope.path, path)).sort((a, b) => b.path.length - a.path.length);
        if (!scopes[0]?.operations.includes(operation)) return false;
        return !scopes.some(scope => relative(scope.path, path).split(sep).some(name => scope.excludedNames.some(pattern => globMatch(pattern, name))));
      };
      if (!check(lexical)) return deny();
      // The lexical check prevents probing outside paths before canonical resolution.
      const canonical = await realpath(lexical);
      if (!check(canonical)) return deny();
    }
    return { outcome: 'allowed', code: 'configured_scope', message: 'Covered by configured filesystem access.', configurationRevision, evaluator: 'not-performed' };
  }
  const definitions = operations.map(operation => {
    const shape: z.ZodRawShape = operation === 'read' ? { path: z.string().max(4096), startLine: z.number().int().min(1).max(1000000), maxLines: z.number().int().min(1).max(500) }
      : operation === 'glob' ? { path: z.string().max(4096), pattern: z.string().min(1).max(256) }
      : operation === 'search' ? { path: z.string().max(4096), query: z.string().min(1).max(256), pattern: z.string().max(256).nullable() }
      : { path: z.string().max(4096) };
    const schema = z.object({ ...shape, path: z.string().min(1).max(4096) }).strict();
    const properties: Record<string, ToolJson> = operation === 'read' ? { path: { type: 'string' }, startLine: { type: 'integer', minimum: 1, maximum: 1000000 }, maxLines: { type: 'integer', minimum: 1, maximum: 500 } }
      : operation === 'glob' ? { path: { type: 'string' }, pattern: { type: 'string' } }
      : operation === 'search' ? { path: { type: 'string' }, query: { type: 'string' }, pattern: { type: ['string', 'null'] } }
      : { path: { type: 'string' } };
    return registerTool({
      definition: { name: `filesystem.${operation}`, version: 1,
        description: `${operation === 'list' ? 'List directory entries' : operation === 'read' ? 'Read a text excerpt with line numbers' : operation === 'glob' ? 'Find paths using *, ** and ? patterns' : 'Search literal text, optionally filtered by a path pattern'}. Use an absolute path in an available scope. Locate short filenames before asking; clarify ambiguous matches. Results are current observations, not a shared snapshot. Cite returned reference IDs. Limits: 1 MiB/file, 5000 entries, 32 MiB scanned, 500 entries or 200 matches.`,
        inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
        effects: ['read'], concurrency: 'independent', repeatability: 'safe', limits: { timeoutMs: 5000, resultBytes: 32768 },
      },
      parse: input => schema.parse(input),
      async prepare(args) { validatePath(args.path); return { args, action: action(operation, resolve(args.path)) }; },
      async execute(prepared, context) {
        const path = prepared.action.resources[0].id;
        const omissions = new Set<string>(), rows: string[] = [], references: ToolReference[] = [];
        let entries = 0, scanned = 0, resultBytes = 0;
        const add = (text: string, reference?: ToolReference) => {
          const bytes = Buffer.byteLength(text) + (reference ? Buffer.byteLength(JSON.stringify({ ...reference, citationId: toolCitationId(context.callId, references.length) })) : 0) + 256;
          if (resultBytes + bytes > 29000) { omissions.add('Result byte limit reached. Narrow the request.'); return false; }
          rows.push(text); if (reference) references.push(reference); resultBytes += bytes; return true;
        };
        const read = async (target: string) => {
          await allowed(context, operation, target);
          const canonical = await realpath(target), before = await stat(canonical);
          if (!before.isFile()) throw new FilesystemFailure('unsupported_file', 'Only ordinary text files are readable.');
          // No final symlink, and compare descriptor/target identities before exposing any bytes.
          const file = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const opened = await file.stat();
            if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino)
              throw new FilesystemFailure('source_changed', 'The file changed while opening. Retry the read.');
            await allowed(context, operation, target);
            if (await realpath(target) !== canonical) throw new FilesystemFailure('source_changed', 'The file target changed.');
            const buffer = Buffer.alloc(Math.min(opened.size, 1048576, 33554432 - scanned));
            let offset = 0;
            while (offset < buffer.length) {
              context.signal.throwIfAborted();
              const count = (await file.read(buffer, offset, buffer.length - offset, offset)).bytesRead;
              if (!count) break; offset += count;
            }
            const after = await file.stat(), current = await stat(canonical);
            await allowed(context, operation, target);
            if (await realpath(target) !== canonical || current.ino !== opened.ino || current.dev !== opened.dev || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs)
              throw new FilesystemFailure('source_changed', 'The file changed during reading. No content was returned.');
            scanned += offset;
            const content = buffer.subarray(0, offset);
            if (content.includes(0)) throw new FilesystemFailure('unsupported_file', 'Binary files are skipped.');
            let text: string;
            const truncated = opened.size > content.length;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(content, { stream: truncated }); }
            catch { throw new FilesystemFailure('unsupported_file', 'Only UTF-8 text is supported.'); }
            if (truncated) omissions.add('A file or cumulative scan byte limit was reached; later content was not searched or read.');
            return { canonical, text, identity: `${opened.dev}:${opened.ino}`, observedAt: new Date().toISOString() };
          } finally { await file.close(); }
        };
        const ref = (file: Awaited<ReturnType<typeof read>>, text: string, startLine: number, endLine: number): ToolReference => ({
          kind: 'filesystem', id: `${context.callId}:${references.length + 1}`, label: `${file.canonical}:${startLine}-${endLine}`,
          observedAt: file.observedAt, contentHash: hash(text), location: { path: file.canonical, fileIdentity: file.identity, startLine, endLine, hashScope: 'returned-excerpt' },
        });
        if (operation === 'read') {
          const args = prepared.args as { path: string; startLine: number; maxLines: number };
          const file = await read(path), lines = file.text.split('\n');
          const selected: string[] = []; let bytes = 0;
          for (const line of lines.slice(args.startLine - 1, args.startLine - 1 + args.maxLines)) {
            if (bytes + Buffer.byteLength(line) > 20000) { omissions.add('Excerpt byte limit reached.'); break; }
            selected.push(line); bytes += Buffer.byteLength(line) + 1;
          }
          const text = selected.join('\n');
          if (selected.length) add(selected.map((line, i) => `${args.startLine + i}: ${line}`).join('\n'), ref(file, text, args.startLine, args.startLine + selected.length - 1));
          if (args.startLine - 1 + selected.length < lines.length) omissions.add('Excerpt returned; later lines omitted.');
        } else {
          const visited = new Set<string>();
          const walk = async (directory: string, root?: string): Promise<void> => {
            context.signal.throwIfAborted();
            await allowed(context, operation, directory);
            const canonical = await realpath(directory);
            const traversalRoot = root ?? canonical;
            if (visited.has(canonical)) return; visited.add(canonical);
            const directoryIdentity = await stat(canonical);
            const handle = await opendir(canonical);
            try {
              for await (const entry of handle) {
                context.signal.throwIfAborted();
                const current = await stat(canonical);
                if (await realpath(directory) !== canonical || current.ino !== directoryIdentity.ino || current.dev !== directoryIdentity.dev)
                  throw new FilesystemFailure('source_changed', 'A directory changed during traversal.');
                await allowed(context, operation, directory);
                if (++entries > 5000 || scanned >= 33554432 || rows.length >= (operation === 'search' ? 200 : 500) || resultBytes >= 28000) { omissions.add('Traversal or result limit reached. Narrow the request.'); return; }
                const target = join(canonical, entry.name);
                try {
                  await allowed(context, operation, target);
                  const info = await stat(target), relativePath = relative(traversalRoot, target).split(sep).join('/');
                  if (operation === 'list') { if (!add(`${info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'unsupported'} ${target}`)) return; continue; }
                  if (info.isDirectory()) { await walk(target, traversalRoot); continue; }
                  const args = prepared.args as { pattern?: string | null; query?: string };
                  if (args.pattern && !globMatch(args.pattern, relativePath)) continue;
                  if (operation === 'glob') { if (!add(target)) return; continue; }
                  if (!info.isFile()) { omissions.add('Non-regular files were skipped.'); continue; }
                  const file = await read(target);
                  const lines = file.text.split('\n');
                  for (let i = 0; i < lines.length; i++) if (lines[i].includes(args.query!)) {
                    if (rows.length >= 200 || !add(`${file.canonical}:${i + 1}: ${lines[i]}`, ref(file, lines[i], i + 1, i + 1))) { omissions.add('Match limit reached.'); return; }
                  }
                } catch (error) {
                  context.signal.throwIfAborted();
                  if ((error as {code?:string}).code === 'access_evidence_limit') throw error;
                  omissions.add(error instanceof FilesystemFailure && error.code === 'access_denied' ? 'Entries outside configured access were omitted.' : 'Unreadable, changed or unsupported entries were omitted.');
                }
              }
            } finally { await handle.close().catch(() => {}); }
          };
          await walk(path);
        }
        return { status: 'success', content: [{ type: 'text', text: rows.join('\n') }], references, omissions: [...omissions] } satisfies ToolResult;
      },
    });
  });
  async function availability(): Promise<ToolAvailability> {
    try {
      const resources = (await config()).scopes.filter(scope => scope.operations.length).map(scope => ({ kind: 'filesystem', id: scope.path, label: `${scope.path} (${scope.operations.join(', ')})` }));
      return { definitions: resources.length ? definitions.map(tool => tool.definition) : [], resources, issues: [] };
    } catch { return { definitions: [], resources: [], issues: [configurationIssue] }; }
  }
  return { tools: definitions, authorize, availability,
    async resources() { return (await availability()).resources; },
  };
}
