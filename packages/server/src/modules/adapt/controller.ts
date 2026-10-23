import {z} from 'zod';
import {AdaptCheckpoint} from '@ash/shared';
export const workspaceController=z.object({
  bindingId:z.string(),generation:z.number().int().nonnegative().default(0),
  lease:z.object({id:z.string(),generation:z.number().int().nonnegative()}).strict().optional(),
  integration:z.object({version:z.string(),baseline:AdaptCheckpoint,conflicts:z.array(z.string())}).strict().optional(),
  preparingAt:z.number().optional(),previewPending:z.boolean().optional(),
  application:z.object({candidateId:z.string().uuid(),checkpointId:z.string().uuid(),action:z.enum(['apply','restore']),
    phase:z.string(),decisionId:z.string().uuid().optional(),evidenceId:z.string().uuid(),outcomeId:z.string().uuid(),message:z.string().optional(),
  }).strict().optional(),
}).strict();
