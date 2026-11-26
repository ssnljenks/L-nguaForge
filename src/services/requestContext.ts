/**
 * Request context shared by every API call. Kept in its own tiny module so the app shell can set it
 * without importing services/api.ts (which pulls in the offline dictionaries).
 */

let workFocusEnabled = false;

/**
 * Called by App with the Settings "Work focus" state. Every request carries it so the server only
 * uses work/military framing when the user opted in (REVIEW H-3). Endpoints that never use domain
 * content (OPI, role-play) ignore it.
 */
export function setApiWorkFocus(enabled: boolean): void {
  workFocusEnabled = enabled;
}

/** Request body as sent: adds the Work focus flag unless the caller set one explicitly. */
export function withWorkFocus(body: Record<string, unknown>): Record<string, unknown> {
  return 'workFocus' in body ? body : {...body, workFocus: workFocusEnabled};
}
