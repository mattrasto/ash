import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ChangeMembership, ChangeTopic, CreateTopic, InstructionOwner, SaveInstruction, type MembershipView, type OwnedInstruction } from '@ash/shared';

type Tx = Prisma.TransactionClient;
export class OrganizationError extends Error {
  constructor(public status:number, message:string) { super(message); }
}
const changedAt = (previous:Date) => new Date(Math.max(Date.now(), previous.getTime()+1));
export async function memberships(tx:Tx, threadId:string):Promise<MembershipView> {
  const thread = await tx.thread.findUnique({where:{id:threadId},select:{topicsVersion:true}});
  if (!thread) throw new OrganizationError(404,'Thread not found.');
  const rows = await tx.threadTopic.findMany({where:{threadId,topic:{deletedAt:null}},include:{topic:true},orderBy:[{linkedAt:'asc'},{topicId:'asc'}]});
  return {version:thread.topicsVersion,topics:rows.map(row=>({id:row.topicId,name:row.topic.name,linkedAt:row.linkedAt.toISOString()}))};
}
export class Organization {
  constructor(readonly db:PrismaClient) {}
  async list() {
    return (await this.db.topic.findMany({where:{deletedAt:null},orderBy:[{name:'asc'},{id:'asc'}],include:{memberships:{select:{threadId:true}}}}))
      .map(row=>({id:row.id,name:row.name,updatedAt:row.updatedAt.toISOString(),threadIds:row.memberships.map(link=>link.threadId)}));
  }
  async create(input:unknown) {
    const command = CreateTopic.parse(input);
    // The client supplies a stable ID, so a transport retry cannot duplicate a Topic.
    await this.db.topic.createMany({data:{...command,createdAt:new Date(),updatedAt:new Date()},skipDuplicates:true});
    const row = await this.db.topic.findUniqueOrThrow({where:{id:command.id},include:{memberships:{select:{threadId:true}}}});
    if (row.deletedAt || row.name !== command.name) throw new OrganizationError(409,'This Topic ID has already been used. Refresh Topics.');
    return {id:row.id,name:row.name,updatedAt:row.updatedAt.toISOString(),threadIds:row.memberships.map(link=>link.threadId)};
  }
  async change(id:string,input:unknown) {
    const command = ChangeTopic.parse(input);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM topics WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.topic.findUnique({where:{id}});
      if (!row) throw new OrganizationError(404,'Topic not found.');
      if (command.deleted && row.deletedAt || !row.deletedAt && command.name === row.name) return {ok:true};
      if (row.deletedAt) throw new OrganizationError(409,'This Topic was deleted. Refresh Topics.');
      if (row.updatedAt.toISOString() !== command.expectedUpdatedAt) throw new OrganizationError(409,'This Topic changed elsewhere. Refresh before saving.');
      await tx.topic.update({where:{id},data:{...(command.deleted?{deletedAt:new Date()}:{name:command.name}),updatedAt:changedAt(row.updatedAt)}});
      return {ok:true};
    });
  }
  readMembership(threadId:string) { return this.db.$transaction(tx=>memberships(tx,threadId),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead}); }
  async link(threadId:string,input:unknown) {
    const command = ChangeMembership.parse(input);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM threads WHERE id=${threadId}::uuid FOR UPDATE`;
      const current = await memberships(tx,threadId);
      const same = current.topics.length === command.topicIds.length && current.topics.every(topic=>command.topicIds.includes(topic.id));
      if (same) return current;
      if (current.version !== command.expectedVersion) throw new OrganizationError(409,'Topic membership changed elsewhere. Refresh before saving.');
      for (const id of [...command.topicIds].sort()) {
        await tx.$queryRaw`SELECT id FROM topics WHERE id=${id}::uuid FOR UPDATE`;
        if (!await tx.topic.findFirst({where:{id,deletedAt:null}})) throw new OrganizationError(409,'A selected Topic was deleted. Refresh Topics.');
      }
      await tx.threadTopic.deleteMany({where:{threadId,topicId:{notIn:command.topicIds}}});
      await tx.threadTopic.createMany({data:command.topicIds.map(topicId=>({threadId,topicId,linkedAt:new Date()})),skipDuplicates:true});
      await tx.thread.update({where:{id:threadId},data:{topicsVersion:{increment:1}}});
      return memberships(tx,threadId);
    });
  }
  async readInstruction(input:unknown):Promise<OwnedInstruction> {
    const owner = InstructionOwner.parse(input);
    return this.db.$transaction(tx=>this.owned(tx,owner),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  private async owned(tx:Tx,owner:InstructionOwner):Promise<OwnedInstruction> {
    let instructionId:string|null;
    if (owner.scope === 'global') instructionId = (await tx.instruction.findUnique({where:{key:owner.key}}))?.id ?? null;
    else {
      const row = owner.scope === 'topic' ? await tx.topic.findFirst({where:{id:owner.id,deletedAt:null}}) : await tx.thread.findUnique({where:{id:owner.id}});
      if (!row) throw new OrganizationError(404,owner.scope === 'topic' ? 'Topic not found.' : 'Thread not found.');
      instructionId = row.instructionId;
    }
    const doc = instructionId ? await tx.instruction.findUniqueOrThrow({where:{id:instructionId}}) : null;
    return {owner,document:doc?{id:doc.id,name:doc.name,text:doc.text,updatedAt:doc.updatedAt.toISOString()}:null};
  }
  async saveInstruction(input:unknown):Promise<OwnedInstruction> {
    const command = SaveInstruction.parse(input), {owner} = command;
    return this.db.$transaction(async tx=>{
      if (owner.scope === 'topic') await tx.$queryRaw`SELECT id FROM topics WHERE id=${owner.id}::uuid FOR UPDATE`;
      else if (owner.scope === 'thread') await tx.$queryRaw`SELECT id FROM threads WHERE id=${owner.id}::uuid FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM instructions WHERE key=${owner.key} FOR UPDATE`;
      let current = await this.owned(tx,owner);
      if (current.document) {
        const id = current.document.id;
        await tx.$queryRaw`SELECT id FROM instructions WHERE id=${id}::uuid FOR UPDATE`;
        // Separate queries after the lock see competing ownership changes at READ COMMITTED.
        const doc = await tx.instruction.findUniqueOrThrow({where:{id},include:{topic:true,thread:true}});
        if (owner.scope === 'global' ? doc.key !== owner.key || !!doc.topic || !!doc.thread :
          doc.key !== null || (owner.scope === 'topic' ? doc.topic?.id !== owner.id || !!doc.thread : doc.thread?.id !== owner.id || !!doc.topic)) {
          throw new OrganizationError(409,'Instruction ownership is inconsistent.');
        }
        current = await this.owned(tx,owner);
        if ((!command.expected || command.expected.id === id) && current.document!.text === command.text) return current;
        if (command.expected?.id !== id || command.expected.updatedAt !== current.document!.updatedAt) throw new OrganizationError(409,'These instructions changed elsewhere. Your draft is preserved; reload the saved text before trying again.');
        await tx.instruction.update({where:{id},data:{text:command.text,updatedAt:changedAt(doc.updatedAt)}});
      } else {
        if (command.expected || owner.scope === 'global') throw new OrganizationError(409,'The instruction document changed. Reload before saving.');
        const now = new Date(), id = randomUUID();
        await tx.instruction.create({data:{id,name:owner.scope === 'topic' ? 'Topic routing instructions' : 'Thread instructions',text:command.text,createdAt:now,updatedAt:now}});
        if (owner.scope === 'topic') await tx.topic.update({where:{id:owner.id},data:{instructionId:id}});
        else await tx.thread.update({where:{id:owner.id},data:{instructionId:id}});
      }
      return this.owned(tx,owner);
    });
  }
}
