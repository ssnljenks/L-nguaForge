import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  computeAnimatedBarHeights,
  computeWaveformProgress,
  formatAudioTime,
  generateWaveformEnvelope,
  hashSeed,
} from './waveformMath.ts';

describe('waveformMath', () => {
  it('hashes seeds deterministically and differentiates distinct IDs', () => {
    assert.equal(hashSeed('brief-es-01'), hashSeed('brief-es-01'));
    assert.notEqual(hashSeed('brief-es-01'), hashSeed('brief-pt-02'));
  });

  it('generates deterministic, bounded speech envelopes of the requested bar count', () => {
    const a1 = generateWaveformEnvelope('clip-alpha', 48);
    const a2 = generateWaveformEnvelope('clip-alpha', 48);
    const b1 = generateWaveformEnvelope('clip-beta', 48);

    assert.equal(a1.length, 48);
    assert.deepEqual(a1, a2);
    assert.notDeepEqual(a1, b1);

    for (const v of a1) {
      assert.ok(v >= 0.14 && v <= 0.94, `Expected ${v} to be within [0.14, 0.94]`);
    }
  });

  it('animates bar heights smoothly while playing and stays stable when idle or reducedMotion', () => {
    const envelope = generateWaveformEnvelope('clip-voice', 32);

    const idleA = computeAnimatedBarHeights({envelope, elapsedSec: 0, isPlaying: false});
    const idleB = computeAnimatedBarHeights({envelope, elapsedSec: 2.5, isPlaying: false});
    assert.deepEqual(idleA, idleB);

    const reducedA = computeAnimatedBarHeights({
      envelope,
      elapsedSec: 0,
      isPlaying: true,
      reducedMotion: true,
    });
    const reducedB = computeAnimatedBarHeights({
      envelope,
      elapsedSec: 3.1,
      isPlaying: true,
      reducedMotion: true,
    });
    assert.deepEqual(reducedA, reducedB);

    const playingT0 = computeAnimatedBarHeights({
      envelope,
      elapsedSec: 0.2,
      isPlaying: true,
      progress: 0.3,
    });
    const playingT1 = computeAnimatedBarHeights({
      envelope,
      elapsedSec: 0.85,
      isPlaying: true,
      progress: 0.35,
    });

    assert.notDeepEqual(playingT0, playingT1);
    for (const h of [...playingT0, ...playingT1]) {
      assert.ok(h >= 0.12 && h <= 1.0, `Expected animated bar ${h} within [0.12, 1.0]`);
    }
  });

  it('flattens bars when hasError is true', () => {
    const envelope = generateWaveformEnvelope('clip-err', 24);
    const errorBars = computeAnimatedBarHeights({
      envelope,
      elapsedSec: 1.0,
      isPlaying: false,
      hasError: true,
    });
    for (const h of errorBars) {
      assert.ok(h >= 0.12 && h <= 0.3, `Expected error bar ${h} <= 0.3`);
    }
  });

  it('computes clamped playback progress across finite, streaming, and completed states', () => {
    assert.equal(computeWaveformProgress(0, 0, false, false), 0);
    assert.equal(computeWaveformProgress(15, Number.NaN, false, true), 0);
    assert.equal(computeWaveformProgress(30, 120, false, true), 0.25);
    assert.equal(computeWaveformProgress(140, 120, false, true), 1);
    assert.equal(computeWaveformProgress(0, 0, true, false), 1);
  });

  it('formats audio timestamps reliably', () => {
    assert.equal(formatAudioTime(0), '0:00');
    assert.equal(formatAudioTime(-5), '0:00');
    assert.equal(formatAudioTime(Number.NaN), '0:00');
    assert.equal(formatAudioTime(7.9), '0:07');
    assert.equal(formatAudioTime(65), '1:05');
    assert.equal(formatAudioTime(125.4), '2:05');
  });
});
