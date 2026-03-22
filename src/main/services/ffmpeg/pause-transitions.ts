import type { PauseTimestamp } from '../../../shared/types';

/** Duration in seconds for each fade transition */
const FADE_DURATION = 0.3;

/**
 * Build an FFmpeg video filter string that applies fade-to-black / fade-from-black
 * transitions at each pause/resume cut point.
 *
 * For each cut point:
 * - fade=t=out starting 0.3s before the cut (last frames before pause)
 * - fade=t=in starting at the cut (first frames after resume)
 *
 * Multiple fade filters are chained with commas for FFmpeg's filtergraph.
 *
 * @returns The filter string, or undefined if there are no cut points.
 */
export function buildPauseTransitionFilter(
  pauseTimestamps: PauseTimestamp[] | undefined,
): string | undefined {
  if (!pauseTimestamps || pauseTimestamps.length === 0) {
    return undefined;
  }

  const filters: string[] = [];

  for (const { cutPoint } of pauseTimestamps) {
    // Fade out: ends at the cut point, starts FADE_DURATION before it.
    // Clamp start time to 0 so very early pauses don't go negative.
    const fadeOutStart = Math.max(0, cutPoint - FADE_DURATION);
    filters.push(
      `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_DURATION}:color=black`,
    );

    // Fade in: starts at the cut point, lasts FADE_DURATION.
    filters.push(
      `fade=t=in:st=${cutPoint.toFixed(3)}:d=${FADE_DURATION}:color=black`,
    );
  }

  const result = filters.join(',');
  console.log(`[export] Pause transition filter (${pauseTimestamps.length} cut points):`, result);
  return result;
}
