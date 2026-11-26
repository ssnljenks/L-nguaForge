/**
 * Regression test: data written by the app before the Phase 1-9 redesign (commit c8a53ac) must still
 * load without loss. The fixture was generated from c8a53ac's own seed data and storage shapes plus
 * user-created records (see REVIEW.md M-11).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DEFAULT_MISSION_CONFIG} from '../data/seedData.ts';
import {
  sanitizeChatThreads,
  sanitizeHistory,
  sanitizeMissionConfig,
  sanitizeSeenTabs,
  sanitizeSessions,
  sanitizeVocabItems,
} from './storageSchemas.ts';

const snapshot = JSON.parse(
  fs.readFileSync(new URL('./__fixtures__/pre-883e95d-storage.json', import.meta.url), 'utf8')
) as Record<string, any>;

test('pre-883e95d config keeps user preferences and defaults Work focus to OFF', () => {
  const config = sanitizeMissionConfig(DEFAULT_MISSION_CONFIG)(snapshot.linguaforge_config_v1);
  assert.ok(config);
  assert.equal(config.language, 'es');
  assert.equal(config.dialect, 'rioplatense');
  assert.equal(config.speechRate, 1.1);
  assert.equal(config.voiceURI, 'Google español');
  assert.equal(config.workFocusEnabled, false);
});

test('pre-883e95d vocab keeps every item and migrates legacy mastery into an FSRS schedule', () => {
  const before = snapshot.linguaforge_vocab_v1 as any[];
  const after = sanitizeVocabItems(before);
  assert.ok(after);
  assert.equal(after.length, before.length);
  const user = after.find((v) => v.id === 'v-user-1');
  assert.ok(user);
  assert.equal(user.term, 'a fin de cuentas');
  assert.equal(user.mastery, 'practicing');
  assert.equal(user.reviewCount, 3);
  assert.ok(user.fsrs, 'legacy item gets an FSRS card');
  assert.ok(Number.isFinite(Date.parse(user.fsrs.dueAt)));
});

test('pre-883e95d sessions keep all messages and the legacy debrief, mapping old probe labels', () => {
  const before = snapshot.linguaforge_sessions_v1 as any[];
  const after = sanitizeSessions(before);
  assert.ok(after);
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i].id, before[i].id);
    assert.equal(after[i].messages.length, before[i].messages.length);
    assert.deepEqual(
      after[i].messages.map((m) => m.text),
      before[i].messages.map((m: any) => m.text)
    );
  }
  const user = after.find((s) => s.id === 'opi-user-1');
  assert.ok(user?.debrief, 'legacy debrief is preserved');
  assert.equal(user.debrief.estimatedIlr, before[0].debrief.estimatedIlr);
  assert.equal(user.debrief.naturalUpgrades.length, before[0].debrief.naturalUpgrades.length);
  const baseline = user.messages.find((_, i) => before[0].messages[i].probeLevel === 'level_2_baseline') as any;
  assert.equal(baseline.workingLevel, 2);
  assert.equal(baseline.probeLevel, 3);
});

test('pre-883e95d history, chat threads and seen tabs survive', () => {
  assert.equal(sanitizeHistory(snapshot.linguaforge_history_v1)?.length, 1);
  const threads = sanitizeChatThreads(snapshot.linguaforge_chat_threads_v1);
  assert.equal(threads?.length, 1);
  assert.equal(threads?.[0].messages.length, 2);
  assert.equal(threads?.[0].messages[1].struggleSuggestions?.length, 1);
  assert.deepEqual(threads?.[0].savedTerms, ['lidiar con']);
  assert.deepEqual(sanitizeSeenTabs(snapshot.linguaforge_seen_tabs_v1), ['talk', 'test_prep', 'vocab']);
});
