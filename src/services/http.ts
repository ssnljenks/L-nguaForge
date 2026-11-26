import {withWorkFocus} from './requestContext';

/** POSTs JSON with a timeout and returns the parsed body, or throws with the server's error message. */
export async function postJson<T>(url: string, body: Record<string, unknown>, timeoutMs = 45000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(withWorkFocus(body)),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out. Tap Retry to try again.', {cause: err});
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
