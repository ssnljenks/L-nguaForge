import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeMicError,
  describeSpeechRecognitionError,
  detectEnv,
  detectPlatform,
  pickRecorderMimeType,
  voiceInputIsFragile,
} from './capabilities.ts';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15';

test('platform detection: iPhone, iPadOS posing as a Mac, Android, desktop', () => {
  assert.equal(detectPlatform({userAgent: IPHONE}), 'ios');
  assert.equal(detectPlatform({userAgent: MAC, maxTouchPoints: 5}), 'ios', 'iPadOS 13+ reports a Mac with touch');
  assert.equal(detectPlatform({userAgent: MAC, maxTouchPoints: 0}), 'desktop');
  assert.equal(detectPlatform({userAgent: ANDROID}), 'android');
  assert.equal(detectPlatform({userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126'}), 'desktop');
  assert.equal(detectPlatform(undefined), 'other');
});

test('standalone is detected from iOS navigator.standalone and from display-mode', () => {
  assert.equal(detectEnv({navigator: {userAgent: IPHONE, standalone: true}}).standalone, true);
  assert.equal(
    detectEnv({navigator: {userAgent: ANDROID}, matchMedia: (q) => ({matches: q.includes('standalone')})}).standalone,
    true
  );
  assert.equal(detectEnv({navigator: {userAgent: IPHONE}, matchMedia: () => ({matches: false})}).standalone, false);
  assert.equal(detectEnv({navigator: {userAgent: IPHONE}, isSecureContext: false}).secureContext, false);
});

test('recorder type: webm where supported, mp4 on older iPhones, browser default otherwise', () => {
  assert.equal(
    pickRecorderMimeType((t) => t.startsWith('audio/webm')),
    'audio/webm;codecs=opus'
  );
  assert.equal(
    pickRecorderMimeType((t) => t === 'audio/mp4'),
    'audio/mp4'
  );
  assert.equal(
    pickRecorderMimeType(() => false),
    undefined
  );
  assert.equal(pickRecorderMimeType(undefined), undefined);
  assert.equal(
    pickRecorderMimeType(() => {
      throw new Error('boom');
    }),
    undefined
  );
});

test('mic errors give a platform-specific way forward and always mention typing', () => {
  const denied = new DOMException('no', 'NotAllowedError');
  const ios = describeMicError(denied, {platform: 'ios', standalone: false, secureContext: true});
  const iosApp = describeMicError(denied, {platform: 'ios', standalone: true, secureContext: true});
  const android = describeMicError(denied, {platform: 'android', standalone: false, secureContext: true});
  assert.match(ios, /aA/);
  assert.match(iosApp, /Settings › Safari › Microphone/);
  assert.match(android, /lock icon/);
  for (const msg of [ios, iosApp, android]) assert.match(msg, /type/i);
  assert.match(
    describeMicError(new DOMException('x', 'NotFoundError'), {
      platform: 'desktop',
      standalone: false,
      secureContext: true,
    }),
    /No microphone/
  );
  assert.match(
    describeMicError(new DOMException('x', 'NotReadableError'), {
      platform: 'ios',
      standalone: false,
      secureContext: true,
    }),
    /busy/
  );
  assert.match(describeMicError(denied, {platform: 'ios', standalone: false, secureContext: false}), /secure/);
  assert.match(
    describeMicError(new Error('weird'), {platform: 'ios', standalone: false, secureContext: true}),
    /Type your answers/
  );
});

test('speech recognition errors: silence is ignored, real failures explain what to do', () => {
  const env = {platform: 'ios', standalone: true} as const;
  assert.equal(describeSpeechRecognitionError('no-speech', env), null);
  assert.equal(describeSpeechRecognitionError('aborted', env), null);
  assert.match(String(describeSpeechRecognitionError('service-not-allowed', env)), /home-screen app/);
  assert.match(String(describeSpeechRecognitionError('service-not-allowed', env)), /Dictation/);
  assert.match(String(describeSpeechRecognitionError('network', {platform: 'android', standalone: false})), /internet/);
  assert.match(String(describeSpeechRecognitionError('audio-capture', env)), /type/i);
  assert.match(String(describeSpeechRecognitionError('something-new', env)), /type/i);
});

test('voice input is treated as fragile on iPhone only', () => {
  assert.equal(voiceInputIsFragile({platform: 'ios', standalone: false}), true);
  assert.equal(voiceInputIsFragile({platform: 'android', standalone: false}), false);
});
