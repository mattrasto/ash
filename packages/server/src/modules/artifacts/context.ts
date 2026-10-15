import { Prisma } from '@prisma/client';
import { MessagePayload, messageText, type ReceiveItem } from '@ash/shared';
type Tx=Prisma.TransactionClient;
export async function routingContext(tx:Tx,input:ReceiveItem){
 const words=[...new Set(input.text.toLowerCase().match(/[a-z0-9]{3,}/g)??[])].filter(w=>!['the','and','for','that','this','with','from','have','you','your'].includes(w)).slice(0,20);
 const recent=await tx.thread.findMany({orderBy:[{updatedAt:'desc'},{id:'asc'}],take:80});
 const named=words.length?await tx.thread.findMany({where:{OR:words.map(word=>({title:{contains:word,mode:'insensitive' as const}}))},orderBy:[{updatedAt:'desc'},{id:'asc'}],take:40}):[];
 const rows=[...new Map([...named,...recent].map(row=>[row.id,row])).values()];
 const candidates=[];
 for(const thread of rows){
  const surfaces=await tx.$queryRaw<{id:string;payload:unknown}[]>`SELECT a.id,a.payload FROM artifacts a WHERE a.thread_id=${thread.id}::uuid AND a.layer='surface'
    AND (a.payload->>'speaker' IN ('user','source') OR EXISTS (SELECT 1 FROM runs r WHERE r.id=a.run_id AND r.status='completed'
      AND NOT EXISTS (SELECT 1 FROM runs newer WHERE newer.input_artifact_id=r.input_artifact_id AND newer.status='completed' AND (newer.ended_at,newer.id)>(r.ended_at,r.id))))
    ORDER BY a.created_at DESC,a.id DESC LIMIT 3`;
  const excerpts=surfaces.reverse().map(a=>{const p=MessagePayload.parse(a.payload),text=messageText(p);return {artifactId:a.id,speaker:p.speaker,...(p.source?{source:p.source}:{}),text:text.slice(0,700),truncated:text.length>700};});
  const searchable=(thread.title+' '+excerpts.map(e=>e.text).join(' ')).toLowerCase();
  candidates.push({id:thread.id,title:thread.title,archived:thread.isArchived,excerpts,score:words.filter(w=>searchable.includes(w)).length});
 }
 candidates.sort((a,b)=>b.score-a.score||rows.findIndex(r=>r.id===a.id)-rows.findIndex(r=>r.id===b.id));
 const chosen=candidates.slice(0,16).map(({score,...candidate})=>candidate);
 const memberships=await tx.threadTopic.findMany({where:{threadId:{in:chosen.map(c=>c.id)},topic:{deletedAt:null}},orderBy:[{linkedAt:'asc'},{topicId:'asc'}],include:{topic:{include:{instruction:true}}}});
 const topics=[...new Map(memberships.map(m=>[m.topicId,m.topic])).values()];
 const namedTopics=await tx.topic.findMany({where:{deletedAt:null,...(words.length?{OR:words.flatMap(word=>[{name:{contains:word,mode:'insensitive' as const}},{instruction:{text:{contains:word,mode:'insensitive' as const}}}])}:{id:{in:[]}})},orderBy:{id:'asc'},take:21,include:{instruction:true}});
 const matchedTopics=[...new Map([...topics,...namedTopics].map(t=>[t.id,t])).values()];
 const selectedTopics=matchedTopics.slice(0,20);
 return {candidates:chosen.map(candidate=>({...candidate,topics:memberships.filter(m=>m.threadId===candidate.id).map(m=>({id:m.topic.id,name:m.topic.name}))})),topics:selectedTopics,scope:{threadCount:await tx.thread.count(),examinedThreads:rows.length,includedThreads:chosen.length,omittedThreads:Math.max(0,await tx.thread.count()-chosen.length),excerptsPerThread:3,excerptCharacters:700,topicLimit:20,includedTopics:selectedTopics.length,omittedTopics:matchedTopics.length-selectedTopics.length,topicSearchLimited:namedTopics.length===21,queryTerms:words}};
}
