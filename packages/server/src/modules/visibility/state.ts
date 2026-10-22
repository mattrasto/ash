import type { Prisma, Thread } from '@prisma/client';
import { ThreadLifecycle } from '@ash/shared';
export const json=(v:unknown)=>v as Prisma.InputJsonValue;
export const DAY=24*60*60*1000;
export async function lockThread(tx:Prisma.TransactionClient,id:string){await tx.$queryRaw`SELECT id FROM threads WHERE id=${id}::uuid FOR UPDATE`;return tx.thread.findUniqueOrThrow({where:{id}});}
export async function activeWork(tx:Prisma.TransactionClient,id:string){
 return !!await tx.run.findFirst({where:{threadId:id,status:{in:['queued','running']}},select:{id:true}})||!!await tx.incomingItem.findFirst({where:{status:{in:['queued','processing','waiting_capacity']},state:{path:['threadId'],equals:id}},select:{id:true}});
}
export async function waitingWork(tx:Prisma.TransactionClient,id:string){
 return !!await tx.run.findFirst({where:{threadId:id,status:'waiting'},select:{id:true}})||!!await tx.decision.findFirst({where:{threadId:id,status:{in:['pending','snoozed']}},select:{id:true}});
}
export function threadView(row:Thread){const lifecycle=ThreadLifecycle.parse(row.lifecycle);return {...row,lifecycle,unread:lifecycle.unread>lifecycle.seen};}
/** Lock referenced Threads before the caller updates the Attachment, matching submission's lock order. */
export async function mediaActivity(tx:Prisma.TransactionClient,attachmentId:string,sourceId:string){
 const refs=await tx.$queryRaw<{threadId:string}[]>`SELECT DISTINCT a.thread_id AS "threadId" FROM artifacts a JOIN artifact_attachments r ON r.artifact_id=a.id WHERE r.attachment_id=${attachmentId}::uuid AND a.thread_id IS NOT NULL ORDER BY a.thread_id`;
 for(const ref of refs)await tx.$executeRaw`SELECT record_thread_activity(${ref.threadId}::uuid,${sourceId}::uuid,false,0)`;
}
