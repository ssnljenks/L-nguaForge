import {withWorkFocus} from './requestContext';

export const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;

export const OFFLINE_MESSAGE = "You're offline. Reconnect to the internet and try again — saved Vocab still works.";
export const NETWORK_ERROR_MESSAGE = "Can't reach LinguaForge right now. Check your connection and try again.";

/**
 * Sends a request with a timeout and returns the parsed JSON body, or throws with the server's
 * `error` message (falling back to the status) so screens can show it.
 */
async function requestJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {...init, signal: controller.signal});
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out. Tap Retry to try again.', {cause: err});
    }
    // fetch() rejects with a TypeError ("Failed to fetch") when the network is down.
    if (err instanceof TypeError) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      throw new Error(offline ? OFFLINE_MESSAGE : NETWORK_ERROR_MESSAGE, {cause: err});
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text();
  let data: Record<string, unknown> | null = null;
  if (rawText.trim()) {
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const errMsg =
      typeof data?.error === 'string' && data.error.trim() ? data.error : `Request failed (${response.status})`;
    throw new Error(errMsg);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Server returned an unexpected empty response. Please try again.');
  }
  return data as T;
}

/** POSTs JSON (with the Work focus flag) and returns the parsed response. */
export function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<T> {
  return requestJson<T>(
    url,
    {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(withWorkFocus(body))},
    timeoutMs
  );
}

/** GETs JSON with the same timeout and error handling as `postJson` (REVIEW L-5). */
export function getJson<T>(url: string, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
  return requestJson<T>(url, {method: 'GET', headers: {Accept: 'application/json'}}, timeoutMs);
}
