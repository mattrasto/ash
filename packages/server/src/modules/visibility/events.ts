import { randomUUID } from 'node:crypto';
import type { ApplicationChange, Prisma } from '@prisma/client';
import { ThreadChange, ThreadEvent, ThreadLifecycle, type ApplicationChangeView } from '@ash/shared';
import { json } from './state.ts';

type State={id:string;title:string;isArchived:boolean;isPinned:boolean;lifecycle:unknown};
type Cause={id?:string;origin:ThreadEvent['origin'];command?:ThreadChange;sourceArtifactId?:string|null;assessmentId?:string};
/** Commit application history with the current-state change, without entering the Artifact Engine. */
export async function recordThreadChange(tx:Prisma.TransactionClient,before:State,after:State,cause:Cause,now:Date,reason?:string){
 const events:ThreadEvent[]=[],base={type:'thread_event' as const,origin:cause.origin,...(reason?{reason}:{})};
 if(before.isArchived!==after.isArchived)events.push({...base,event:after.isArchived?'archived':'unarchived'});
 if(before.title!==after.title)events.push({...base,event:'renamed',previousTitle:before.title,title:after.title});
 if(before.isPinned!==after.isPinned)events.push({...base,event:after.isPinned?'pinned':'unpinned'});
 const previousMode=ThreadLifecycle.parse(before.lifecycle).titleMode,mode=ThreadLifecycle.parse(after.lifecycle).titleMode;
 if(previousMode!==mode)events.push({...base,event:'name_mode',previousMode,mode});
 if(!cause.command&&!events.length)return null;
 return tx.applicationChange.create({data:{id:cause.id??randomUUID(),threadId:after.id,origin:cause.origin,
  ...(cause.command?{command:json(ThreadChange.parse(cause.command))}:{}),events:json(events.map(event=>ThreadEvent.parse(event))),
  sourceArtifactId:cause.sourceArtifactId,assessmentId:cause.assessmentId,createdAt:now}});
}
export function changeView(row:ApplicationChange):ApplicationChangeView {
 return {...row,origin:row.origin as ThreadEvent['origin'],command:row.command===null?null:ThreadChange.parse(row.command),events:ThreadEvent.array().parse(row.events),createdAt:row.createdAt.toISOString()};
}
