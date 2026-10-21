import type { SavePermission } from '@ash/shared';
import { createHash } from 'node:crypto';
export const secretsPermissionId='a5a00000-0000-4000-8000-000000000005';

// Insert once. User edits and removals survive startup; IDs are permanent.
export const defaultPermissions:readonly SavePermission[]=[
  {id:'a5a00000-0000-4000-8000-000000000001',category:'interaction',effect:'allow',policy:{kind:'explicit',verb:'prepare',resource:{type:'drafts'}}},
  {id:'a5a00000-0000-4000-8000-000000000002',category:'interaction',effect:'ask',policy:{kind:'explicit',verb:'send',resource:{type:'messages'}}},
  {id:'a5a00000-0000-4000-8000-000000000003',category:'interaction',effect:'ask',policy:{kind:'explicit',verb:'publish',resource:{type:'public_content'}}},
  {id:'a5a00000-0000-4000-8000-000000000004',category:'computer_use',effect:'allow',policy:{kind:'explicit',verb:'use',resource:{type:'computer'}}},
  {id:secretsPermissionId,category:'filesystem',effect:'deny',policy:{kind:'semantic',condition:'Read passwords, API tokens, private keys, recovery codes, or other secret values.',examples:['Reading a known API token or private key is covered, regardless of its filename.','Listing filenames or reading code that references an environment variable without revealing its secret value is not covered.'],overrides:[]}},
  ...['.env*','*.pem','*.key'].map((name,index):SavePermission=>({id:`a5a00000-0000-4000-8000-00000000000${index+6}`,category:'filesystem',effect:'deny',policy:{kind:'explicit',verb:'read',resource:{type:'filesystem',path:'/',scope:'subtree',pattern:`./**/${name}`}}})),
];
export const codeReadOperations=['list','read','glob','search'] as const;
export const previousCodeExcludedNames=['.git','.ash-dev','node_modules','out','.env*','*.pem','*.key'] as const;
export const codeExcludedNames=[] as const;
export type FilesystemScope={path:string;operations:(typeof codeReadOperations)[number][];excludedNames:string[]};
export function codeFilesystemScope(path:string):FilesystemScope{return {path,operations:[...codeReadOperations],excludedNames:[...codeExcludedNames]};}
export function permissionId(value:unknown){const key=createHash('sha256').update(JSON.stringify(value)).digest('hex');return `${key.slice(0,8)}-${key.slice(8,12)}-4${key.slice(13,16)}-8${key.slice(17,20)}-${key.slice(20,32)}`;}
export const filesystemId=(path:string)=>permissionId({filesystemScope:path});
const verbs={read:'read_file',list:'list',glob:'glob',search:'search'} as const;
export function filesystemPermissions(scope:FilesystemScope):SavePermission[]{
  const base={category:'filesystem' as const,policy:{kind:'explicit' as const,verb:'read' as const,resource:{type:'filesystem' as const,path:scope.path,scope:'subtree' as const}}};
  const full=scope.operations.length===4||!scope.operations.length;
  const rules:SavePermission[]=full?[{...base,id:filesystemId(scope.path),effect:scope.operations.length?'allow':'deny'}]
    :(['read','list','glob','search'] as const).map((operation,i)=>({...base,id:i===0?filesystemId(scope.path):permissionId({filesystemScope:scope.path,operation}),effect:scope.operations.includes(operation)?'allow':'deny',policy:{...base.policy,verb:verbs[operation]}}));
  return [...rules,...scope.excludedNames.map(pattern=>({...base,id:permissionId({filesystemScope:scope.path,exclusion:pattern}),effect:'deny' as const,policy:{...base.policy,resource:{...base.policy.resource,pattern}}}))];
}
