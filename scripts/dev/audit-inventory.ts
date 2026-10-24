import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import { scenarios, coverageReviews } from '../../tests/scenarios.ts';
import { exec } from './io.ts';
import { changedFiles } from './selection.ts';

const printer = ts.createPrinter({ removeComments: true });
const byId = new Map(scenarios.map(s => [s.id, s]));
export async function auditInventory(checkout: string, touched?: Set<string>) {
  const paths = [...new Set(scenarios.map(s => s.file).filter(p => !p.includes('*')))];
  paths.push(...(await exec('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', 'tests/boundary', 'tests/e2e', 'tests/integration'], { cwd: checkout })).stdout.split('\0').filter(p => /\.(test|spec)\.ts$/.test(p)));
  const found = new Map<string, { file: string; hash: string; calls: Set<string>; literals: Set<string> }>(), errors: string[] = [];
  for (const file of new Set(paths)) {
    const source = await readFile(join(checkout, file), 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(tree);
        if (['test', 'scenarioStep', 'scenarioTest', 'recordScenario'].includes(name)) {
          const value = node.arguments[name === 'scenarioStep' ? 1 : 0];
          if (value && ts.isStringLiteral(value)) {
            const id = value.text.split(':')[0], known = byId.has(id);
            if (!known && (name !== 'test' || file.startsWith('tests/e2e/') && value.text.includes(':'))) errors.push(`Unregistered scenario ${id} in ${file}`);
            if (known) {
              if (found.has(id)) errors.push(`Multiple executable definitions for ${id}`);
              const callback = node.arguments.find(n => ts.isArrowFunction(n) || ts.isFunctionExpression(n));
              const body = callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ? callback.body : node;
              const calls = new Set<string>(), literals = new Set<string>();
              function scan(n: ts.Node) {
                if (ts.isCallExpression(n)) {
                  let expression = n.expression; const parts: string[] = [];
                  while (ts.isPropertyAccessExpression(expression)) { parts.unshift(expression.name.text); expression = expression.expression; }
                  if (ts.isIdentifier(expression)) parts.unshift(expression.text);
                  if (parts.length) calls.add(parts.join('.'));
                }
                if (ts.isStringLiteral(n) && n.text.length > 8) literals.add(n.text);
                ts.forEachChild(n, scan);
              }
              const contract = byId.get(id)!;
              scan(body);found.set(id, { file, hash: createHash('sha256').update(JSON.stringify({title:contract.title,requirements:[...contract.requirements].sort(),preset:contract.preset??null})).update('\0').update(printer.printNode(ts.EmitHint.Unspecified, body, tree)).digest('hex'), calls, literals });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  for (const s of scenarios) {
    const actual = found.get(s.id);
    if (!actual) errors.push(`No executable definition for ${s.id}`);
    else if (!s.file.includes('*') && s.file !== actual.file) errors.push(`Stale file mapping for ${s.id}: ${actual.file}`);
  }
  const candidates: Array<{ scenarios: string[]; similarity: number; sharedRequirements: string[]; sharedLiterals: number }> = [];
  for (const review of coverageReviews) for (const [n, id] of review.scenarios.entries()) {
    if (!scenarios.some(s => s.id === id) || !/^[a-f0-9]{64}$/.test(review.hashes[n])) errors.push(`Invalid coverage review: ${id}`);
  }
  const items = [...found];
  const changed = touched ? items.filter(([, item]) => touched.has(item.file)) : items;
  const compared = new Set<string>();
  for (const [x, left] of changed) for (const [y, right] of items) {
    if (x === y) continue;
    const key = [x, y].sort().join('\0');if (compared.has(key)) continue;compared.add(key);
    const reviewed = coverageReviews.some(r => r.scenarios[0] === x && r.scenarios[1] === y && r.hashes[0] === left.hash && r.hashes[1] === right.hash || r.scenarios[0] === y && r.scenarios[1] === x && r.hashes[0] === right.hash && r.hashes[1] === left.hash);
    if (reviewed) continue;
    const common = [...left.calls].filter(v => right.calls.has(v)).length;
    const similarity = common / (new Set([...left.calls, ...right.calls]).size || 1);
    const requirements = byId.get(x)!.requirements.filter(r => byId.get(y)!.requirements.includes(r));
    const sharedLiterals = [...left.literals].filter(v => right.literals.has(v)).length;
    const subset = common / Math.max(1, Math.min(left.calls.size, right.calls.size));
    if (similarity >= .55 && (requirements.length >= 2 || sharedLiterals >= 3) || common >= 5 && subset >= .9 && sharedLiterals >= 1) candidates.push({ scenarios: [x, y], similarity: Math.round(Math.max(similarity, subset * .85) * 100) / 100, sharedRequirements: requirements, sharedLiterals });
  }
  candidates.sort((a, b) => b.similarity - a.similarity || b.sharedLiterals - a.sharedLiterals);
  return { inventory: scenarios.length, located: found.size, errors, candidates: candidates.slice(0, 10), candidateCount: candidates.length,
    reviewed: coverageReviews.map(r => ({ scenarios: r.scenarios, reason: r.reason, current: r.scenarios.every((id, i) => found.get(id)?.hash === r.hashes[i]) })),
    sharedPresets: Object.fromEntries(['blank_slate', 'conversation_ready'].map(name => [name, scenarios.filter(s => s.suite === 'desktop' && (s.preset?.name ?? 'blank_slate') === name).map(s => s.id)])),
    fingerprints: Object.fromEntries(items.map(([id, item]) => [id, item.hash])),
    scope: touched ? 'Changed test files compared with inventory; candidate similarity requires semantic review' : 'Inventory triage; candidate similarity requires semantic review',
  };
}
if (process.argv[1]?.endsWith('/audit-inventory.ts')) {
  const { values } = parseArgs({ options: { since: { type: 'string' }, all: { type: 'boolean' }, check: { type: 'boolean' } } });
  if (values.all && values.since) throw new Error('Choose --all or --since');
  const diff = values.all || values.check ? undefined : await changedFiles(process.cwd(), values.since ?? 'HEAD');
  const result = await auditInventory(process.cwd(), diff ? new Set(diff.changes.flatMap(c => [c.before, c.after].filter((p): p is string => !!p))) : undefined);
  if (values.check) console.log(JSON.stringify({ inventory: result.inventory, located: result.located, errors: result.errors }));
  else { const { fingerprints, ...summary } = result; console.log(JSON.stringify(summary, null, 2)); }
  if (result.errors.length) process.exitCode = 1;
}
