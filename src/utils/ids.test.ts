import test from 'node:test';
import assert from 'node:assert/strict';
import {createId} from './ids.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('createId prefixes a v4 UUID and does not collide', () => {
  const ids = new Set(Array.from({length: 1000}, () => createId('chat')));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.match(id.slice('chat-'.length), UUID_V4);
});

test('createId falls back to getRandomValues when randomUUID is unavailable (insecure context)', () => {
  const original = globalThis.crypto.randomUUID;
  Object.defineProperty(globalThis.crypto, 'randomUUID', {value: undefined, configurable: true});
  try {
    assert.match(createId('v').slice(2), UUID_V4);
  } finally {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {value: original, configurable: true});
  }
});
