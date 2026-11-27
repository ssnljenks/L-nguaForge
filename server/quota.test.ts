import test from 'node:test';
import assert from 'node:assert/strict';
import {UserFacingError} from './errors.ts';
import {createDailyBudget, createDailyKeyedCounter, GEMINI_DAILY_CAP_MESSAGE} from './quota.ts';

const DAY = 24 * 60 * 60 * 1000;

test('the daily Gemini budget refuses calls once the cap is spent and resets at 00:00 UTC', () => {
  let now = Date.UTC(2026, 0, 1, 23, 0, 0);
  const budget = createDailyBudget(3, () => now);
  for (let i = 0; i < 3; i++) {
    budget.assertAvailable();
    budget.record();
  }
  assert.throws(
    () => budget.assertAvailable(),
    (err) => err instanceof UserFacingError && err.status === 429 && err.message === GEMINI_DAILY_CAP_MESSAGE
  );
  assert.equal(budget.used(), 3);
  now += 2 * 60 * 60 * 1000; // 01:00 UTC the next day
  budget.assertAvailable();
  assert.equal(budget.used(), 0);
  now += DAY;
  budget.assertAvailable();
});

test('retries count against the budget and a cap of 0 means unlimited', () => {
  const unlimited = createDailyBudget(0);
  for (let i = 0; i < 100; i++) unlimited.record();
  unlimited.assertAvailable();
  const capped = createDailyBudget(2);
  capped.record();
  capped.record(); // a retry spends quota like any attempt
  assert.throws(() => capped.assertAvailable());
});

test('the keyed daily counter caps each key separately', () => {
  let now = Date.UTC(2026, 0, 1, 12);
  const counter = createDailyKeyedCounter(() => now);
  assert.equal(counter.tryTake('a', 2), true);
  assert.equal(counter.tryTake('a', 2), true);
  assert.equal(counter.tryTake('a', 2), false);
  assert.equal(counter.tryTake('b', 2), true);
  assert.equal(counter.tryTake('a', 0), true, 'cap 0 = unlimited');
  now += DAY;
  assert.equal(counter.tryTake('a', 2), true);
});
