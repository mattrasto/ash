import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

export interface TestEvent {
  id: string; kind: 'phase' | 'scenario'; name: string; context?: string;
  status: 'started' | 'passed' | 'failed'; at: number; durationMs?: number; processId: number;
}
let sequence = 0;
export function testEvent(event: Omit<TestEvent, 'processId'>) {
  const evidence = process.env.ASH_TEST_EVIDENCE;
  if (!evidence) return;
  const directory = join(evidence, 'events');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  appendFileSync(join(directory, `${process.pid}.jsonl`), JSON.stringify({ ...event, processId: process.pid }) + '\n', { mode: 0o600 });
}
export async function measure<T>(name: string, action: () => Promise<T>, context = basename(process.argv[1] ?? 'test')): Promise<T> {
  const id = `${process.pid}-${++sequence}`, start = Date.now();
  testEvent({ id, kind: 'phase', name, context, status: 'started', at: start });
  try {
    const value = await action();
    testEvent({ id, kind: 'phase', name, context, status: 'passed', at: Date.now(), durationMs: Date.now() - start });
    return value;
  } catch (error) {
    testEvent({ id, kind: 'phase', name, context, status: 'failed', at: Date.now(), durationMs: Date.now() - start });
    throw error;
  }
}

export function recordResource(kind: 'instances' | 'processes' | 'checkouts' | 'clusters', key: string, value: unknown) {
  const evidence = process.env.ASH_TEST_EVIDENCE;
  if (!evidence) return;
  if (!/^[a-z0-9-]+$/.test(key)) throw new Error('Invalid resource identity');
  const directory = join(evidence, 'resources', kind);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Each resource has one creator and is recorded before it can outlive the test process.
  writeFileSync(join(directory, `${key}.json`), JSON.stringify(value), { mode: 0o600 });
}
