import test from 'node:test';
import assert from 'node:assert/strict';
import {setApiWorkFocus, withWorkFocus} from './requestContext.ts';

test('every request body carries the current Work focus setting (REVIEW H-3)', () => {
  setApiWorkFocus(false);
  assert.deepEqual(withWorkFocus({language: 'es'}), {language: 'es', workFocus: false});
  setApiWorkFocus(true);
  assert.deepEqual(withWorkFocus({language: 'es'}), {language: 'es', workFocus: true});
  // An explicit value from the caller wins.
  assert.deepEqual(withWorkFocus({workFocus: false}), {workFocus: false});
  setApiWorkFocus(false);
});
