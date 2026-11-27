/**
 * Plumbing test: runs every eval feature end to end (real routes, real prompts, real scorers) against a
 * schema-shaped STUB model. The stub's output has no quality signal, so scores are meaningless here; this only
 * proves the harness, scorers and report do not crash and that each feature produces well-formed results.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {Budget} from './lib/budget.ts';
import {createMemoryCache} from './lib/cache.ts';
import type {Runtime} from './lib/llm.ts';
import {renderReport} from './lib/report.ts';
import {buildMeta} from './lib/report.ts';
import {createStubGenerator} from './lib/stubGenerator.ts';
import type {FeatureResult} from './lib/types.ts';
import {FEATURES} from './features/index.ts';

console.error = () => {};

test('every feature runs against a stub model and the report renders', {timeout: 120_000}, async () => {
  const budget = new Budget({maxCalls: 5000, maxCostUsd: 1000});
  const rt: Runtime = {budget, cache: createMemoryCache(), live: createStubGenerator()};
  const results: FeatureResult[] = [];
  for (const f of FEATURES) {
    const r = await f.run(rt, {sample: 2, concurrency: 2});
    assert.equal(r.id, f.id);
    assert.ok(r.cases.length > 0, `${f.id} produced no cases`);
    assert.ok(r.thresholds.length > 0, `${f.id} has no thresholds`);
    for (const c of r.cases) assert.ok(c.notRun || c.checks.length > 0, `${f.id}/${c.id} has no checks`);
    results.push(r);
  }
  const md = renderReport({meta: buildMeta('smoke', 2, budget, []), features: results});
  assert.match(md, /## Pass rate per feature/);
  for (const f of FEATURES) assert.ok(md.includes(f.title), f.title);
  assert.ok(budget.calls > 20);
});

test('a tiny call cap marks cases "not run" instead of exceeding the cap', {timeout: 60_000}, async () => {
  const budget = new Budget({maxCalls: 3, maxCostUsd: 1000});
  const rt: Runtime = {budget, cache: createMemoryCache(), live: createStubGenerator()};
  const safety = FEATURES.find((f) => f.id === 'safety')!;
  const r = await safety.run(rt, {sample: 6, concurrency: 1});
  assert.ok(
    r.cases.some((c) => c.notRun),
    'expected some cases to be not run'
  );
  assert.ok(Math.max(budget.calls, budget.attempts) <= 3);
});
