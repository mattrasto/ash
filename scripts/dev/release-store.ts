import {createHash} from 'node:crypto';
import {readdir,readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {z,Uuid,AdaptCheckpoint,AdaptCandidateEvidence,type Instance} from '../../packages/shared/src/index.ts';
import {json,exists} from './io.ts';
import {git} from '../../packages/server/src/modules/adapt/source.ts';

export const ReleaseRequest=z.object({candidateId:Uuid,workspaceId:Uuid,threadId:Uuid,checkpoint:AdaptCheckpoint,baselineVersion:z.string().optional(),action:z.enum(['apply','restore'])}).strict();
export const ReleaseVersion=z.object({id:Uuid,owner:z.string(),trustedCommit:z.string(),trustedHash:z.string(),sourceTree:z.string(),buildDigest:z.string(),workspaceId:Uuid.nullable(),checkpoint:AdaptCheckpoint.optional(),checks:z.string()}).strict();
export type ReleaseVersion=z.infer<typeof ReleaseVersion>;
export const ReleaseJob=z.object({
  owner:z.string(),request:ReleaseRequest,targetVersion:z.string(),
  phase:z.enum(['preparing','ready','applying','applied','restored','rolled_back','failed','stale']),message:z.string(),
  evidence:AdaptCandidateEvidence.optional(),worker:z.object({pid:z.number(),identity:z.string()}).optional(),startedAt:z.number(),decisionId:Uuid.optional(),testInstanceId:z.string().optional(),baselineVersionId:Uuid.optional(),
}).strict();
export type ReleaseJob=z.infer<typeof ReleaseJob>;
export const ActiveRelease=z.object({current:Uuid,previous:Uuid.nullable(),operation:Uuid.optional(),confirmed:z.boolean(),recovering:z.boolean().optional(),recoveryPrevious:Uuid.nullable().optional(),message:z.string()}).strict();
export type ActiveRelease=z.infer<typeof ActiveRelease>;
export const releaseRoot=(instance:Instance)=>join(instance.root,'adapt','releases');
export const versionRoot=(instance:Instance,id:string)=>join(releaseRoot(instance),'versions',Uuid.parse(id));
export const jobPath=(instance:Instance,id:string)=>join(releaseRoot(instance),'jobs',Uuid.parse(id)+'.json');
export const owner=(instance:Instance)=>instance.id+':'+instance.generation;
export async function readActive(instance:Instance){const file=join(releaseRoot(instance),'active.json');return await exists(file)?ActiveRelease.parse(await json(file)):null;}
export async function installedVersion(instance:Instance){return (await readActive(instance))?.current??'development:'+await git(instance.checkout,['rev-parse','HEAD']);}
export async function directoryDigest(root:string):Promise<string>{
  const hash=createHash('sha256');let bytes=0;
  const visit=async(directory:string,prefix=''):Promise<void>=>{
    for(const name of (await readdir(directory)).sort()){
      const path=join(directory,name),relative=prefix+name,stat=await lstat(path);
      if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))throw Error('Release contains a nonordinary file.');
      if(stat.isDirectory())await visit(path,relative+'/');
      else{bytes+=stat.size;if(bytes>100*1024*1024)throw Error('Renderer release exceeds its size limit.');hash.update(relative+'\0');hash.update(await readFile(path));hash.update('\0');}
    }
  };await visit(root);return hash.digest('hex');
}
export async function readVersion(instance:Instance,id:string,verify=true){
  const root=versionRoot(instance,id),version=ReleaseVersion.parse(await json(join(root,'version.json')));
  if(version.id!==id||version.owner!==owner(instance))throw Error('Release ownership mismatch.');
  if(verify&&await directoryDigest(join(root,'build','renderer'))!==version.buildDigest)throw Error('Verified renderer build changed. Prepare a new update.');
  return version;
}
export async function readJob(instance:Instance,id:string){
  const job=ReleaseJob.parse(await json(jobPath(instance,id)));
  if(job.owner!==owner(instance)||job.request.candidateId!==id)throw Error('Application ownership mismatch.');return job;
}
