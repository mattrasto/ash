import { z } from 'zod';

export const RoutingOverride = z.enum(['auto','strong','fast','private']);
export const RoutingState = z.object({version:z.number().int().nonnegative().default(0),upgraded:z.boolean().default(false),override:RoutingOverride.default('auto')}).strict();
export type RoutingState = z.infer<typeof RoutingState>;
export const ChangeRouting = z.object({expectedVersion:z.number().int().nonnegative(),override:RoutingOverride}).strict();
export const RoutingInstruction = z.object({id:z.string().uuid(),text:z.string().max(12000),updatedAt:z.string().datetime()}).strict();
export const RoutingAttempt = z.object({
  policy:z.literal('jev-routing-v1'),previousUpgraded:z.boolean(),overrideVersion:z.number().int().nonnegative(),
  preparationMs:z.number().nonnegative(),instruction:RoutingInstruction,question:z.string().max(2000),criteria:z.object({fast_sufficient:z.string().max(1000),strong_preferred:z.string().max(1000),uncertain:z.string().max(1000)}).strict(),packet:z.string().max(8000).nullable(),skipReason:z.enum(['context_limit','media_unavailable']).optional(),
}).strict();
export type RoutingAttempt = z.infer<typeof RoutingAttempt>;
export const RoutingSelection = z.object({
  policy:z.literal('jev-routing-v1'),source:z.enum(['jev','fallback','sticky','override','retry']),role:z.enum(['strong','fast']),
  previousUpgraded:z.boolean(),instruction:RoutingInstruction,attemptId:z.string().uuid().optional(),
  evaluator:z.string().max(100).optional(),choice:z.enum(['fast_sufficient','strong_preferred','uncertain']).optional(),
  probabilities:z.object({fast_sufficient:z.number().min(0).max(1),strong_preferred:z.number().min(0).max(1),uncertain:z.number().min(0).max(1)}).strict().optional(),
  elapsedMs:z.number().nonnegative().optional(),preparationMs:z.number().nonnegative().optional(),error:z.string().max(100).optional(),
  usage:z.object({inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative()}).strict().optional(),
}).strict();
export type RoutingSelection = z.infer<typeof RoutingSelection>;
