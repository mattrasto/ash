import test, { type TestContext } from 'node:test';
import { scenario } from '../scenarios.ts';
import { recordScenario } from './results.ts';

export function scenarioTest(id: string, action: () => Promise<unknown> | unknown) {
  return test(`${id}: ${scenario(id).title}`, () => recordScenario(id, action));
}

export function scenarioStep(t: TestContext, id: string, action: () => Promise<unknown> | unknown) {
  return t.test(`${id}: ${scenario(id).title}`, () => recordScenario(id, action));
}
