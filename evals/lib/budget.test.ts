import assert from 'node:assert/strict';
import test from 'node:test';
import {Budget, BudgetExceededError, estimateCostUsd} from './budget.ts';
import {createMemoryCache, hashInput} from './cache.ts';
import {createEvalGenerator, type Runtime} from './llm.ts';
import {createStubGenerator} from './stubGenerator.ts';
import {MODELS} from '../../server/config.ts';
import {Type} from '@google/genai';
import {ThinkingLevel} from '../../server/gemini.ts';
import {BUDGETS} from '../../server/gemini.ts';

function runtime(maxCalls: number, maxCostUsd = 100) {
  const calls: {model: string; contents: string}[] = [];
  const rt: Runtime = {
    budget: new Budget({maxCalls, maxCostUsd}),
    cache: createMemoryCache(),
    live: createStubGenerator(calls),
  };
  return {rt, calls};
}
const req = (contents: string) => ({
  model: MODELS.standard,
  contents,
  thinkingLevel: ThinkingLevel.LOW,
  responseSchema: {type: Type.OBJECT, properties: {a: {type: Type.STRING}}, required: ['a']},
  emptyMessage: 'empty',
  budget: BUDGETS.standard,
});

test('call cap is hard: the (cap+1)th live call throws and is not made', async () => {
  const {rt, calls} = runtime(2);
  const gen = createEvalGenerator(rt, {feature: 'f', itemId: 'i'});
  await gen(req('one'));
  await gen(req('two'));
  await assert.rejects(() => gen(req('three')), BudgetExceededError);
  assert.equal(calls.length, 2);
});

test('cost cap is hard', async () => {
  const {rt, calls} = runtime(100, 0.0000001);
  const gen = createEvalGenerator(rt, {feature: 'f', itemId: 'i'});
  await assert.rejects(() => gen(req('x')), BudgetExceededError);
  assert.equal(calls.length, 0);
});

test('identical inputs are served from cache for free; changing the prompt or itemId misses', async () => {
  const {rt, calls} = runtime(10);
  const a = createEvalGenerator(rt, {feature: 'f', itemId: 'i1'});
  await a(req('same'));
  await a(req('same'));
  assert.equal(calls.length, 1);
  assert.equal(rt.budget.cacheHits, 1);
  await a(req('different'));
  await createEvalGenerator(rt, {feature: 'f', itemId: 'i2'})(req('same'));
  assert.equal(calls.length, 3);
});

test('hash is stable and input-sensitive', () => {
  assert.equal(hashInput({a: 1}), hashInput({a: 1}));
  assert.notEqual(hashInput({a: 1}), hashInput({a: 2}));
});

test('cost estimate scales with tokens', () => {
  assert.ok(estimateCostUsd('chat', 2_000_000, 0) > estimateCostUsd('fast', 2_000_000, 0));
  assert.equal(estimateCostUsd('standard', 0, 0), 0);
});
