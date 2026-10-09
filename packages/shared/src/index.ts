import { z } from 'zod';

export const Identity = z.string().regex(/^[a-f0-9]{24}$/);
export const Profile = z.enum(['preview', 'verify', 'test']);
export const Fixture = z.enum(['scratchpad', 'empty']);
export const SCHEMA_VERSION = 1;
export const FIXTURE_VERSION = 1;

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

export const ScratchState = z.object({ note: z.string(), count: z.number().int(), fileNote: z.string() });
export type ScratchState = z.infer<typeof ScratchState>;
export const ScratchChange = z.object({
  note: z.string().max(2000).optional(), increment: z.boolean().optional(), fileNote: z.string().max(2000).optional(),
}).strict();

export interface PreviewInfo {
  label: string; workspaceId: string; instanceId: string; profile: string;
  fixture: string; generation: string; schemaVersion: number;
}
