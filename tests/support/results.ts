import { join } from 'node:path';
import { atomic } from '../../scripts/dev/io.ts';
import { testEvent } from '../../scripts/dev/telemetry.ts';
import { scenario } from '../scenarios.ts';

export interface Attempt {
  status: 'passed' | 'failed' | 'skipped' | 'blocked';
  durationMs: number;
  error?: string;
  artifacts?: string[];
}
export interface ScenarioResult { id: string; attempts: Attempt[] }

export function redact(text: string) {
  return text.replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1[REDACTED]@')
    .replace(/(Bearer\s+)[\w.-]+/gi, '$1[REDACTED]')
    .replace(/("(?:token|password|apiKey)"\s*:\s*")[^"]+/gi, '$1[REDACTED]');
}

export async function writeResult(result: ScenarioResult) {
  scenario(result.id);
  const evidence = process.env.ASH_TEST_EVIDENCE;
  if (evidence) await atomic(join(evidence, 'results', `${result.id}.json`), result);
}

export async function recordScenario(id: string, action: () => Promise<unknown> | unknown) {
  scenario(id);
  const start = Date.now();
  testEvent({ id, kind: 'scenario', name: id, status: 'started', at: start });
  try {
    await action();
    await writeResult({ id, attempts: [{ status: 'passed', durationMs: Date.now() - start }] });
    testEvent({ id, kind: 'scenario', name: id, status: 'passed', at: Date.now(), durationMs: Date.now() - start });
  } catch (error) {
    await writeResult({ id, attempts: [{ status: 'failed', durationMs: Date.now() - start, error: redact(String(error)) }] });
    testEvent({ id, kind: 'scenario', name: id, status: 'failed', at: Date.now(), durationMs: Date.now() - start });
    throw error;
  }
}
