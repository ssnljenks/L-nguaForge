import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIEF_ILR_LEVELS,
  BRIEF_TOPICS,
  filterBriefItems,
  formatBriefLength,
  getTopicLabel,
  isBriefIlrLevel,
  isBriefTopic,
  scoreBriefDrill,
  PRACTICE_STORY_SOURCE_NAME,
  SEED_BRIEF_ITEMS,
} from './briefLogic.ts';
import type {BriefDrillQuestion, BriefItem} from '../types.ts';

test('brief topic and level constants and type guards', () => {
  assert.equal(BRIEF_TOPICS.length, 6);
  assert.ok(isBriefTopic('politics'));
  assert.ok(isBriefTopic('security'));
  assert.ok(!isBriefTopic('sports'));
  assert.equal(getTopicLabel('scitech'), 'Sci/Tech');
  assert.equal(getTopicLabel('society'), 'Society');

  assert.deepEqual(BRIEF_ILR_LEVELS, ['2', '2+', '3', '3+']);
  assert.ok(isBriefIlrLevel('2+'));
  assert.ok(isBriefIlrLevel('3'));
  assert.ok(!isBriefIlrLevel('1+'));
  assert.ok(!isBriefIlrLevel('4'));
});

test('formatBriefLength formats audio as minutes and text as word count', () => {
  assert.equal(formatBriefLength('audio', 2.3), '~2 min broadcast');
  assert.equal(formatBriefLength('audio', 0.8), '~1 min broadcast');
  assert.equal(formatBriefLength('text', 2.5), '~600 words');
  assert.equal(formatBriefLength('text', 1), '~200 words');
});

/**
 * Feed-shaped fixture for the filter tests: the practice stories plus audio variants of some of them,
 * so filtering logic is tested independently of what the built-in seed set happens to contain.
 */
const AUDIO_FIXTURE_IDS = new Set(['es-seed-maritime-01', 'es-seed-culture-04', 'pt-seed-maritime-01']);
const FEED_FIXTURE: BriefItem[] = SEED_BRIEF_ITEMS.map((item) =>
  AUDIO_FIXTURE_IDS.has(item.id)
    ? {...item, mediaType: 'audio', audioUrl: 'https://audio.example.test/clip.mp3', sourceName: 'Test Radio'}
    : item
);

test('filterBriefItems filters by language and mediaType accurately', () => {
  const esAudio = filterBriefItems(FEED_FIXTURE, {
    language: 'es',
    mediaType: 'audio',
  });
  assert.ok(esAudio.length > 0);
  assert.ok(esAudio.every((i) => i.language === 'es' && i.mediaType === 'audio'));

  const ptText = filterBriefItems(FEED_FIXTURE, {
    language: 'pt',
    mediaType: 'text',
  });
  assert.ok(ptText.length > 0);
  assert.ok(ptText.every((i) => i.language === 'pt' && i.mediaType === 'text'));
});

test('filterBriefItems filters by ILR level and topic', () => {
  const level3 = filterBriefItems(SEED_BRIEF_ITEMS, {
    language: 'es',
    mediaType: 'text',
    level: '3',
  });
  assert.ok(level3.every((i) => i.ilrLevel === '3'));

  const security = filterBriefItems(SEED_BRIEF_ITEMS, {
    language: 'es',
    mediaType: 'audio',
    topic: 'security',
  });
  assert.ok(security.every((i) => i.topic === 'security'));
});

test('filterBriefItems supports work focus domain filtering', () => {
  const workMatches = filterBriefItems(FEED_FIXTURE, {
    language: 'es',
    mediaType: 'audio',
    workFilter: true,
    userDomain: 'maritime_surveillance',
  });
  assert.ok(workMatches.length >= 1);
  assert.ok(workMatches.every((i) => i.matchingDomains.includes('maritime_surveillance')));

  const nonMatching = filterBriefItems(FEED_FIXTURE, {
    language: 'es',
    mediaType: 'text',
    workFilter: true,
    userDomain: 'delegation_hosting',
  });
  assert.equal(nonMatching.length, 0);
});

test('filterBriefItems matches search query across title, summary, and orientation', () => {
  const searchResults = filterBriefItems(FEED_FIXTURE, {
    language: 'es',
    mediaType: 'audio',
    searchQuery: 'semisumergible',
  });
  assert.equal(searchResults.length, 1);
  assert.ok(searchResults[0].title.includes('semisumergible'));
});

test('scoreBriefDrill calculates score percentage and qualitative rating label', () => {
  const sampleQuestions: BriefDrillQuestion[] = [
    {
      id: 'q1',
      question: 'What triggered the interdiction?',
      questionEnglish: 'What triggered the interdiction?',
      options: ['Routine radar contact', 'Intelligence report', 'Unflagged vessel', 'Distress beacon'],
      correctIndex: 2,
      explanation: 'The passage specifies an unflagged vessel.',
      rationaleEnglish: 'The passage specifies an unflagged vessel.',
      targetVocabulary: [{term: 'semisumergible', english: 'semi-submersible'}],
    },
    {
      id: 'q2',
      question: 'Where did the event occur?',
      questionEnglish: 'Where did the event occur?',
      options: ['Caribbean basin', 'Pacific waters', 'Atlantic EEZ', 'River delta'],
      correctIndex: 1,
      explanation: 'Pacific waters 80 nm offshore.',
      rationaleEnglish: 'Pacific waters 80 nm offshore.',
      targetVocabulary: [],
    },
    {
      id: 'q3',
      question: 'What agencies coordinated?',
      questionEnglish: 'What agencies coordinated?',
      options: ['Coast guard and partner aircraft', 'Police only', 'Commercial tugs', 'Navy divers'],
      correctIndex: 0,
      explanation: 'Coordinated with partner aircraft.',
      rationaleEnglish: 'Coordinated with partner aircraft.',
      targetVocabulary: [],
    },
  ];

  const fullScore = scoreBriefDrill({q1: 2, q2: 1, q3: 0}, sampleQuestions, '2+');
  assert.equal(fullScore.correctCount, 3);
  assert.equal(fullScore.percentage, 100);
  assert.ok(fullScore.ratingLabel.includes('Full Comprehension'));

  const partialScore = scoreBriefDrill({q1: 2, q2: 0, q3: 0}, sampleQuestions, '2+');
  assert.equal(partialScore.correctCount, 2);
  assert.equal(partialScore.percentage, 67);
  assert.ok(partialScore.ratingLabel.includes('Solid Comprehension'));

  const lowScore = scoreBriefDrill({q1: 0, q2: 0, q3: 1}, sampleQuestions, '2+');
  assert.equal(lowScore.correctCount, 0);
  assert.equal(lowScore.percentage, 0);
  assert.ok(lowScore.ratingLabel.includes('Review Needed'));
});

test('SEED_BRIEF_ITEMS are honestly labeled practice stories: no real outlet, link or audio (REVIEW C-1)', () => {
  assert.ok(SEED_BRIEF_ITEMS.length >= 8);
  for (const item of SEED_BRIEF_ITEMS) {
    assert.ok(item.id.length > 0);
    assert.ok(item.title.length > 0);
    assert.equal(item.sourceName, PRACTICE_STORY_SOURCE_NAME);
    assert.equal(item.sourceUrl, '', `${item.id} must not link to a real publisher`);
    assert.equal(item.audioUrl, undefined, `${item.id} must not point at unrelated audio`);
    assert.equal(item.mediaType, 'text');
    assert.ok(item.orientationLine.startsWith('Practice passage written for LinguaForge (not a real news report)'));
    assert.ok(item.summary.length > 20);
    assert.ok(isBriefTopic(item.topic));
    assert.ok(isBriefIlrLevel(item.ilrLevel));
  }
  assert.ok(SEED_BRIEF_ITEMS.some((i) => i.language === 'es'));
  assert.ok(SEED_BRIEF_ITEMS.some((i) => i.language === 'pt'));
});
