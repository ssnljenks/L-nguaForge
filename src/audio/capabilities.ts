/**
 * Browser capability detection and user-facing wording for the mic/audio paths.
 *
 * Mobile browsers differ a lot here, so everything that decides "can we do X" or "what do we tell the user"
 * lives in this one file and takes its inputs as arguments, which keeps it unit-testable without a browser:
 *  - iOS Safari: SpeechRecognition exists but needs Siri & Dictation; audio must be unlocked by a tap;
 *    MediaRecorder records audio/mp4, not webm.
 *  - iOS home-screen app (standalone): same engine, but permission prompts and the speech service are the
 *    least reliable; we never rely on voice alone there.
 *  - Android Chrome: webm/opus recording, continuous recognition that stops by itself after a pause.
 */

export type Platform = 'ios' | 'android' | 'desktop' | 'other';

export interface NavigatorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}

export function detectPlatform(nav: NavigatorLike | undefined): Platform {
  if (!nav) return 'other';
  const ua = nav.userAgent ?? '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  // iPadOS 13+ reports itself as a Mac; a Mac has no touch screen.
  if (/Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'desktop';
  return 'other';
}

export interface BrowserEnv {
  platform: Platform;
  /** Launched from the home screen (iOS `navigator.standalone` or display-mode: standalone). */
  standalone: boolean;
  secureContext: boolean;
}

export function detectEnv(
  win: {
    navigator?: NavigatorLike;
    matchMedia?: (query: string) => {matches: boolean};
    isSecureContext?: boolean;
  } = typeof window === 'undefined' ? {} : (window as unknown as Parameters<typeof detectEnv>[0] & object)
): BrowserEnv {
  const nav = win.navigator;
  let standalone = nav?.standalone === true;
  try {
    standalone = standalone || win.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    // matchMedia unavailable
  }
  return {platform: detectPlatform(nav), standalone, secureContext: win.isSecureContext !== false};
}

let cachedEnv: BrowserEnv | null = null;
/** The current browser, detected once. */
export function getBrowserEnv(): BrowserEnv {
  cachedEnv ??= detectEnv();
  return cachedEnv;
}

/**
 * First MediaRecorder type the browser can record, or undefined to let it choose its own default.
 * Chrome/Android and desktop Firefox record webm/opus; iOS Safari records audio/mp4 (and only supports webm from
 * 18.4), so a hard-coded webm type fails on older iPhones.
 */
export function pickRecorderMimeType(isTypeSupported: ((type: string) => boolean) | undefined): string | undefined {
  if (!isTypeSupported) return undefined;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const type of candidates) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      // Some engines throw for unknown types
    }
  }
  return undefined;
}

const IOS_DICTATION_HINT =
  'Turn on Dictation in Settings › General › Keyboard, or tap the microphone key on your keyboard.';

/**
 * What to tell the user when getUserMedia fails. `name` is the DOMException name; every case ends with the way
 * to carry on (type instead).
 */
export function describeMicError(
  err: unknown,
  env: Pick<BrowserEnv, 'platform' | 'standalone' | 'secureContext'>
): string {
  const name =
    err instanceof DOMException || (err && typeof err === 'object' && 'name' in err)
      ? String((err as {name: unknown}).name)
      : '';
  if (!env.secureContext) {
    return 'The microphone only works on a secure (https) connection. Type your answers instead.';
  }
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return env.platform === 'ios'
        ? env.standalone
          ? 'Microphone access is blocked. Open Settings › Safari › Microphone (or remove and re-add the home-screen app) and allow it. You can type your answers meanwhile.'
          : 'Microphone access is blocked. Tap “aA” in the address bar › Website Settings › Microphone › Allow, then try again. You can type your answers meanwhile.'
        : env.platform === 'android'
          ? 'Microphone access is blocked. Tap the lock icon in the address bar › Permissions › Microphone › Allow, then try again. You can type your answers meanwhile.'
          : 'Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again. You can type your answers meanwhile.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Plug one in or switch to type-instead mode.';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'The microphone is busy. Another app or a phone call may be using it. Close it and try again, or type your answers.';
    default:
      return 'The microphone could not start. Type your answers instead, or reload the page and try again.';
  }
}

/**
 * Text for a SpeechRecognition `error` event, or null when the error is normal and should be ignored
 * (`no-speech`, `aborted`).
 */
export function describeSpeechRecognitionError(
  code: string,
  env: Pick<BrowserEnv, 'platform' | 'standalone'>
): string | null {
  switch (code) {
    case 'no-speech':
    case 'aborted':
      return null;
    case 'not-allowed':
      return env.platform === 'ios'
        ? 'Voice input is blocked. Allow the microphone for this site, then try again. You can also type your answer.'
        : 'Microphone permission denied. Allow microphone access, or type your answer.';
    case 'service-not-allowed':
      return env.platform === 'ios'
        ? `Voice input isn't available${env.standalone ? ' in the home-screen app' : ''} right now. ${IOS_DICTATION_HINT}`
        : 'Voice input is turned off for this browser. Type your answer instead.';
    case 'audio-capture':
      return 'No microphone was found, or another app is using it. Type your answer instead.';
    case 'network':
      return 'Voice input needs an internet connection. Check your connection, or type your answer.';
    case 'language-not-supported':
      return "This device can't recognise speech in this language. Type your answer instead.";
    default:
      return 'Voice input stopped. Tap the mic to try again, or type your answer.';
  }
}

/** True when voice input should not be trusted to work on its own and typing must stay one tap away. */
export function voiceInputIsFragile(env: Pick<BrowserEnv, 'platform' | 'standalone'>): boolean {
  return env.platform === 'ios';
}

export const IOS_VOICE_TIP = `iPhone tip: if the mic doesn't pick you up, type your answer. ${IOS_DICTATION_HINT}`;
