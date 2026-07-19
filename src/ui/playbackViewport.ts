export const TRANSPORT_SEEK_STEP = 0.25;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeSeekBeat(
  value: number,
  totalBeats: number,
  step = TRANSPORT_SEEK_STEP,
): number {
  const maximum = Math.max(0, totalBeats);
  if (!Number.isFinite(value) || maximum === 0) return 0;
  const snapped = Math.round(clamp(value, 0, maximum) / step) * step;
  return clamp(snapped, 0, maximum);
}

/** Convert a pointer position to a beat without relying on the native range thumb inset. */
export function seekBeatFromPointer(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
  totalBeats: number,
  edgePixels = 12,
): number {
  if (trackWidth <= 0 || totalBeats <= 0) return 0;
  const localX = clamp(clientX - trackLeft, 0, trackWidth);
  if (localX <= Math.min(edgePixels, trackWidth / 2)) return 0;
  if (localX >= trackWidth - Math.min(edgePixels, trackWidth / 2)) return totalBeats;
  return normalizeSeekBeat((localX / trackWidth) * totalBeats, totalBeats);
}

/** Keep the playhead inside a stable viewport window and clamp at both song edges. */
export function pianoRollFollowScroll(
  playheadX: number,
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): number {
  if (clientWidth <= 0) return Math.max(0, scrollLeft);
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  const current = clamp(scrollLeft, 0, maxScroll);
  const leftBoundary = current + 60;
  const rightBoundary = current + clientWidth - 80;
  if (playheadX >= leftBoundary && playheadX <= rightBoundary) return current;
  return clamp(playheadX - clientWidth * 0.35, 0, maxScroll);
}
