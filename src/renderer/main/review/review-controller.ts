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
  getSnapIndicatorTime, getRangeSelectState,
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

/** Zoom state — visible time range */
let viewStart = 0;
let viewEnd = Infinity;

// ---------------------------------------------------------------------------
// Undo / Redo
// ---------------------------------------------------------------------------

interface Snapshot {
  segments: ReviewSegment[];
  trimIn: number;
  trimOut: number;
}

const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];
const MAX_UNDO = 100;

function takeSnapshot(): Snapshot {
  return {
    segments: (state?.segments ?? []).map(s => ({ ...s })),
    trimIn,
    trimOut,
  };
}

function pushUndo(): void {
  undoStack.push(takeSnapshot());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0; // new action clears redo
  updateUndoRedoButtons();
}

function applySnapshot(snap: Snapshot): void {
  if (!state) return;
  state.segments = snap.segments.map(s => ({ ...s }));
  trimIn = snap.trimIn;
  trimOut = snap.trimOut;
}

export function undo(): void {
  if (!state || undoStack.length === 0) return;
  redoStack.push(takeSnapshot());
  applySnapshot(undoStack.pop()!);
  updateUndoRedoButtons();
}

export function redo(): void {
  if (!state || redoStack.length === 0) return;
  undoStack.push(takeSnapshot());
  applySnapshot(redoStack.pop()!);
  updateUndoRedoButtons();
}

function updateUndoRedoButtons(): void {
  const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement | null;
  const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement | null;
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

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

    // Initialize trim points and zoom to full duration
    trimIn = 0;
    trimOut = state.duration;
    viewStart = 0;
    viewEnd = state.duration;
    undoStack.length = 0;
    redoStack.length = 0;

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
      getViewStart: () => viewStart,
      getViewEnd: () => viewEnd === Infinity ? (state?.duration ?? 0) : viewEnd,
      onSeek: (time: number) => { playbackVideo.currentTime = time; },
      onToggle: toggleSegment,
      onDismiss: dismissSegment,
      onResize: resizeSegment,
      onTrimIn: (t: number) => { trimIn = Math.max(0, t); updateUndoRedoButtons(); },
      onTrimOut: (t: number) => { trimOut = Math.min(t, state?.duration ?? t); updateUndoRedoButtons(); },
      onHitUpdate: (hit: HitState) => { hoverState = hit; },
      onZoom: (vs: number, ve: number) => {
        viewStart = vs;
        viewEnd = ve;
        updateZoomIndicator();
      },
      onDragStart: beginResizeOrTrim,
      onCreateSegment: createManualSegment,
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

/** Returns the video waveform (for reuse in music mixer). */
export function getReviewWaveform(): import('../../../shared/review-types').WaveformData {
  return state?.waveform ?? { samples: [], duration: 0 };
}

/** Returns the video duration from analysis. */
export function getReviewDuration(): number {
  return state?.duration ?? 0;
}

/** Returns the transcribed words from analysis (for captions). */
export function getReviewWords(): import('../../../shared/review-types').ReviewState['words'] {
  return state?.words ?? [];
}

/** Toggle a segment's enabled state by id. */
function toggleSegment(segmentId: string): void {
  if (!state) return;
  pushUndo();
  const seg = state.segments.find(s => s.id === segmentId);
  if (seg) seg.enabled = !seg.enabled;
}

/** Push undo snapshot before a drag operation begins. Called once per drag. */
function beginResizeOrTrim(): void {
  pushUndo();
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

/** Dismiss a segment's detection — convert it to speech and merge with neighbors. */
function dismissSegment(segmentId: string): void {
  if (!state) return;
  pushUndo();
  const idx = state.segments.findIndex(s => s.id === segmentId);
  if (idx === -1) return;
  const seg = state.segments[idx];
  if (seg.type === 'speech') return; // already speech

  // Convert to speech
  seg.type = 'speech';
  seg.enabled = true;

  // Merge with adjacent speech segments
  const merged = [seg];
  // Check previous
  if (idx > 0 && state.segments[idx - 1].type === 'speech') {
    const prev = state.segments[idx - 1];
    seg.start = prev.start;
    merged.unshift(prev);
  }
  // Check next
  if (idx < state.segments.length - 1 && state.segments[idx + 1].type === 'speech') {
    const next = state.segments[idx + 1];
    seg.end = next.end;
    merged.push(next);
  }
  // Remove merged neighbors (keep the current segment which absorbed them)
  state.segments = state.segments.filter(s => s === seg || !merged.includes(s));
}

/** Create a manual cut segment from a drag-to-select range. Splits/trims overlapping segments. */
function createManualSegment(start: number, end: number): void {
  if (!state) return;
  pushUndo();

  const MIN_REMNANT = 0.1; // Don't leave tiny remnants after splitting

  const newSeg: ReviewSegment = {
    id: `manual-${Date.now()}`,
    start,
    end,
    type: 'manual',
    enabled: false,
  };

  const toRemove: Set<string> = new Set();
  const toAdd: ReviewSegment[] = [];

  for (const seg of state.segments) {
    const overlapsLeft = seg.start < start && seg.end > start && seg.end <= end;
    const overlapsRight = seg.start >= start && seg.start < end && seg.end > end;
    const fullyInside = seg.start >= start && seg.end <= end;
    const fullyContains = seg.start < start && seg.end > end;

    if (fullyInside) {
      toRemove.add(seg.id);
    } else if (fullyContains) {
      toRemove.add(seg.id);
      // Left remnant
      if (start - seg.start >= MIN_REMNANT) {
        toAdd.push({ id: `${seg.id}-l`, start: seg.start, end: start, type: seg.type, enabled: seg.enabled });
      } else {
        newSeg.start = seg.start; // absorb tiny left remnant
      }
      // Right remnant
      if (seg.end - end >= MIN_REMNANT) {
        toAdd.push({ id: `${seg.id}-r`, start: end, end: seg.end, type: seg.type, enabled: seg.enabled });
      } else {
        newSeg.end = seg.end; // absorb tiny right remnant
      }
    } else if (overlapsLeft) {
      if (start - seg.start >= MIN_REMNANT) {
        seg.end = start;
      } else {
        toRemove.add(seg.id);
        newSeg.start = seg.start;
      }
    } else if (overlapsRight) {
      if (seg.end - end >= MIN_REMNANT) {
        seg.start = end;
      } else {
        toRemove.add(seg.id);
        newSeg.end = seg.end;
      }
    }
  }

  state.segments = state.segments.filter(s => !toRemove.has(s.id));
  state.segments.push(...toAdd, newSeg);
  state.segments.sort((a, b) => a.start - b.start);
}

/** Update the zoom indicator text in the legend. */
function updateZoomIndicator(): void {
  const el = document.getElementById('zoom-indicator');
  if (!el) return;
  const dur = state?.duration ?? 0;
  if (dur <= 0) { el.classList.add('hidden'); return; }
  const span = viewEnd - viewStart;
  if (span >= dur - 0.01) {
    el.classList.add('hidden');
  } else {
    const pct = Math.round((dur / span) * 100);
    el.textContent = `${pct}%`;
    el.classList.remove('hidden');
  }
}

/** Reset zoom to full duration. */
export function resetZoom(): void {
  if (!state) return;
  viewStart = 0;
  viewEnd = state.duration;
  updateZoomIndicator();
}

/** Get the current zoom level (1.0 = no zoom). */
export function getZoomLevel(): number {
  if (!state || state.duration <= 0) return 1;
  return state.duration / (viewEnd - viewStart);
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

/** Disable all silence segments longer than the given threshold (seconds). */
export function bulkRemoveSilences(thresholdSec: number): void {
  if (!state) return;
  pushUndo();
  for (const seg of state.segments) {
    if (seg.type === 'silence' && (seg.end - seg.start) > thresholdSec) {
      seg.enabled = false;
    }
  }
}

/** Disable all filler segments. */
export function bulkRemoveFillers(): void {
  if (!state) return;
  pushUndo();
  for (const seg of state.segments) {
    if (seg.type === 'filler') {
      seg.enabled = false;
    }
  }
}

/** Disable all non-speech segments (silences + fillers). */
export function bulkRemoveSilencesAndFillers(): void {
  if (!state) return;
  pushUndo();
  for (const seg of state.segments) {
    if (seg.type !== 'speech') {
      seg.enabled = false;
    }
  }
}

/** Disable trailing non-speech segments from the end of the recording. */
export function trimTail(): void {
  if (!state) return;
  pushUndo();
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
  pushUndo();
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
  pushUndo();
  for (const seg of state.segments) {
    seg.enabled = true;
  }
  trimIn = 0;
  trimOut = state.duration;
  viewStart = 0;
  viewEnd = state.duration;
  updateZoomIndicator();
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
  viewStart = 0;
  viewEnd = Infinity;
  undoStack.length = 0;
  redoStack.length = 0;

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
      const effectiveViewEnd = viewEnd === Infinity ? state.duration : viewEnd;
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
        viewStart,
        viewEnd: effectiveViewEnd,
        rangeSelect: getRangeSelectState(),
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
