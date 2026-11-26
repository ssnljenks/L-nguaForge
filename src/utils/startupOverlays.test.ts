import test from 'node:test';
import assert from 'node:assert/strict';
import {getStartupOverlays} from './startupOverlays.ts';

test('?autostart=1 still shows the data-safety notice until it is acknowledged (REVIEW L-4)', () => {
  assert.deepEqual(getStartupOverlays({dataSafetyAck: false, isAutostart: true}), {
    showDataSafetyNotice: true,
    allowTabIntros: false,
  });
  assert.deepEqual(getStartupOverlays({dataSafetyAck: true, isAutostart: true}), {
    showDataSafetyNotice: false,
    allowTabIntros: false,
  });
  assert.deepEqual(getStartupOverlays({dataSafetyAck: false, isAutostart: false}), {
    showDataSafetyNotice: true,
    allowTabIntros: false,
  });
  assert.deepEqual(getStartupOverlays({dataSafetyAck: true, isAutostart: false}), {
    showDataSafetyNotice: false,
    allowTabIntros: true,
  });
});
