// Timeline Interaction — mouse events for playhead scrub + segment toggle + edge drag
// ---------------------------------------------------------------------------

import type { ReviewSegment } from '../../../shared/review-types';
import { timeToX, xToTime } from './timeline-renderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HitState {
  hoverSegmentId: string | null;
  hoverEdge: 'start' | 'end' | null;
  hoverPlayhead: boolean;
}

interface DragState {
  active: boolean;
  type: 'playhead' | 'edge' | 'trim-in' | 'trim-out' | null;
  startX: number;
  startY: number;
  engaged: boolean; // past 5px threshold
  // Edge-drag specific
  segmentId: string | null;
  edge: 'start' | 'end' | null;
}

type SeekFn = (time: number) => void;
type ToggleFn = (segmentId: string) => void;
type ResizeFn = (segmentId: string, edge: 'start' | 'end', newTime: number) => void;
type TrimFn = (time: number) => void;
type HitUpdateFn = (hit: HitState) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EDGE_HIT_PX = 6;
const PLAYHEAD_HIT_PX = 6;
const TRIM_HIT_PX = 8;
const DRAG_THRESHOLD_PX = 5;
const SNAP_PX = 8;
const MIN_SEGMENT_DURATION = 0.1;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let canvas: HTMLCanvasElement | null = null;
let getSegments: (() => ReviewSegment[]) | null = null;
let getDuration: (() => number) | null = null;
let getPlayhead: (() => number) | null = null;
let getTrimInFn: (() => number) | null = null;
let getTrimOutFn: (() => number) | null = null;
let onSeek: SeekFn | null = null;
let onToggle: ToggleFn | null = null;
let onResize: ResizeFn | null = null;
let onTrimIn: TrimFn | null = null;
let onTrimOut: TrimFn | null = null;
let onHitUpdate: HitUpdateFn | null = null;

let drag: DragState = { active: false, type: null, startX: 0, startY: 0, engaged: false, segmentId: null, edge: null };
let currentHit: HitState = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };
let snapTime: number | null = null;

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

function hitTestTrim(offsetX: number): 'trim-in' | 'trim-out' | null {
  if (!getTrimInFn || !getTrimOutFn) return null;
  const duration = getDuration!();
  const width = canvas!.getBoundingClientRect().width;

  const trimInX = timeToX(getTrimInFn(), duration, width);
  const trimOutX = timeToX(getTrimOutFn(), duration, width);

  // Always allow hitting trim handles — even at timeline edges (0 and duration).
  // The handle may be flush with the edge, so use a wider hit zone on the inward side.
  if (Math.abs(offsetX - trimInX) <= TRIM_HIT_PX || (trimInX === 0 && offsetX <= TRIM_HIT_PX)) return 'trim-in';
  if (Math.abs(offsetX - trimOutX) <= TRIM_HIT_PX || (trimOutX >= width - 1 && offsetX >= width - TRIM_HIT_PX)) return 'trim-out';
  return null;
}

function hitTest(offsetX: number): HitState {
  const segments = getSegments!();
  const duration = getDuration!();
  const playhead = getPlayhead!();
  const rect = canvas!.getBoundingClientRect();
  const width = rect.width;

  const result: HitState = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };

  // Check trim handles first (highest priority)
  const trimHit = hitTestTrim(offsetX);
  if (trimHit) {
    // Return with hoverEdge set to indicate trim handle hover
    result.hoverEdge = trimHit === 'trim-in' ? 'start' : 'end';
    return result;
  }

  // Check playhead proximity
  const playheadX = timeToX(playhead, duration, width);
  if (Math.abs(offsetX - playheadX) <= PLAYHEAD_HIT_PX) {
    result.hoverPlayhead = true;
    return result;
  }

  // Check segment edges, then bodies
  for (const seg of segments) {
    if (seg.type === 'speech') continue;

    const startX = timeToX(seg.start, duration, width);
    const endX = timeToX(seg.end, duration, width);

    if (Math.abs(offsetX - startX) <= EDGE_HIT_PX) {
      result.hoverSegmentId = seg.id;
      result.hoverEdge = 'start';
      return result;
    }
    if (Math.abs(offsetX - endX) <= EDGE_HIT_PX) {
      result.hoverSegmentId = seg.id;
      result.hoverEdge = 'end';
      return result;
    }
  }

  // Check segment bodies
  const time = xToTime(offsetX, duration, width);
  for (const seg of segments) {
    if (seg.type === 'speech') continue;
    if (time >= seg.start && time <= seg.end) {
      result.hoverSegmentId = seg.id;
      result.hoverEdge = null;
      return result;
    }
  }

  return result;
}

function updateCursor(hit: HitState, offsetX: number): void {
  if (!canvas) return;
  // Trim handles get priority cursor
  const trimHit = hitTestTrim(offsetX);
  if (trimHit) {
    canvas.style.cursor = 'ew-resize';
    return;
  }
  if (hit.hoverPlayhead) {
    canvas.style.cursor = 'col-resize';
  } else if (hit.hoverEdge) {
    canvas.style.cursor = 'ew-resize';
  } else if (hit.hoverSegmentId) {
    canvas.style.cursor = 'pointer';
  } else {
    canvas.style.cursor = 'default';
  }
}

// ---------------------------------------------------------------------------
// Mouse handlers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Snap helpers
// ---------------------------------------------------------------------------

function computeSnap(
  targetTime: number,
  dragSegId: string,
  dragEdge: 'start' | 'end',
): number | null {
  const segments = getSegments!();
  const duration = getDuration!();
  const playhead = getPlayhead!();
  const rect = canvas!.getBoundingClientRect();
  const w = rect.width;

  const snapThresholdTime = SNAP_PX / (w / duration);

  // Collect candidate snap times: all segment edges except the one being dragged
  const candidates: number[] = [playhead];
  for (const seg of segments) {
    if (seg.type === 'speech') continue;
    if (seg.id === dragSegId && dragEdge === 'start') {
      candidates.push(seg.end); // can snap to own other edge? skip for sanity
    } else if (seg.id === dragSegId && dragEdge === 'end') {
      candidates.push(seg.start);
    } else {
      candidates.push(seg.start, seg.end);
    }
  }

  let bestDist = Infinity;
  let bestTime: number | null = null;
  for (const t of candidates) {
    const dist = Math.abs(targetTime - t);
    if (dist < snapThresholdTime && dist < bestDist) {
      bestDist = dist;
      bestTime = t;
    }
  }
  return bestTime;
}

/** Get current snap indicator time (or null). Read by render loop. */
export function getSnapIndicatorTime(): number | null {
  return snapTime;
}

// ---------------------------------------------------------------------------
// Mouse handlers
// ---------------------------------------------------------------------------

function handleMouseDown(e: MouseEvent): void {
  // Check trim handles first
  const trimHit = hitTestTrim(e.offsetX);
  if (trimHit) {
    drag = {
      active: true,
      type: trimHit,
      startX: e.offsetX,
      startY: e.offsetY,
      engaged: false,
      segmentId: null,
      edge: null,
    };
    return;
  }

  const hit = hitTest(e.offsetX);

  if (hit.hoverEdge && hit.hoverSegmentId) {
    drag = {
      active: true,
      type: 'edge',
      startX: e.offsetX,
      startY: e.offsetY,
      engaged: false,
      segmentId: hit.hoverSegmentId,
      edge: hit.hoverEdge,
    };
  } else {
    drag = {
      active: true,
      type: hit.hoverPlayhead ? 'playhead' : null,
      startX: e.offsetX,
      startY: e.offsetY,
      engaged: false,
      segmentId: null,
      edge: null,
    };
  }
}

function handleMouseMove(e: MouseEvent): void {
  if (drag.active) {
    const dx = e.offsetX - drag.startX;
    const dy = e.offsetY - drag.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!drag.engaged && dist >= DRAG_THRESHOLD_PX) {
      drag.engaged = true;
    }

    // Trim handle dragging
    if (drag.engaged && (drag.type === 'trim-in' || drag.type === 'trim-out')) {
      const rect = canvas!.getBoundingClientRect();
      const duration = getDuration!();
      const time = xToTime(
        Math.max(0, Math.min(e.offsetX, rect.width)),
        duration,
        rect.width,
      );
      const clampedTime = Math.max(0, Math.min(time, duration));
      if (drag.type === 'trim-in' && onTrimIn) {
        // Don't let trim-in pass trim-out
        const trimOutVal = getTrimOutFn ? getTrimOutFn() : duration;
        onTrimIn(Math.min(clampedTime, trimOutVal - 0.1));
      } else if (drag.type === 'trim-out' && onTrimOut) {
        // Don't let trim-out pass trim-in
        const trimInVal = getTrimInFn ? getTrimInFn() : 0;
        onTrimOut(Math.max(clampedTime, trimInVal + 0.1));
      }
      return;
    }

    if (drag.engaged && drag.type === 'playhead') {
      const rect = canvas!.getBoundingClientRect();
      const duration = getDuration!();
      const time = xToTime(
        Math.max(0, Math.min(e.offsetX, rect.width)),
        duration,
        rect.width,
      );
      onSeek!(Math.max(0, Math.min(time, duration)));
    }

    if (drag.engaged && drag.type === 'edge' && drag.segmentId && drag.edge) {
      const rect = canvas!.getBoundingClientRect();
      const duration = getDuration!();
      const segments = getSegments!();
      let rawTime = xToTime(
        Math.max(0, Math.min(e.offsetX, rect.width)),
        duration,
        rect.width,
      );

      // Clamp against neighbors and minimum segment duration
      const seg = segments.find(s => s.id === drag.segmentId);
      if (seg) {
        const sorted = segments
          .filter(s => s.type !== 'speech')
          .sort((a, b) => a.start - b.start);
        const idx = sorted.findIndex(s => s.id === seg.id);

        if (drag.edge === 'start') {
          const prevEnd = idx > 0 ? sorted[idx - 1].end : 0;
          const maxStart = seg.end - MIN_SEGMENT_DURATION;
          rawTime = Math.max(prevEnd, Math.min(rawTime, maxStart));
        } else {
          const nextStart = idx < sorted.length - 1 ? sorted[idx + 1].start : duration;
          const minEnd = seg.start + MIN_SEGMENT_DURATION;
          rawTime = Math.max(minEnd, Math.min(rawTime, nextStart));
        }

        // Snap
        const snapped = computeSnap(rawTime, drag.segmentId, drag.edge);
        if (snapped !== null) {
          // Re-clamp snapped value
          if (drag.edge === 'start') {
            const prevEnd = idx > 0 ? sorted[idx - 1].end : 0;
            const maxStart = seg.end - MIN_SEGMENT_DURATION;
            rawTime = Math.max(prevEnd, Math.min(snapped, maxStart));
          } else {
            const nextStart = idx < sorted.length - 1 ? sorted[idx + 1].start : duration;
            const minEnd = seg.start + MIN_SEGMENT_DURATION;
            rawTime = Math.max(minEnd, Math.min(snapped, nextStart));
          }
          snapTime = rawTime;
        } else {
          snapTime = null;
        }

        // Propagate resize
        onResize!(drag.segmentId, drag.edge, rawTime);

        // Update hover state to highlight active handle
        currentHit = { hoverSegmentId: drag.segmentId, hoverEdge: drag.edge, hoverPlayhead: false };
        onHitUpdate!(currentHit);
      }
    }

    return;
  }

  // Not dragging — update hover state
  const hit = hitTest(e.offsetX);
  currentHit = hit;
  updateCursor(hit, e.offsetX);
  onHitUpdate!(hit);
}

function handleMouseUp(e: MouseEvent): void {
  if (!drag.active) return;

  const wasDragging = drag.engaged;
  const wasEdgeDrag = drag.type === 'edge';
  drag = { active: false, type: null, startX: 0, startY: 0, engaged: false, segmentId: null, edge: null };
  snapTime = null;

  if (wasDragging) return; // drag completed, not a click

  // Treat as click
  const hit = hitTest(e.offsetX);

  if (hit.hoverPlayhead) {
    // Click on playhead — no-op
    return;
  }

  if (hit.hoverSegmentId && !hit.hoverEdge) {
    // Click on segment body → toggle enabled
    onToggle!(hit.hoverSegmentId);
    return;
  }

  // Click on waveform (no segment hit, or on edge without drag) → seek
  const rect = canvas!.getBoundingClientRect();
  const duration = getDuration!();
  const time = xToTime(e.offsetX, duration, rect.width);
  onSeek!(Math.max(0, Math.min(time, duration)));
}

function handleMouseLeave(): void {
  drag = { active: false, type: null, startX: 0, startY: 0, engaged: false, segmentId: null, edge: null };
  snapTime = null;
  currentHit = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };
  if (canvas) canvas.style.cursor = 'default';
  onHitUpdate!(currentHit);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TimelineInteractionOptions {
  canvas: HTMLCanvasElement;
  getSegments: () => ReviewSegment[];
  getDuration: () => number;
  getPlayhead: () => number;
  getTrimIn: () => number;
  getTrimOut: () => number;
  onSeek: SeekFn;
  onToggle: ToggleFn;
  onResize: ResizeFn;
  onTrimIn: TrimFn;
  onTrimOut: TrimFn;
  onHitUpdate: HitUpdateFn;
}

export function initTimelineInteraction(opts: TimelineInteractionOptions): void {
  canvas = opts.canvas;
  getSegments = opts.getSegments;
  getDuration = opts.getDuration;
  getPlayhead = opts.getPlayhead;
  getTrimInFn = opts.getTrimIn;
  getTrimOutFn = opts.getTrimOut;
  onSeek = opts.onSeek;
  onToggle = opts.onToggle;
  onResize = opts.onResize;
  onTrimIn = opts.onTrimIn;
  onTrimOut = opts.onTrimOut;
  onHitUpdate = opts.onHitUpdate;

  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseup', handleMouseUp);
  canvas.addEventListener('mouseleave', handleMouseLeave);
}

export function destroyTimelineInteraction(): void {
  if (canvas) {
    canvas.removeEventListener('mousedown', handleMouseDown);
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('mouseup', handleMouseUp);
    canvas.removeEventListener('mouseleave', handleMouseLeave);
    canvas.style.cursor = 'default';
    canvas = null;
  }

  getSegments = null;
  getDuration = null;
  getPlayhead = null;
  getTrimInFn = null;
  getTrimOutFn = null;
  onSeek = null;
  onToggle = null;
  onResize = null;
  onTrimIn = null;
  onTrimOut = null;
  onHitUpdate = null;
  drag = { active: false, type: null, startX: 0, startY: 0, engaged: false, segmentId: null, edge: null };
  snapTime = null;
  currentHit = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };
}
