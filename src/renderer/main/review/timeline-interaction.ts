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

const SCROLLBAR_H = 14; // hit zone height (visual bar is 6px but we want easy targeting)

interface DragState {
  active: boolean;
  type: 'playhead' | 'edge' | 'trim-in' | 'trim-out' | 'scrollbar' | 'range-select' | null;
  startX: number;
  startY: number;
  engaged: boolean; // past 5px threshold
  // Edge-drag specific
  segmentId: string | null;
  edge: 'start' | 'end' | null;
  // Scrollbar-drag specific
  scrollbarAnchorViewStart: number;
}

type SeekFn = (time: number) => void;
type ToggleFn = (segmentId: string) => void;
type DismissFn = (segmentId: string) => void;
type ResizeFn = (segmentId: string, edge: 'start' | 'end', newTime: number) => void;
type TrimFn = (time: number) => void;
type HitUpdateFn = (hit: HitState) => void;
type ZoomFn = (viewStart: number, viewEnd: number) => void;
type CreateSegmentFn = (start: number, end: number) => void;
type DragStartFn = () => void;

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
let getViewStartFn: (() => number) | null = null;
let getViewEndFn: (() => number) | null = null;
let onSeek: SeekFn | null = null;
let onToggle: ToggleFn | null = null;
let onDismiss: DismissFn | null = null;
let onResize: ResizeFn | null = null;
let onTrimIn: TrimFn | null = null;
let onTrimOut: TrimFn | null = null;
let onHitUpdate: HitUpdateFn | null = null;
let onZoom: ZoomFn | null = null;
let onDragStart: DragStartFn | null = null;
let onCreateSegment: CreateSegmentFn | null = null;

let drag: DragState = { active: false, type: null, startX: 0, startY: 0, engaged: false, segmentId: null, edge: null, scrollbarAnchorViewStart: 0 };
let currentHit: HitState = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };
let snapTime: number | null = null;

// Range-select state (for drag-to-cut)
let rangeSelectStart: number | null = null;
let rangeSelectEnd: number | null = null;

// ---------------------------------------------------------------------------
// View helpers — shorthand for passing viewStart/viewEnd
// ---------------------------------------------------------------------------

function vTimeToX(time: number): number {
  const duration = getDuration!();
  const width = canvas!.getBoundingClientRect().width;
  return timeToX(time, duration, width, getViewStartFn!(), getViewEndFn!());
}

function vXToTime(x: number): number {
  const duration = getDuration!();
  const width = canvas!.getBoundingClientRect().width;
  return xToTime(x, duration, width, getViewStartFn!(), getViewEndFn!());
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

function hitTestTrim(offsetX: number): 'trim-in' | 'trim-out' | null {
  if (!getTrimInFn || !getTrimOutFn) return null;
  const width = canvas!.getBoundingClientRect().width;

  const trimInX = vTimeToX(getTrimInFn());
  const trimOutX = vTimeToX(getTrimOutFn());

  if (Math.abs(offsetX - trimInX) <= TRIM_HIT_PX || (trimInX === 0 && offsetX <= TRIM_HIT_PX)) return 'trim-in';
  if (Math.abs(offsetX - trimOutX) <= TRIM_HIT_PX || (trimOutX >= width - 1 && offsetX >= width - TRIM_HIT_PX)) return 'trim-out';
  return null;
}

function hitTest(offsetX: number): HitState {
  const segments = getSegments!();
  const playhead = getPlayhead!();

  const result: HitState = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };

  // Check trim handles first (highest priority)
  const trimHit = hitTestTrim(offsetX);
  if (trimHit) {
    result.hoverEdge = trimHit === 'trim-in' ? 'start' : 'end';
    return result;
  }

  // Check playhead proximity
  const playheadX = vTimeToX(playhead);
  if (Math.abs(offsetX - playheadX) <= PLAYHEAD_HIT_PX) {
    result.hoverPlayhead = true;
    return result;
  }

  // Check segment edges, then bodies
  for (const seg of segments) {
    if (seg.type === 'speech') continue;

    const startX = vTimeToX(seg.start);
    const endX = vTimeToX(seg.end);

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
  const time = vXToTime(offsetX);
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

function updateCursor(hit: HitState, offsetX: number, offsetY?: number): void {
  if (!canvas) return;
  // Scrollbar area
  if (offsetY !== undefined && isZoomed()) {
    const rect = canvas.getBoundingClientRect();
    if (offsetY >= rect.height - SCROLLBAR_H) {
      canvas.style.cursor = 'grab';
      return;
    }
  }
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
  const playhead = getPlayhead!();
  const rect = canvas!.getBoundingClientRect();
  const w = rect.width;
  const viewSpan = getViewEndFn!() - getViewStartFn!();

  const snapThresholdTime = SNAP_PX / (w / viewSpan);

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

/** Get current range-select bounds (or null). Read by render loop for preview overlay. */
export function getRangeSelectState(): { start: number; end: number } | null {
  if (rangeSelectStart === null || rangeSelectEnd === null) return null;
  const s = Math.min(rangeSelectStart, rangeSelectEnd);
  const e = Math.max(rangeSelectStart, rangeSelectEnd);
  if (e - s < MIN_SEGMENT_DURATION) return null;
  return { start: s, end: e };
}

// ---------------------------------------------------------------------------
// Mouse handlers
// ---------------------------------------------------------------------------

function isZoomed(): boolean {
  const duration = getDuration!();
  const vStart = getViewStartFn!();
  const vEnd = getViewEndFn!();
  return (vEnd - vStart) < duration - 0.01;
}

function handleMouseDown(e: MouseEvent): void {
  const rect = canvas!.getBoundingClientRect();

  // Check scrollbar hit (bottom area, only when zoomed)
  if (isZoomed() && e.offsetY >= rect.height - SCROLLBAR_H) {
    const duration = getDuration!();
    const vStart = getViewStartFn!();
    const vEnd = getViewEndFn!();
    const viewSpan = vEnd - vStart;
    const thumbLeft = (vStart / duration) * rect.width;
    const thumbRight = (vEnd / duration) * rect.width;

    if (e.offsetX >= thumbLeft && e.offsetX <= thumbRight) {
      // Drag the thumb
      drag = {
        active: true,
        type: 'scrollbar',
        startX: e.offsetX,
        startY: e.offsetY,
        engaged: true,
        segmentId: null,
        edge: null,
        scrollbarAnchorViewStart: vStart,
      };
    } else {
      // Click on track — jump to center the thumb at click position
      const clickFrac = e.offsetX / rect.width;
      const center = clickFrac * duration;
      let newStart = center - viewSpan / 2;
      let newEnd = center + viewSpan / 2;
      if (newStart < 0) { newEnd -= newStart; newStart = 0; }
      if (newEnd > duration) { newStart -= newEnd - duration; newEnd = duration; }
      onZoom!(Math.max(0, newStart), Math.min(duration, newEnd));
    }
    return;
  }

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
      scrollbarAnchorViewStart: 0,
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
      scrollbarAnchorViewStart: 0,
    };
  } else {
    // Empty space (no segment body, no playhead) → range-select on drag
    const hitEmpty = !hit.hoverPlayhead && !hit.hoverSegmentId;
    drag = {
      active: true,
      type: hit.hoverPlayhead ? 'playhead' : (hitEmpty ? 'range-select' : null),
      startX: e.offsetX,
      startY: e.offsetY,
      engaged: false,
      segmentId: null,
      edge: null,
      scrollbarAnchorViewStart: 0,
    };
    if (hitEmpty) {
      const time = vXToTime(e.offsetX);
      rangeSelectStart = Math.max(0, Math.min(time, getDuration!()));
      rangeSelectEnd = rangeSelectStart;
    }
  }
}

function handleMouseMove(e: MouseEvent): void {
  if (drag.active) {
    const dx = e.offsetX - drag.startX;
    const dy = e.offsetY - drag.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!drag.engaged && dist >= DRAG_THRESHOLD_PX) {
      drag.engaged = true;
      // Notify controller once at drag start (for undo snapshot)
      if ((drag.type === 'edge' || drag.type === 'trim-in' || drag.type === 'trim-out') && onDragStart) {
        onDragStart();
      }
    }

    // Scrollbar dragging
    if (drag.type === 'scrollbar') {
      const rect = canvas!.getBoundingClientRect();
      const duration = getDuration!();
      const vStart = getViewStartFn!();
      const vEnd = getViewEndFn!();
      const viewSpan = vEnd - vStart;
      const dx = e.offsetX - drag.startX;
      const timeDelta = (dx / rect.width) * duration;
      let newStart = drag.scrollbarAnchorViewStart + timeDelta;
      let newEnd = newStart + viewSpan;
      if (newStart < 0) { newEnd -= newStart; newStart = 0; }
      if (newEnd > duration) { newStart -= newEnd - duration; newEnd = duration; }
      onZoom!(Math.max(0, newStart), Math.min(duration, newEnd));
      return;
    }

    // Trim handle dragging
    if (drag.engaged && (drag.type === 'trim-in' || drag.type === 'trim-out')) {
      const rect = canvas!.getBoundingClientRect();
      const duration = getDuration!();
      const time = xToTime(
        Math.max(0, Math.min(e.offsetX, rect.width)),
        duration,
        rect.width,
        getViewStartFn!(),
        getViewEndFn!(),
      );
      const clampedTime = Math.max(0, Math.min(time, duration));
      if (drag.type === 'trim-in' && onTrimIn) {
        const trimOutVal = getTrimOutFn ? getTrimOutFn() : duration;
        onTrimIn(Math.min(clampedTime, trimOutVal - 0.1));
      } else if (drag.type === 'trim-out' && onTrimOut) {
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
        getViewStartFn!(),
        getViewEndFn!(),
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
        getViewStartFn!(),
        getViewEndFn!(),
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

    // Range-select dragging — update end bound for preview overlay
    if (drag.engaged && drag.type === 'range-select') {
      const duration = getDuration!();
      const time = vXToTime(Math.max(0, Math.min(e.offsetX, canvas!.getBoundingClientRect().width)));
      rangeSelectEnd = Math.max(0, Math.min(time, duration));
      if (canvas) canvas.style.cursor = 'crosshair';
    }

    return;
  }

  // Not dragging — update hover state
  const hit = hitTest(e.offsetX);
  currentHit = hit;
  updateCursor(hit, e.offsetX, e.offsetY);
  onHitUpdate!(hit);
}

function handleMouseUp(e: MouseEvent): void {
  if (!drag.active) return;

  const wasDragging = drag.engaged;
  const wasType = drag.type;
  drag = { active: false, type: null, startX: 0, startY: 0, engaged: false, segmentId: null, edge: null, scrollbarAnchorViewStart: 0 };
  snapTime = null;

  if (wasDragging) {
    // Range-select completed — create the manual cut segment
    if (wasType === 'range-select' && rangeSelectStart !== null && rangeSelectEnd !== null) {
      const s = Math.min(rangeSelectStart, rangeSelectEnd);
      const eTime = Math.max(rangeSelectStart, rangeSelectEnd);
      rangeSelectStart = null;
      rangeSelectEnd = null;
      if (eTime - s >= MIN_SEGMENT_DURATION && onCreateSegment) {
        onCreateSegment(s, eTime);
      }
    }
    return; // drag completed, not a click
  }

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
  const duration = getDuration!();
  const time = vXToTime(e.offsetX);
  onSeek!(Math.max(0, Math.min(time, duration)));
}

function handleMouseLeave(): void {
  drag = { active: false, type: null, startX: 0, startY: 0, engaged: false, segmentId: null, edge: null, scrollbarAnchorViewStart: 0 };
  snapTime = null;
  rangeSelectStart = null;
  rangeSelectEnd = null;
  currentHit = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };
  if (canvas) canvas.style.cursor = 'default';
  onHitUpdate!(currentHit);
}

function handleWheel(e: WheelEvent): void {
  e.preventDefault();
  const duration = getDuration!();
  if (duration <= 0) return;

  const vStart = getViewStartFn!();
  const vEnd = getViewEndFn!();
  const viewSpan = vEnd - vStart;

  if (e.ctrlKey || e.metaKey) {
    // Zoom — centered on cursor position
    const rect = canvas!.getBoundingClientRect();
    const cursorTime = xToTime(e.offsetX, duration, rect.width, vStart, vEnd);
    const cursorFrac = (cursorTime - vStart) / viewSpan;

    const zoomFactor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const newSpan = Math.max(0.5, Math.min(duration, viewSpan * zoomFactor));

    let newStart = cursorTime - cursorFrac * newSpan;
    let newEnd = cursorTime + (1 - cursorFrac) * newSpan;

    // Clamp to [0, duration]
    if (newStart < 0) { newEnd -= newStart; newStart = 0; }
    if (newEnd > duration) { newStart -= newEnd - duration; newEnd = duration; }
    newStart = Math.max(0, newStart);
    newEnd = Math.min(duration, newEnd);

    onZoom!(newStart, newEnd);
  } else {
    // Pan — scroll horizontally
    const panAmount = (e.deltaY / 500) * viewSpan;
    let newStart = vStart + panAmount;
    let newEnd = vEnd + panAmount;

    // Clamp
    if (newStart < 0) { newEnd -= newStart; newStart = 0; }
    if (newEnd > duration) { newStart -= newEnd - duration; newEnd = duration; }
    newStart = Math.max(0, newStart);
    newEnd = Math.min(duration, newEnd);

    onZoom!(newStart, newEnd);
  }
}

function handleContextMenu(e: MouseEvent): void {
  // Right-click on segment → dismiss detection (convert to speech)
  const hit = hitTest(e.offsetX);
  if (hit.hoverSegmentId && !hit.hoverEdge) {
    e.preventDefault();
    onDismiss!(hit.hoverSegmentId);
  }
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
  getViewStart: () => number;
  getViewEnd: () => number;
  onSeek: SeekFn;
  onToggle: ToggleFn;
  onDismiss: DismissFn;
  onResize: ResizeFn;
  onTrimIn: TrimFn;
  onTrimOut: TrimFn;
  onHitUpdate: HitUpdateFn;
  onZoom: ZoomFn;
  onDragStart: DragStartFn;
  onCreateSegment: CreateSegmentFn;
}

export function initTimelineInteraction(opts: TimelineInteractionOptions): void {
  canvas = opts.canvas;
  getSegments = opts.getSegments;
  getDuration = opts.getDuration;
  getPlayhead = opts.getPlayhead;
  getTrimInFn = opts.getTrimIn;
  getTrimOutFn = opts.getTrimOut;
  getViewStartFn = opts.getViewStart;
  getViewEndFn = opts.getViewEnd;
  onSeek = opts.onSeek;
  onToggle = opts.onToggle;
  onDismiss = opts.onDismiss;
  onResize = opts.onResize;
  onTrimIn = opts.onTrimIn;
  onTrimOut = opts.onTrimOut;
  onHitUpdate = opts.onHitUpdate;
  onZoom = opts.onZoom;
  onDragStart = opts.onDragStart;
  onCreateSegment = opts.onCreateSegment;

  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseup', handleMouseUp);
  canvas.addEventListener('mouseleave', handleMouseLeave);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('contextmenu', handleContextMenu);
}

export function destroyTimelineInteraction(): void {
  if (canvas) {
    canvas.removeEventListener('mousedown', handleMouseDown);
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('mouseup', handleMouseUp);
    canvas.removeEventListener('mouseleave', handleMouseLeave);
    canvas.removeEventListener('wheel', handleWheel);
    canvas.removeEventListener('contextmenu', handleContextMenu);
    canvas.style.cursor = 'default';
    canvas = null;
  }

  getSegments = null;
  getDuration = null;
  getPlayhead = null;
  getTrimInFn = null;
  getTrimOutFn = null;
  getViewStartFn = null;
  getViewEndFn = null;
  onSeek = null;
  onToggle = null;
  onDismiss = null;
  onResize = null;
  onTrimIn = null;
  onTrimOut = null;
  onHitUpdate = null;
  onZoom = null;
  onDragStart = null;
  onCreateSegment = null;
  drag = { active: false, type: null, startX: 0, startY: 0, engaged: false, segmentId: null, edge: null, scrollbarAnchorViewStart: 0 };
  snapTime = null;
  rangeSelectStart = null;
  rangeSelectEnd = null;
  currentHit = { hoverSegmentId: null, hoverEdge: null, hoverPlayhead: false };
}
