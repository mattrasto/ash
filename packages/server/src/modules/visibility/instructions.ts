import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
export async function ensureVisibilityInstructions(db:PrismaClient){
 for(const [key,name,text] of [
  ['thread-visibility','Thread visibility','Keep a Thread visible while its matter remains useful. Give completed one-off matters an appropriate finite lifetime. Use exact event dates and the supplied current time/time zone when supported by evidence. Keep ongoing or uncertain matters visible indefinitely. Never invent a deadline. An immediate result is suitable only when the matter has no remaining usefulness. Consider recent manual activity, especially unarchiving, as evidence of renewed interest; choose a suitable lifetime from the context rather than a fixed grace period. Pinning and unread protection are enforced separately.'],
  ['thread-naming','Thread naming','Choose a concise, recognizable name for the current matter. Preserve a good existing name; rename when the matter becomes clearer or changes substantially. Avoid generic titles, incidental details and wording churn.'],
 ])await db.instruction.createMany({data:{id:randomUUID(),key,name,text,createdAt:new Date(),updatedAt:new Date()},skipDuplicates:true});
}
