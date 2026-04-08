// Review Screen Controller — orchestrates analysis, state, and render loop
// ---------------------------------------------------------------------------

import {
  playbackVideo,
  processingOverlay, processingSub,
  reviewActionsBar, reviewTimeline, timelineCanvas, timelineCtx,
} from '../dom';
import { renderTimeline } from './timeline-renderer';
import {
  initTimelineInteraction, destroyTimelineInteraction,
  getSnapIndicatorTime,
  type HitState,
} from './timeline-interaction';
import type { ReviewSegment, ReviewState } from '../../../shared/review-types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state: ReviewState | null = null;
let rafId: number | null = null;
let destroyed = false;
let hoverState: HitState = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Called after video loads in playback mode.
 * Shows processing overlay, runs analysis IPC, then shows timeline.
 */
export async function initReview(): Promise<void> {
  destroyed = false;

  // Show processing overlay
  processingSub.textContent = 'Analyzing audio...';
  processingOverlay.classList.remove('hidden');

  try {
    const result = await window.mainAPI.analyzeForReview();

    if (destroyed) return; // user exited during analysis

    state = {
      segments: result.segments,
      waveform: result.waveform,
      words: result.words,
      duration: result.waveform.duration || playbackVideo.duration || 0,
      playheadPosition: 0,
    };

    console.log('[review-controller] Analysis complete — segments:', state.segments.length, 'duration:', state.duration);

    // Size the timeline canvas to its container
    sizeCanvas();

    // Wire mouse interaction
    initTimelineInteraction({
      canvas: timelineCanvas,
      getSegments: () => state?.segments ?? [],
      getDuration: () => state?.duration ?? 0,
      getPlayhead: () => playbackVideo.currentTime,
      onSeek: (time: number) => { playbackVideo.currentTime = time; },
      onToggle: toggleSegment,
      onResize: resizeSegment,
      onHitUpdate: (hit: HitState) => { hoverState = hit; },
    });

    // Wire playback skipping over disabled segments
    initPlaybackSkipping();

    // Show review UI
    reviewActionsBar.classList.add('visible');
    reviewTimeline.classList.add('visible');
  } catch (err) {
    console.warn('[review-controller] Analysis failed:', err);
  } finally {
    if (!destroyed) {
      processingOverlay.classList.add('hidden');
    }
  }

  // Start render loop even if analysis failed (shows waveform-only if available)
  if (!destroyed) {
    startRenderLoop();
  }
}

/** Returns the current segment state (for export). */
export function getReviewSegments(): ReviewSegment[] {
  return state?.segments ?? [];
}

/** Toggle a segment's enabled state by id. */
function toggleSegment(segmentId: string): void {
  if (!state) return;
  const seg = state.segments.find(s => s.id === segmentId);
  if (seg) seg.enabled = !seg.enabled;
}

/** Resize a segment edge and auto-adjust adjacent speech segments. */
function resizeSegment(segmentId: string, edge: 'start' | 'end', newTime: number): void {
  if (!state) return;
  const seg = state.segments.find(s => s.id === segmentId);
  if (!seg || seg.type === 'speech') return;

  const oldTime = edge === 'start' ? seg.start : seg.end;
  if (edge === 'start') {
    seg.start = newTime;
  } else {
    seg.end = newTime;
  }

  // Auto-adjust adjacent speech segment to fill the gap
  for (const s of state.segments) {
    if (s.type !== 'speech') continue;
    if (edge === 'start' && s.end === oldTime) {
      // Speech segment that ended where our start was → adjust its end
      s.end = newTime;
    } else if (edge === 'end' && s.start === oldTime) {
      // Speech segment that started where our end was → adjust its start
      s.start = newTime;
    }
  }
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

/** Disable all silence segments longer than the given threshold (seconds). */
export function bulkRemoveSilences(thresholdSec: number): void {
  if (!state) return;
  for (const seg of state.segments) {
    if (seg.type === 'silence' && (seg.end - seg.start) > thresholdSec) {
      seg.enabled = false;
    }
  }
}

/** Disable all filler segments. */
export function bulkRemoveFillers(): void {
  if (!state) return;
  for (const seg of state.segments) {
    if (seg.type === 'filler') {
      seg.enabled = false;
    }
  }
}

/** Disable all non-speech segments (silences + fillers). */
export function bulkRemoveSilencesAndFillers(): void {
  if (!state) return;
  for (const seg of state.segments) {
    if (seg.type !== 'speech') {
      seg.enabled = false;
    }
  }
}

/** Re-enable all segments. */
export function undoAll(): void {
  if (!state) return;
  for (const seg of state.segments) {
    seg.enabled = true;
  }
}

// ---------------------------------------------------------------------------
// Preview playback — skip disabled segments
// ---------------------------------------------------------------------------

function onTimeUpdate(): void {
  if (!state) return;
  const t = playbackVideo.currentTime;
  for (const seg of state.segments) {
    if (!seg.enabled && t >= seg.start && t < seg.end) {
      playbackVideo.currentTime = seg.end;
      return;
    }
  }
}

export function initPlaybackSkipping(): void {
  playbackVideo.addEventListener('timeupdate', onTimeUpdate);
}

export function destroyPlaybackSkipping(): void {
  playbackVideo.removeEventListener('timeupdate', onTimeUpdate);
}

/** Clean up on exit. */
export function destroyReview(): void {
  destroyed = true;

  destroyPlaybackSkipping();
  destroyTimelineInteraction();

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  state = null;
  hoverState = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };

  reviewActionsBar.classList.remove('visible');
  reviewTimeline.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function sizeCanvas(): void {
  const rect = reviewTimeline.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  timelineCanvas.width = rect.width * dpr;
  timelineCanvas.height = rect.height * dpr;
  timelineCanvas.style.width = `${rect.width}px`;
  timelineCanvas.style.height = `${rect.height}px`;
  timelineCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function startRenderLoop(): void {
  if (rafId !== null) return;

  const tick = (): void => {
    if (destroyed) {
      rafId = null;
      return;
    }

    if (state) {
      state.playheadPosition = playbackVideo.currentTime;

      const rect = reviewTimeline.getBoundingClientRect();
      renderTimeline(timelineCtx, rect.width, rect.height, {
        waveform: state.waveform,
        segments: state.segments,
        playhead: state.playheadPosition,
        duration: state.duration,
        hoverSegmentId: hoverState.hoverSegmentId,
        hoverEdge: hoverState.hoverEdge,
        snapTime: getSnapIndicatorTime(),
      });
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
}
