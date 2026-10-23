import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
export const MODEL_ROUTING_INSTRUCTION = `Prefer the strong model when the request needs substantial reasoning or judgment: design and architecture, debugging or code changes, research across sources, decisions with competing constraints, nuanced personal advice or writing where voice and intent matter. Also prefer strong when the user asks for depth/care or corrects a substantive mistake in the current work.
The fast model is suitable for greetings, simple factual questions, straightforward summaries of supplied text, formatting, extraction and light rewrites with clear requirements. A multi-step tool workflow is not routine merely because each individual action looks simple.
Read the latest request in its relevant conversation context. Continue, do that, or another short follow-up inherits the work being discussed. If context is insufficient or you are unsure that fast is sufficient, prefer strong. A request for speed alone does not make difficult work suitable for fast.`;
export async function ensureRoutingInstruction(db:Pick<Prisma.TransactionClient,'instruction'>){
  await db.instruction.createMany({data:{id:randomUUID(),key:'model-routing',name:'Model routing',text:MODEL_ROUTING_INSTRUCTION,createdAt:new Date(),updatedAt:new Date()},skipDuplicates:true});
}
