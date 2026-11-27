import {useEffect} from 'react';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
}

/**
 * Keeps the screen on while `active` (a phone call or live voice session). Calls are mostly talking, so a phone
 * would otherwise auto-lock after its idle timeout and take the microphone and the connection with it.
 * Uses the Screen Wake Lock API (Android Chrome, iOS Safari 16.4+); where it is missing or refused nothing
 * happens and the call works as before. The lock is dropped whenever the page is hidden, so it is requested
 * again when the page becomes visible.
 */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined') return;
    const wakeLock = (navigator as unknown as {wakeLock?: {request: (type: 'screen') => Promise<WakeLockSentinelLike>}})
      .wakeLock;
    if (!wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const next = await wakeLock.request('screen');
        if (cancelled) {
          void next.release().catch(() => {});
          return;
        }
        sentinel = next;
      } catch {
        // Refused (battery saver, no permission): not worth interrupting the call for.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !cancelled) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
