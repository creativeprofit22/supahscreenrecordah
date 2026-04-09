// Review Screen Controller — orchestrates analysis, state, and render loop
// ---------------------------------------------------------------------------

import {
  playbackVideo, playbackContainer,
  processingOverlay, processingSub,
  reviewActionsBar, reviewTimeline, timelineCanvas, timelineCtx,
  captionOverlay, captionOverlayCtx,
} from '../dom';
import { renderTimeline } from './timeline-renderer';
import {
  initTimelineInteraction, destroyTimelineInteraction,
  getSnapIndicatorTime,
  type HitState,
} from './timeline-interaction';
import type { ReviewSegment, ReviewState } from '../../../shared/review-types';
import { renderCaptionPreview, resetCaptionPreview } from './caption-preview';
import { getActiveCaptionStyle } from '../playback';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state: ReviewState | null = null;
let rafId: number | null = null;
let destroyed = false;
let hoverState: HitState = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };

/** Timeline trim handles — in/out points in seconds (null = full duration) */
let trimIn = 0;
let trimOut = Infinity;

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

  // Start a 30s timer for "Still working..." subtext
  const stillWorkingTimer = setTimeout(() => {
    if (!destroyed) {
      processingSub.textContent = 'Still working...';
    }
  }, 30_000);

  // Show skeleton loader on the timeline while analysis runs
  reviewTimeline.classList.add('visible', 'skeleton');

  try {
    const result = await window.mainAPI.analyzeForReview();

    clearTimeout(stillWorkingTimer);

    if (destroyed) return; // user exited during analysis

    state = {
      segments: result.segments,
      waveform: result.waveform,
      words: result.words,
      duration: result.waveform.duration || playbackVideo.duration || 0,
      playheadPosition: 0,
    };

    // Initialize trim points to full duration
    trimIn = 0;
    trimOut = state.duration;

    console.log('[review-controller] Analysis complete — segments:', state.segments.length, 'duration:', state.duration);

    // Remove skeleton, add slide-up animation
    reviewTimeline.classList.remove('skeleton');
    reviewTimeline.classList.add('slide-up');

    // Size the timeline canvas to its container
    sizeCanvas();

    // Wire mouse interaction
    initTimelineInteraction({
      canvas: timelineCanvas,
      getSegments: () => state?.segments ?? [],
      getDuration: () => state?.duration ?? 0,
      getPlayhead: () => playbackVideo.currentTime,
      getTrimIn: () => trimIn,
      getTrimOut: () => trimOut === Infinity ? (state?.duration ?? 0) : trimOut,
      onSeek: (time: number) => { playbackVideo.currentTime = time; },
      onToggle: toggleSegment,
      onResize: resizeSegment,
      onTrimIn: (t: number) => { trimIn = Math.max(0, t); },
      onTrimOut: (t: number) => { trimOut = Math.min(t, state?.duration ?? t); },
      onHitUpdate: (hit: HitState) => { hoverState = hit; },
    });

    // Wire playback skipping over disabled segments
    initPlaybackSkipping();

    // Show review UI
    reviewActionsBar.classList.add('visible');

  } catch (err) {
    clearTimeout(stillWorkingTimer);
    console.warn('[review-controller] Analysis failed:', err);
    reviewTimeline.classList.remove('skeleton');
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

/** Returns the transcribed words from analysis (for captions). */
export function getReviewWords(): import('../../../shared/review-types').ReviewState['words'] {
  return state?.words ?? [];
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

/** Disable trailing non-speech segments from the end of the recording. */
export function trimTail(): void {
  if (!state) return;
  // Walk segments backwards — disable consecutive non-speech segments at the tail
  for (let i = state.segments.length - 1; i >= 0; i--) {
    const seg = state.segments[i];
    if (seg.type === 'speech') break; // stop at the last speech segment
    seg.enabled = false;
  }
}

/** Disable leading non-speech segments from the start of the recording. */
export function trimHead(): void {
  if (!state) return;
  for (const seg of state.segments) {
    if (seg.type === 'speech') break;
    seg.enabled = false;
  }
}

/** Get the current trim in-point (seconds). */
export function getTrimIn(): number { return trimIn; }

/** Get the current trim out-point (seconds). */
export function getTrimOut(): number { return trimOut; }

/** Set trim in-point. */
export function setTrimIn(t: number): void { trimIn = Math.max(0, t); }

/** Set trim out-point. */
export function setTrimOut(t: number): void { trimOut = t; }

/** Re-enable all segments. */
export function undoAll(): void {
  if (!state) return;
  for (const seg of state.segments) {
    seg.enabled = true;
  }
  trimIn = 0;
  trimOut = state.duration;
}

// ---------------------------------------------------------------------------
// Preview playback — skip disabled segments
// ---------------------------------------------------------------------------

function onTimeUpdate(): void {
  if (!state) return;
  const t = playbackVideo.currentTime;
  const segs = state.segments;
  for (let i = 0; i < segs.length; i++) {
    if (!segs[i].enabled && t >= segs[i].start && t < segs[i].end) {
      // Find the end of all consecutive disabled segments — skip in one jump
      let skipTo = segs[i].end;
      for (let j = i + 1; j < segs.length; j++) {
        if (!segs[j].enabled) {
          skipTo = segs[j].end;
        } else {
          break;
        }
      }
      playbackVideo.currentTime = skipTo;
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
  resetCaptionPreview();

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  state = null;
  hoverState = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };
  lastCanvasW = 0;
  lastCanvasH = 0;

  reviewActionsBar.classList.remove('visible');
  reviewTimeline.classList.remove('visible', 'skeleton', 'slide-up');
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

let lastCanvasW = 0;
let lastCanvasH = 0;

const TIMELINE_HEIGHT = 100;

function sizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(reviewTimeline.clientWidth * dpr);
  const h = Math.round(TIMELINE_HEIGHT * dpr);
  if (w === lastCanvasW && h === lastCanvasH) return;
  lastCanvasW = w;
  lastCanvasH = h;
  timelineCanvas.width = w;
  timelineCanvas.height = h;
  timelineCanvas.style.width = `${reviewTimeline.clientWidth}px`;
  timelineCanvas.style.height = `${TIMELINE_HEIGHT}px`;
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

      // Re-size canvas every frame to handle container resize/animation
      sizeCanvas();

      const rect = reviewTimeline.getBoundingClientRect();
      renderTimeline(timelineCtx, rect.width, rect.height, {
        waveform: state.waveform,
        segments: state.segments,
        playhead: state.playheadPosition,
        duration: state.duration,
        hoverSegmentId: hoverState.hoverSegmentId,
        hoverEdge: hoverState.hoverEdge,
        snapTime: getSnapIndicatorTime(),
        trimIn,
        trimOut: trimOut === Infinity ? state.duration : trimOut,
      });

      // Render caption preview overlay
      renderCaptionPreview(
        captionOverlayCtx,
        captionOverlay,
        playbackVideo,
        state.playheadPosition,
        state.words,
        state.segments,
        getActiveCaptionStyle(),
      );
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
}
