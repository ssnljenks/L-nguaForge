import test from 'node:test';
import assert from 'node:assert/strict';
import {createErrorReporter, MAX_REPORTS_PER_PAGE, REPEAT_INTERVAL_MS} from './errorReporter.ts';

function setup() {
  let now = 1_000;
  const sent: Record<string, unknown>[] = [];
  const reporter = createErrorReporter({
    now: () => now,
    env: () => ({platform: 'ios', standalone: true, online: true}),
    send: (body) => sent.push(JSON.parse(body)),
  });
  return {reporter, sent, advance: (ms: number) => (now += ms)};
}

test('a report carries only the fixed fields', () => {
  const {reporter, sent} = setup();
  reporter.report({kind: 'audio', message: 'NotAllowedError: Permission denied', stack: 'a\nb'});
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0]).sort(), [
    'count',
    'kind',
    'message',
    'online',
    'platform',
    'stack',
    'standalone',
    'tab',
  ]);
  assert.equal(sent[0].platform, 'ios');
  assert.equal(sent[0].standalone, true);
});

test('a repeat is sent once, then at most once a minute with a count', () => {
  const {reporter, sent, advance} = setup();
  for (let i = 0; i < 5; i++) reporter.report({kind: 'speech', message: 'network'});
  assert.equal(sent.length, 1);
  advance(REPEAT_INTERVAL_MS + 1);
  reporter.report({kind: 'speech', message: 'network'});
  assert.equal(sent.length, 2);
  assert.equal(sent[1].count, 5, '4 suppressed + this one');
});

test('different errors are not merged, and a page load is capped', () => {
  const {reporter, sent} = setup();
  for (let i = 0; i < MAX_REPORTS_PER_PAGE + 10; i++) reporter.report({kind: 'other', message: `e${i}`});
  assert.equal(sent.length, MAX_REPORTS_PER_PAGE);
});
