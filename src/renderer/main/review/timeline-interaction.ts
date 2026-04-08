// Timeline Interaction — mouse events for playhead scrub + segment toggle
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
  type: 'playhead' | null;
  startX: number;
  startY: number;
  engaged: boolean; // past 5px threshold
}

type SeekFn = (time: number) => void;
type ToggleFn = (segmentId: string) => void;
type HitUpdateFn = (hit: HitState) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EDGE_HIT_PX = 6;
const PLAYHEAD_HIT_PX = 6;
const DRAG_THRESHOLD_PX = 5;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let canvas: HTMLCanvasElement | null = null;
let getSegments: (() => ReviewSegment[]) | null = null;
let getDuration: (() => number) | null = null;
let getPlayhead: (() => number) | null = null;
let onSeek: SeekFn | null = null;
let onToggle: ToggleFn | null = null;
let onHitUpdate: HitUpdateFn | null = null;

let drag: DragState = { active: false, type: null, startX: 0, startY: 0, engaged: false };
let currentHit: HitState = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

function hitTest(offsetX: number): HitState {
  const segments = getSegments!();
  const duration = getDuration!();
  const playhead = getPlayhead!();
  const rect = canvas!.getBoundingClientRect();
  const width = rect.width;

  const result: HitState = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };

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

function updateCursor(hit: HitState): void {
  if (!canvas) return;
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

function handleMouseDown(e: MouseEvent): void {
  const hit = hitTest(e.offsetX);
  drag = {
    active: true,
    type: hit.hoverPlayhead ? 'playhead' : null,
    startX: e.offsetX,
    startY: e.offsetY,
    engaged: false,
  };
}

function handleMouseMove(e: MouseEvent): void {
  if (drag.active) {
    const dx = e.offsetX - drag.startX;
    const dy = e.offsetY - drag.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!drag.engaged && dist >= DRAG_THRESHOLD_PX) {
      drag.engaged = true;
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
    return;
  }

  // Not dragging — update hover state
  const hit = hitTest(e.offsetX);
  currentHit = hit;
  updateCursor(hit);
  onHitUpdate!(hit);
}

function handleMouseUp(e: MouseEvent): void {
  if (!drag.active) return;

  const wasDragging = drag.engaged;
  const wasPlayheadDrag = drag.type === 'playhead';
  drag = { active: false, type: null, startX: 0, startY: 0, engaged: false };

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
  drag = { active: false, type: null, startX: 0, startY: 0, engaged: false };
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
  onSeek: SeekFn;
  onToggle: ToggleFn;
  onHitUpdate: HitUpdateFn;
}

export function initTimelineInteraction(opts: TimelineInteractionOptions): void {
  canvas = opts.canvas;
  getSegments = opts.getSegments;
  getDuration = opts.getDuration;
  getPlayhead = opts.getPlayhead;
  onSeek = opts.onSeek;
  onToggle = opts.onToggle;
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
  onSeek = null;
  onToggle = null;
  onHitUpdate = null;
  drag = { active: false, type: null, startX: 0, startY: 0, engaged: false };
  currentHit = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };
}
