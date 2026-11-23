import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base64PcmToFloat32,
  computeRmsLevel,
  downsampleFloat32ToInt16Pcm,
  int16ToBase64,
  mergeTranscriptChunk,
  PcmChunker,
  pcm16BytesToFloat32,
} from './liveAudio.ts';

test('downsampleFloat32ToInt16Pcm accurately downsamples 48kHz to 16kHz and clamps peaks', () => {
  const input = new Float32Array(480);
  for (let i = 0; i < input.length; i++) {
    input[i] = i < 240 ? 1.5 : -1.5;
  }
  const pcm = downsampleFloat32ToInt16Pcm(input, 48000, 16000);
  assert.equal(pcm.length, 160);
  assert.equal(pcm[0], 32767);
  assert.equal(pcm[pcm.length - 1], -32768);
});

test('int16ToBase64 and base64PcmToFloat32 round-trip PCM samples accurately', () => {
  const src = new Int16Array([0, 16384, -16384, 32767, -32768]);
  const b64 = int16ToBase64(src);
  const floats = base64PcmToFloat32(b64);
  assert.equal(floats.length, src.length);
  assert.ok(Math.abs(floats[0] - 0) < 0.001);
  assert.ok(Math.abs(floats[1] - 0.5) < 0.001);
  assert.ok(Math.abs(floats[2] + 0.5) < 0.001);
  assert.ok(Math.abs(floats[3] - 1) < 0.001);
  assert.ok(Math.abs(floats[4] + 1) < 0.001);
});

test('computeRmsLevel returns bounded 0..1 audio energy', () => {
  assert.equal(computeRmsLevel(new Float32Array(0)), 0);
  assert.equal(computeRmsLevel(new Float32Array([0, 0, 0])), 0);
  const loud = computeRmsLevel(new Float32Array([0.8, -0.8, 0.8, -0.8]));
  assert.equal(loud, 1);
  const quiet = computeRmsLevel(new Float32Array([0.05, -0.05, 0.05, -0.05]));
  assert.ok(quiet > 0 && quiet < 0.5);
});

test('mergeTranscriptChunk joins streaming chunks cleanly without corrupting punctuation', () => {
  assert.equal(mergeTranscriptChunk('', ' Hola'), 'Hola');
  assert.equal(mergeTranscriptChunk('Hola', '¿cómo estás?'), 'Hola ¿cómo estás?');
  assert.equal(mergeTranscriptChunk('Muy bien', ', gracias.'), 'Muy bien, gracias.');
  assert.equal(mergeTranscriptChunk('Hola ', 'amigo'), 'Hola amigo');
  assert.equal(mergeTranscriptChunk('Olá', 'Olá, tudo bem?'), 'Olá, tudo bem?');
});

test('base64PcmToFloat32 gracefully handles corrupt, empty, or URL-safe base64 payloads', () => {
  assert.equal(base64PcmToFloat32('').length, 0);
  assert.equal(base64PcmToFloat32('!!!not-valid-base64!!!').length, 0);
  const src = new Int16Array([12000, -12000]);
  const standard = int16ToBase64(src);
  const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const decoded = base64PcmToFloat32(urlSafe);
  assert.equal(decoded.length, 2);
  assert.ok(Math.abs(decoded[0] - 12000 / 32768) < 0.001);
  assert.ok(Math.abs(decoded[1] + 12000 / 32768) < 0.001);
});

test('pcm16BytesToFloat32 decodes little-endian Int16 and ignores a trailing odd byte', () => {
  const bytes = new Uint8Array([0x00, 0x40, 0x00, 0xc0, 0xff, 0x7f, 0x01]);
  const floats = pcm16BytesToFloat32(bytes);
  assert.equal(floats.length, 3);
  assert.equal(floats[0], 0.5);
  assert.equal(floats[1], -0.5);
  assert.ok(Math.abs(floats[2] - 32767 / 32768) < 1e-9);
});

test('PcmChunker emits fixed 100 ms chunks at 16 kHz from 128-sample worklet blocks', () => {
  const chunker = new PcmChunker(48000, 16000, 100);
  const block = new Float32Array(128).fill(0.25);
  const chunks = [];
  for (let i = 0; i < 100; i++) chunks.push(...chunker.push(block)); // 12,800 samples = 2 full chunks + remainder
  assert.equal(chunks.length, 2);
  for (const chunk of chunks) {
    assert.equal(chunk.pcm.length, 1600); // 100 ms at 16 kHz
    assert.equal(chunk.pcm[0], Math.round(0.25 * 0x7fff));
    assert.ok(chunk.rms > 0 && chunk.rms <= 1);
  }
});

test('PcmChunker passes through when input is already 16 kHz and handles oversized pushes', () => {
  const chunker = new PcmChunker(16000, 16000, 100);
  const chunks = chunker.push(new Float32Array(4000));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].pcm.length, 1600);
});
