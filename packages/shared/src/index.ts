import { z } from 'zod';

export const Identity = z.string().regex(/^[a-f0-9]{24}$/);
export const Profile = z.enum(['preview', 'verify', 'test']);
export const Fixture = z.enum(['scratchpad', 'empty']);
export const SCHEMA_VERSION = 1;
export const FIXTURE_VERSION = 3;

export const Instance = z.object({
  version: z.literal(1), id: Identity, workspaceId: Identity,
  checkout: z.string(), label: z.string(), profile: Profile, fixture: Fixture,
  root: z.string(), devRoot: z.string(), database: z.string(), runtimeRole: z.string(), ownerRole: z.string(),
  clusterId: Identity, schemaVersion: z.literal(SCHEMA_VERSION),
  generation: Identity,
});
export type Instance = z.infer<typeof Instance>;
export type Fixture = z.infer<typeof Fixture>;

export const ServerConfig = z.object({
  instance: Instance, databaseUrl: z.string().url(), token: z.string().min(32),
});
export type ServerConfig = z.infer<typeof ServerConfig>;

export const ScratchChange = z.object({
  note: z.string().max(2000).optional(), increment: z.boolean().optional(), fileNote: z.string().max(2000).optional(),
}).strict();

export interface PreviewInfo {
  label: string; workspaceId: string; instanceId: string; profile: string;
  checkout: string; source: { branch: string | null; revision: string } | null;
  fixture: string; generation: string; schemaVersion: number;
  model?: import('./contracts/threads.ts').ModelInfo;
}

export * from './contracts/threads.ts';
export * from './contracts/attachments.ts';
export * from './contracts/recording.ts';
export * from './contracts/organization.ts';
export * from './contracts/tools.ts';
export * from './contracts/video-understanding.ts';
export * from './contracts/permissions.ts';
export * from './contracts/decisions.ts';

export { ZodError } from 'zod';

export * from './contracts/artifacts.ts';

export * from './contracts/visibility.ts';

export * from './contracts/model-routing.ts';
