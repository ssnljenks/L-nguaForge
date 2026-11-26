/**
 * Which first-run overlays the shell may show. `?autostart=1` (used to deep-link straight into a
 * module) skips the tab intros, but never the data-safety notice: it is the only place a user is
 * told not to paste work material before typing into the app (REVIEW L-4).
 */
export function getStartupOverlays(params: {dataSafetyAck: boolean; isAutostart: boolean}): {
  showDataSafetyNotice: boolean;
  allowTabIntros: boolean;
} {
  return {
    showDataSafetyNotice: !params.dataSafetyAck,
    allowTabIntros: !params.isAutostart && params.dataSafetyAck,
  };
}
