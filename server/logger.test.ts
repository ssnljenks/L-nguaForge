import test from 'node:test';
import assert from 'node:assert/strict';
import {describeError, log, requestLogContext, scrubText, setLogSink} from './logger.ts';

function capture(fn: () => void): Record<string, unknown>[] {
  const lines: string[] = [];
  const restore = setLogSink((line) => lines.push(line));
  try {
    fn();
  } finally {
    restore();
  }
  return lines.map((l) => JSON.parse(l));
}

test('scrubText removes API keys and bearer tokens', () => {
  const key = 'AIzaSyA1234567890abcdefghijklmnopqrstuv';
  assert.ok(!scrubText(`request failed for key ${key}`).includes(key));
  assert.ok(!scrubText(`https://x.test/v1?key=${key}&alt=json`).includes(key));
  assert.ok(!scrubText('Authorization: Bearer abcdef1234567890').includes('abcdef1234567890'));
  assert.ok(!scrubText('{"api_key":"supersecretvalue123"}').includes('supersecretvalue123'));
  assert.ok(!scrubText('x-goog-api-key: supersecretvalue123').includes('supersecretvalue123'));
  assert.equal(scrubText('a'.repeat(1000)).length, 301);
});

test('log lines are single-line JSON with severity, event and the request route', () => {
  const [entry] = capture(() =>
    requestLogContext.run({requestId: 'r1', route: 'POST /api/opi/turn'}, () => log.warn('gemini_failure', {ms: 5}))
  );
  assert.equal(entry.severity, 'WARNING');
  assert.equal(entry.event, 'gemini_failure');
  assert.equal(entry.route, 'POST /api/opi/turn');
  assert.equal(entry.ms, 5);
});

test('strings in log fields are scrubbed', () => {
  const [entry] = capture(() => log.info('x', {detail: 'key=AIzaSyA1234567890abcdefghijklmnopqrstuv'}));
  assert.ok(!String(entry.detail).includes('AIza'));
});

test('describeError never includes the text a SyntaxError quotes, but keeps Gemini API messages (scrubbed)', () => {
  let syntax: unknown;
  try {
    JSON.parse('{"learner": "my private sentence", ');
  } catch (err) {
    syntax = err;
  }
  const fields = describeError(syntax);
  assert.equal(fields.errorName, 'SyntaxError');
  assert.equal(fields.errorMessage, undefined);
  assert.ok(!JSON.stringify(fields).includes('private sentence'));

  class ApiError extends Error {
    status = 429;
    constructor(message: string) {
      super(message);
      this.name = 'ApiError';
    }
  }
  const api = describeError(new ApiError('RESOURCE_EXHAUSTED for key AIzaSyA1234567890abcdefghijklmnopqrstuv'));
  assert.equal(api.errorStatus, 429);
  assert.match(String(api.errorMessage), /RESOURCE_EXHAUSTED/);
  assert.ok(!String(api.errorMessage).includes('AIza'));
});

test('stack output keeps frames only, not the message line', () => {
  const err = new Error('learner said: hola me llamo Ana');
  const fields = describeError(err);
  assert.ok(!String(fields.stack).includes('hola me llamo'));
});

test('a field cannot overwrite the log envelope', () => {
  const [entry] = capture(() => log.warn('real_event', {message: 'spoofed', severity: 'INFO', event: 'other'}));
  assert.equal(entry.event, 'real_event');
  assert.equal(entry.message, 'real_event');
  assert.equal(entry.severity, 'WARNING');
});
