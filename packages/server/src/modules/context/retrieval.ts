import { Prisma, type PrismaClient } from '@prisma/client';
import { MessagePayload, RequestPayload, RunState, TopicRead, TopicSearch, type LinkedTopic, type TopicExcerpt, type TopicRetrievalResult } from '@ash/shared';
import { OrganizationError, memberships } from '../organization/service.ts';

type Tx = Prisma.TransactionClient;
export const RETRIEVAL_LIMITS = {scan:200,results:10,searchCharacters:6000,readCharacters:4000} as const;
interface Scope {threadId:string;topics:LinkedTopic[];excluded:string[]}

// Only trusted Run identity enters this interface. Model arguments never supply Topic scope.
export class TopicRetrieval {
  constructor(readonly db:PrismaClient) {}
  availableForRun(runId:string) {
    return this.db.$transaction(async tx=>{const {threadId,topics}=await this.scope(tx,runId);return {threadId,topics};},{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  private async scope(tx:Tx,runId:string):Promise<Scope> {
    const run = await tx.run.findUnique({where:{id:runId}});
    if (!run?.threadId) throw new OrganizationError(404,'Thread Run not found.');
    const request = await tx.artifact.findUniqueOrThrow({where:{id:RunState.parse(run.state).request_artifact_id}});
    const captured = RequestPayload.parse(request.payload).selection;
    const current = await memberships(tx,run.threadId);
    const ids = new Set(captured.topics?.map(topic=>topic.id) ?? []);
    return {threadId:run.threadId,topics:current.topics.filter(topic=>ids.has(topic.id)),excluded:captured.artifacts.map(artifact=>artifact.id)};
  }
  private eligible(scope:Scope) {
    return Prisma.sql`a.layer='surface' AND a.payload->>'type'='message'
      AND a.thread_id <> ${scope.threadId}::uuid
      AND EXISTS (SELECT 1 FROM thread_topics membership JOIN topics topic ON topic.id=membership.topic_id
        WHERE membership.thread_id=a.thread_id AND topic.deleted_at IS NULL
          AND topic.id IN (${Prisma.join(scope.topics.map(topic=>Prisma.sql`${topic.id}::uuid`))}))
      AND (a.payload->>'speaker'='user' OR (a.payload->>'speaker'='ash' AND EXISTS (
        SELECT 1 FROM runs r WHERE r.id=a.run_id AND r.status='completed'
          AND NOT EXISTS (SELECT 1 FROM runs newer WHERE newer.input_artifact_id=r.input_artifact_id
            AND newer.status='completed' AND (newer.ended_at,newer.id)>(r.ended_at,r.id)))))`;
  }
  private async sources(tx:Tx,ids:string[]) {
    return tx.artifact.findMany({where:{id:{in:ids}},include:{thread:{select:{title:true}},attachmentReferences:{include:{attachment:{select:{id:true,filename:true,summary:true,summaryRunId:true}}}}}});
  }
  private content(row:Awaited<ReturnType<TopicRetrieval['sources']>>[number]) {
    const payload = MessagePayload.parse(row.payload);
    const assets = new Map(row.attachmentReferences.map(link=>[link.attachmentId,link.attachment]));
    const images:(TopicExcerpt['images'][number]&{start:number;end:number})[] = [];
    let cursor=0;
    const text = payload.content.map(block=>{
      if (block.type === 'text') {cursor+=block.text.length+1;return block.text;}
      if(block.type==='video'){const asset=assets.get(block.attachmentId);const description=`[Video ${block.attachmentId}; pixels/audio not included]`;const caption=asset?.summary?'\nGenerated video caption: '+asset.summary.slice(0,1000):'\nVideo caption unavailable.';cursor+=description.length+caption.length+1;return description+caption;}
      const asset = assets.get(block.attachmentId);
      const description=`[Image ${block.attachmentId}; pixels not included]\n${asset?.summary ? `Generated description: ${asset.summary}` : 'Description unavailable.'}`;
      images.push({id:block.attachmentId,summaryRunId:asset?.summaryRunId??null,descriptionAvailable:!!asset?.summary,start:cursor,end:cursor+description.length});
      cursor+=description.length+1;
      return description;
    }).join('\n');
    return {row,payload,text,images};
  }
  private excerpt(source:ReturnType<TopicRetrieval['content']>,offset:number,length:number):TopicExcerpt {
    // Avoid splitting surrogate pairs at excerpt boundaries; offsets describe the returned text.
    if (offset>0 && /[\uDC00-\uDFFF]/.test(source.text[offset]??'')) offset--;
    let end = Math.min(source.text.length,offset+length);
    if (end<source.text.length && /[\uD800-\uDBFF]/.test(source.text[end-1]??'')) end--;
    return {artifactId:source.row.id,threadId:source.row.threadId!,threadTitle:source.row.thread!.title,speaker:source.payload.speaker,
      createdAt:source.row.createdAt.toISOString(),text:source.text.slice(offset,end),offset,totalCharacters:source.text.length,
      truncated:offset>0 || end<source.text.length,images:source.images.filter(image=>image.start<end && image.end>offset).map(({start,end,...image})=>image)};
  }
  async searchForRun(runId:string,input:unknown,signal?:AbortSignal):Promise<TopicRetrievalResult> {
    const {query} = TopicSearch.parse(input);
    signal?.throwIfAborted();
    const result = await this.db.$transaction(async tx=>{
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'");
      const scope = await this.scope(tx,runId);
      const result:TopicRetrievalResult = {kind:'search',topics:scope.topics.map(({id})=>({id})),query,results:[],scanned:0,scanLimited:false,truncated:false};
      if (!scope.topics.length) return result;
      const candidates = await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT a.id FROM artifacts a WHERE ${this.eligible(scope)} ORDER BY a.created_at DESC,a.id DESC LIMIT ${RETRIEVAL_LIMITS.scan+1}`);
      result.scanLimited = candidates.length>RETRIEVAL_LIMITS.scan;
      const ids = candidates.slice(0,RETRIEVAL_LIMITS.scan).map(row=>row.id);
      const rows = new Map((await this.sources(tx,ids)).map(row=>[row.id,row]));
      let remaining:number = RETRIEVAL_LIMITS.searchCharacters;
      // Escape a literal query; Unicode case matching preserves original excerpt offsets.
      const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'iu');
      for (const id of ids) {
        signal?.throwIfAborted();
        result.scanned++;
        if (scope.excluded.includes(id)) continue;
        const source = this.content(rows.get(id)!);
        const index = pattern.exec(source.text)?.index ?? -1;
        if (index<0) continue;
        if (result.results.length===RETRIEVAL_LIMITS.results || remaining===0) {result.truncated=true;break;}
        const excerpt = this.excerpt(source,Math.max(0,index-160),Math.min(1000,remaining));
        remaining-=excerpt.text.length;
        result.results.push(excerpt);
      }
      result.truncated ||= result.scanLimited || result.results.some(item=>item.truncated);
      return result;
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
    signal?.throwIfAborted();
    return result;
  }
  async readForRun(runId:string,input:unknown,signal?:AbortSignal):Promise<TopicRetrievalResult> {
    const {artifactId,offset} = TopicRead.parse(input);
    signal?.throwIfAborted();
    const result = await this.db.$transaction(async tx=>{
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'");
      const scope = await this.scope(tx,runId);
      if (!scope.topics.length || scope.excluded.includes(artifactId)) throw new OrganizationError(403,'This source is outside the available Topic context.');
      const rows = await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT a.id FROM artifacts a WHERE a.id=${artifactId}::uuid AND ${this.eligible(scope)}`);
      if (!rows.length) throw new OrganizationError(403,'This source is unavailable within the linked Topics.');
      const source = this.content((await this.sources(tx,[artifactId]))[0]);
      if (offset>source.text.length) throw new OrganizationError(400,'Read offset exceeds the source length.');
      const excerpt = this.excerpt(source,offset,RETRIEVAL_LIMITS.readCharacters);
      return {kind:'read' as const,topics:scope.topics.map(({id})=>({id})),results:[excerpt],scanned:1,scanLimited:false,truncated:excerpt.truncated};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
    signal?.throwIfAborted();
    return result;
  }
}
