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
      onHitUpdate: (hit: HitState) => { hoverState = hit; },
    });

    // Show review UI
    reviewActionsBar.classList.remove('hidden');
    reviewTimeline.classList.remove('hidden');
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

/** Clean up on exit. */
export function destroyReview(): void {
  destroyed = true;

  destroyTimelineInteraction();

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  state = null;
  hoverState = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };

  reviewActionsBar.classList.add('hidden');
  reviewTimeline.classList.add('hidden');
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
      });
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
}
