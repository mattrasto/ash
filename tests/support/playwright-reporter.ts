import { testEvent } from '../../scripts/dev/telemetry.ts';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { relative } from 'node:path';
import { redact, writeResult, type Attempt } from './results.ts';

export default class ScenarioReporter implements Reporter {
  private attempts = new Map<string, Attempt[]>();
  private writing: Promise<void> = Promise.resolve();
  private errors: string[] = [];
  onTestBegin(test: TestCase) {
    const id = test.title.split(':')[0];
    testEvent({ id, kind: 'scenario', name: id, status: 'started', at: Date.now() });
  }
  onTestEnd(test: TestCase, result: TestResult) {
    const id = test.title.split(':')[0];
    testEvent({ id, kind: 'scenario', name: id, status: result.status === 'passed' ? 'passed' : 'failed', at: Date.now(), durationMs: result.duration });
    const attempts = this.attempts.get(id) ?? [];
    attempts.push({
      status: result.status === 'passed' ? 'passed' : result.status === 'skipped' ? 'skipped' : 'failed',
      durationMs: result.duration,
      error: result.errors.length ? redact(result.errors.map(e => e.message).join('\n')) : undefined,
      artifacts: result.attachments.flatMap(a => a.path ? [relative(process.env.ASH_TEST_EVIDENCE ?? process.cwd(), a.path)] : []),
    });
    this.attempts.set(id, attempts);
    const record = { id, attempts: [...attempts] };
    // Preserve order if retries are explicitly enabled: an earlier write cannot replace later attempts.
    this.writing = this.writing.then(() => writeResult(record)).catch(error => { this.errors.push(redact(String(error))); });
  }
  async onEnd() {
    await this.writing;
    if (this.errors.length) {
      console.error(this.errors.join('\n'));
      return { status: 'failed' as const };
    }
  }
}
