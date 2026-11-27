import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoleplayTokenSealer, ROLEPLAY_TOKEN_TTL_MS, type RoleplaySecretRecord} from './roleplayToken.ts';

const record: RoleplaySecretRecord = {
  scenarioId: 'rp-1',
  level: 2,
  language: 'es',
  dialect: 'neutral_latam',
  situationEnglish: 'Your hotel lost your reservation.',
  learnerGoal: 'Get a room.',
  register: 'usted',
  characterRole: 'Hotel clerk',
  hiddenGoal: 'Needs a passport number. CANARY-GOAL',
  complication: 'Only a smoking room is left. CANARY-TWIST',
};

test('a sealed scenario opens with the same key and hides its secrets', () => {
  const sealer = createRoleplayTokenSealer(['key-a']);
  const token = sealer.seal(record, 1_000);
  assert.match(token, /^v1\./);
  assert.ok(!token.includes('CANARY'));
  assert.ok(!Buffer.from(token.slice(3), 'base64url').toString('utf8').includes('CANARY'));
  const opened = sealer.open(token, 2_000);
  assert.ok(opened.ok);
  assert.deepEqual(opened.record, record);
});

test('another instance with the same secret can open it; a different secret cannot', () => {
  const token = createRoleplayTokenSealer(['shared']).seal(record);
  assert.ok(createRoleplayTokenSealer(['shared']).open(token).ok);
  const other = createRoleplayTokenSealer(['different']).open(token);
  assert.deepEqual(other, {ok: false, reason: 'unreadable'});
});

test('a restart with no configured secret invalidates old tokens instead of guessing', () => {
  const first = createRoleplayTokenSealer([]);
  const second = createRoleplayTokenSealer([]);
  assert.equal(first.ephemeral, true);
  assert.ok(first.open(first.seal(record)).ok);
  assert.equal(second.open(first.seal(record)).ok, false);
});

test('secrets can be rotated: the first seals, every listed secret opens', () => {
  const oldToken = createRoleplayTokenSealer(['old']).seal(record);
  const rotated = createRoleplayTokenSealer(['new', 'old']);
  assert.ok(rotated.open(oldToken).ok);
  assert.ok(createRoleplayTokenSealer(['new']).open(rotated.seal(record)).ok);
  assert.equal(createRoleplayTokenSealer(['new']).open(oldToken).ok, false);
});

test('tokens expire', () => {
  const sealer = createRoleplayTokenSealer(['k']);
  const token = sealer.seal(record, 10_000);
  assert.ok(sealer.open(token, 10_000 + ROLEPLAY_TOKEN_TTL_MS - 1).ok);
  assert.deepEqual(sealer.open(token, 10_000 + ROLEPLAY_TOKEN_TTL_MS), {ok: false, reason: 'expired'});
});

test('missing, malformed and tampered tokens are rejected', () => {
  const sealer = createRoleplayTokenSealer(['k']);
  const token = sealer.seal(record);
  assert.deepEqual(sealer.open(undefined), {ok: false, reason: 'missing'});
  assert.deepEqual(sealer.open(''), {ok: false, reason: 'missing'});
  assert.deepEqual(sealer.open(42), {ok: false, reason: 'missing'});
  assert.deepEqual(sealer.open('not-a-token'), {ok: false, reason: 'malformed'});
  assert.deepEqual(sealer.open('v1.abc'), {ok: false, reason: 'malformed'});
  assert.deepEqual(sealer.open(`v1.${'A'.repeat(5000)}`), {ok: false, reason: 'malformed'});
  const flipped = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
  assert.equal(sealer.open(flipped).ok, false);
  const bytes = Buffer.from(token.slice(3), 'base64url');
  bytes[20] ^= 1;
  assert.equal(sealer.open(`v1.${bytes.toString('base64url')}`).ok, false);
});

test('every seal uses a fresh nonce', () => {
  const sealer = createRoleplayTokenSealer(['k']);
  assert.notEqual(sealer.seal(record), sealer.seal(record));
});
