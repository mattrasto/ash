import test, { type TestContext } from 'node:test';
import { scenario } from '../scenarios.ts';
import { recordScenario } from './results.ts';

const selected: Set<string> | undefined = (() => {
  if (!process.env.ASH_TEST_CASES) return;
  const ids: unknown = JSON.parse(process.env.ASH_TEST_CASES);
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('Invalid dispatched scenario selection');
  for (const id of ids) scenario(id);
  return new Set(ids);
})();
export const scenarioSelected = (id: string) => !selected || selected.has(id);
export const onlyScenario = (id: string) => selected?.size === 1 && selected.has(id);

export function scenarioTest(id: string, action: () => Promise<unknown> | unknown) {
  if (!scenarioSelected(id)) return;
  return test(`${id}: ${scenario(id).title}`, () => recordScenario(id, action));
}

export function scenarioStep(t: TestContext, id: string, action: () => Promise<unknown> | unknown) {
  if (!scenarioSelected(id)) return Promise.resolve();
  return t.test(`${id}: ${scenario(id).title}`, () => recordScenario(id, action));
}
