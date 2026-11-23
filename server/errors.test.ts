import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyGeminiError, isTransientGeminiError, toPublicError, UserFacingError} from './errors.ts';

function apiError(status: number, message: string) {
  return Object.assign(new Error(message), {status});
}

// toPublicError logs unexpected errors; keep test output quiet.
console.error = () => {};

test('classifyGeminiError prefers numeric status and falls back to message text', () => {
  assert.equal(classifyGeminiError(apiError(403, 'nope')), 'auth');
  assert.equal(classifyGeminiError(apiError(400, 'API key not valid. Please pass a valid API key.')), 'auth');
  assert.equal(classifyGeminiError(apiError(429, 'slow down')), 'rate_limited');
  assert.equal(classifyGeminiError(new Error('RESOURCE_EXHAUSTED')), 'rate_limited');
  assert.equal(classifyGeminiError(apiError(503, 'x')), 'unavailable');
  assert.equal(classifyGeminiError(new Error('The model is overloaded due to high demand')), 'unavailable');
  assert.equal(classifyGeminiError(apiError(404, 'x')), 'model_not_found');
  assert.equal(classifyGeminiError(new Error('boom')), 'unknown');
});

test('isTransientGeminiError is true only for rate limits and unavailability', () => {
  assert.equal(isTransientGeminiError(apiError(429, '')), true);
  assert.equal(isTransientGeminiError(apiError(503, '')), true);
  assert.equal(isTransientGeminiError(apiError(403, '')), false);
  assert.equal(isTransientGeminiError(new Error('boom')), false);
});

test('toPublicError passes through UserFacingError and hides unknown error details', () => {
  assert.deepEqual(toPublicError(new UserFacingError(400, 'Bad input.')), {status: 400, message: 'Bad input.'});
  const hidden = toPublicError(new Error('database password is hunter2'));
  assert.equal(hidden.status, 500);
  assert.ok(!hidden.message.includes('hunter2'));
  const notFound = toPublicError(apiError(404, 'models/gemini-secret-model is not found'));
  assert.equal(notFound.status, 502);
  assert.ok(!notFound.message.includes('gemini-secret-model'));
});
