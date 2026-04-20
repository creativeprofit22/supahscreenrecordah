// Music Timeline Interaction — card-based (select / drag / trim / split-UI / kf)
// ---------------------------------------------------------------------------

import type { MusicCard, VolumeKeyframe } from '../../../shared/music-types';
import {
  timeToX, xToTime, dbToY, yToDb, getMusicTrackBounds, getCardScreenBounds,
} from './music-timeline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DragState {
  active: boolean;
  type:
    | 'playhead'
    | 'card-move'
    | 'trim-head'
    | 'trim-tail'
    | 'keyframe'
    | 'volume-envelope'
    | 'pending-envelope-or-move'
    | null;
  startX: number;
  startY: number;
  engaged: boolean;
  cardId: string | null;
  anchorVideoStart: number;       // card-move anchor
  keyframeId: string | null;
  anchorBaselineDb: number;       // volume-envelope anchor
  // Trim: anchor captures the card's screen bounds + duration AT DRAG START so we can
  // compute absolute trim amounts regardless of how the card has been mutated mid-drag.
  anchorCardScreenX: number;
  anchorCardScreenW: number;
  anchorCardDuration: number;
}

function emptyDrag(): DragState {
  return {
    active: false, type: null, startX: 0, startY: 0, engaged: false,
    cardId: null, anchorVideoStart: 0, keyframeId: null, anchorBaselineDb: 0,
    anchorCardScreenX: 0, anchorCardScreenW: 0, anchorCardDuration: 0,
  };
}

const DRAG_THRESHOLD_PX = 4;
const TRIM_EDGE_HIT_PX = 6;
const KEYFRAME_HIT_RADIUS_PX = 7;
const ENVELOPE_HIT_TOLERANCE_PX = 6;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let canvas: HTMLCanvasElement | null = null;
let getVideoDuration: (() => number) | null = null;
let getCards: (() => MusicCard[]) | null = null;
let getSelectedCardId: (() => string | null) | null = null;
let hasMusic: (() => boolean) | null = null;
let getPlayhead: (() => number) | null = null;
let getVolumeBaselineDb: (() => number) | null = null;

let onSeek: ((t: number) => void) | null = null;
let onSelectCard: ((id: string | null) => void) | null = null;
let onHoverCard: ((id: string | null) => void) | null = null;

let onCardDragStart: ((id: string) => void) | null = null;
let onCardDrag: ((id: string, newVideoStart: number) => void) | null = null;
let onCardDragEnd: (() => void) | null = null;

let onTrimStart: ((cardId: string, edge: 'head' | 'tail') => void) | null = null;
let onTrimUpdate: ((cardId: string, edge: 'head' | 'tail', newTrimSec: number) => void) | null = null;
let onTrimEnd: (() => void) | null = null;
let onTrimHover: ((cardId: string | null, edge: 'head' | 'tail' | null) => void) | null = null;

let onAddKeyframe: ((cardId: string, cardLocalTime: number, db: number) => string) | null = null;
let onMoveKeyframe: ((cardId: string, kfId: string, cardLocalTime: number, db: number) => void) | null = null;
let onDeleteKeyframe: ((cardId: string, kfId: string) => void) | null = null;
let onHoverKeyframe: ((cardId: string | null, kfId: string | null) => void) | null = null;
let onKeyframeDragStart: ((cardId: string, kfId: string) => void) | null = null;
let onKeyframeDragEnd: (() => void) | null = null;

let onVolumeDragStart: (() => void) | null = null;
let onVolumeDrag: ((db: number, deltaFromAnchorDb: number) => void) | null = null;
let onVolumeDragEnd: (() => void) | null = null;

let drag: DragState = emptyDrag();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canvasWidth(): number {
  return canvas ? canvas.getBoundingClientRect().width : 0;
}

function canvasHeight(): number {
  return canvas ? canvas.getBoundingClientRect().height : 0;
}

function isInMusicTrack(y: number): boolean {
  const h = canvasHeight();
  return y > h / 2;
}

/** Find the card whose screen bounds contain x (within the music track row). */
function hitTestCard(x: number): MusicCard | null {
  if (!getCards || !getVideoDuration) return null;
  const w = canvasWidth();
  const vd = getVideoDuration();
  for (const card of getCards()) {
    const { x: cx, w: cw } = getCardScreenBounds(card, vd, w);
    if (x >= cx && x <= cx + cw) return card;
  }
  return null;
}

/** Hit-test trim edges; returns { card, edge } or null. */
function hitTestTrimEdge(x: number, y: number): { card: MusicCard; edge: 'head' | 'tail' } | null {
  if (!getCards || !getVideoDuration) return null;
  const h = canvasHeight();
  const { y: tY, h: tH } = getMusicTrackBounds(h);
  if (y < tY || y > tY + tH) return null;
  const w = canvasWidth();
  const vd = getVideoDuration();
  for (const card of getCards()) {
    const { x: cx, w: cw } = getCardScreenBounds(card, vd, w);
    if (cw < 6) continue;
    if (Math.abs(x - cx) <= TRIM_EDGE_HIT_PX) return { card, edge: 'head' };
    if (Math.abs(x - (cx + cw)) <= TRIM_EDGE_HIT_PX) return { card, edge: 'tail' };
  }
  return null;
}

/** Hit-test keyframe diamonds within any card. */
function hitTestKeyframe(x: number, y: number): { card: MusicCard; kf: VolumeKeyframe } | null {
  if (!getCards || !getVideoDuration) return null;
  const h = canvasHeight();
  const { y: tY, h: tH } = getMusicTrackBounds(h);
  if (y < tY || y > tY + tH) return null;
  const w = canvasWidth();
  const vd = getVideoDuration();
  // Iterate cards in reverse to match draw order (dragged on top)
  const list = getCards().slice().reverse();
  for (const card of list) {
    const { x: cx, w: cw } = getCardScreenBounds(card, vd, w);
    for (let i = card.keyframes.length - 1; i >= 0; i--) {
      const kf = card.keyframes[i];
      const kx = cx + (card.duration > 0 ? (kf.time / card.duration) * cw : 0);
      const ky = dbToY(kf.db, tY, tH);
      if (Math.abs(x - kx) <= KEYFRAME_HIT_RADIUS_PX && Math.abs(y - ky) <= KEYFRAME_HIT_RADIUS_PX) {
        return { card, kf };
      }
    }
  }
  return null;
}

/** Hit-test envelope line (the polyline inside each card). */
function hitTestEnvelope(x: number, y: number): MusicCard | null {
  if (!getCards || !getVideoDuration || !getVolumeBaselineDb) return null;
  const h = canvasHeight();
  const { y: tY, h: tH } = getMusicTrackBounds(h);
  if (y < tY || y > tY + tH) return null;
  const w = canvasWidth();
  const vd = getVideoDuration();
  const baselineDb = getVolumeBaselineDb();
  for (const card of getCards()) {
    const { x: cx, w: cw } = getCardScreenBounds(card, vd, w);
    if (x < cx || x > cx + cw) continue;
    // Evaluate envelope at this X (card-local)
    const cardLocalTime = card.duration > 0 ? ((x - cx) / cw) * card.duration : 0;
    const kfs = card.keyframes;
    let db: number;
    if (kfs.length === 0) {
      db = baselineDb;
    } else {
      const sorted = kfs.slice().sort((a, b) => a.time - b.time);
      if (cardLocalTime <= sorted[0].time) db = sorted[0].db;
      else if (cardLocalTime >= sorted[sorted.length - 1].time) db = sorted[sorted.length - 1].db;
      else {
        db = sorted[sorted.length - 1].db;
        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i], b = sorted[i + 1];
          if (cardLocalTime >= a.time && cardLocalTime <= b.time) {
            const dt = b.time - a.time;
            const frac = dt > 0 ? (cardLocalTime - a.time) / dt : 0;
            db = a.db + frac * (b.db - a.db);
            break;
          }
        }
      }
    }
    const envY = dbToY(db, tY, tH);
    if (Math.abs(y - envY) <= ENVELOPE_HIT_TOLERANCE_PX) return card;
  }
  return null;
}

function xToCardLocal(x: number, card: MusicCard): number {
  const w = canvasWidth();
  const vd = getVideoDuration!();
  const { x: cx, w: cw } = getCardScreenBounds(card, vd, w);
  if (cw <= 0 || card.duration <= 0) return 0;
  return Math.max(0, Math.min(card.duration, ((x - cx) / cw) * card.duration));
}

// ---------------------------------------------------------------------------
// Mouse handlers
// ---------------------------------------------------------------------------

function handleMouseDown(e: MouseEvent): void {
  // Right-click deletes a keyframe if over one
  if (e.button === 2) {
    if (hasMusic!() && isInMusicTrack(e.offsetY)) {
      const kfHit = hitTestKeyframe(e.offsetX, e.offsetY);
      if (kfHit) {
        e.preventDefault();
        onDeleteKeyframe?.(kfHit.card.id, kfHit.kf.id);
      }
    }
    return;
  }
  if (e.button !== 0) return;

  const inMusic = isInMusicTrack(e.offsetY);

  // 1) Keyframe handle
  if (inMusic && hasMusic!()) {
    const kfHit = hitTestKeyframe(e.offsetX, e.offsetY);
    if (kfHit) {
      drag = { ...emptyDrag(), active: true, type: 'keyframe', startX: e.offsetX, startY: e.offsetY, engaged: true, cardId: kfHit.card.id, keyframeId: kfHit.kf.id };
      onSelectCard?.(kfHit.card.id);
      onKeyframeDragStart?.(kfHit.card.id, kfHit.kf.id);
      if (canvas) canvas.style.cursor = 'grabbing';
      return;
    }
  }

  // 2) Trim edge — capture anchor bounds so subsequent frames can compute an absolute trim
  if (inMusic && hasMusic!()) {
    const trimHit = hitTestTrimEdge(e.offsetX, e.offsetY);
    if (trimHit) {
      const w = canvasWidth();
      const vd = getVideoDuration!();
      const bounds = getCardScreenBounds(trimHit.card, vd, w);
      drag = {
        ...emptyDrag(),
        active: true,
        type: trimHit.edge === 'head' ? 'trim-head' : 'trim-tail',
        startX: e.offsetX, startY: e.offsetY, engaged: true,
        cardId: trimHit.card.id,
        anchorCardScreenX: bounds.x,
        anchorCardScreenW: bounds.w,
        anchorCardDuration: trimHit.card.duration,
      };
      onSelectCard?.(trimHit.card.id);
      onTrimStart?.(trimHit.card.id, trimHit.edge);
      if (canvas) canvas.style.cursor = 'ew-resize';
      return;
    }
  }

  // 3) Alt+click inside a card → add keyframe at cursor
  if (inMusic && hasMusic!() && e.altKey) {
    const cardHit = hitTestCard(e.offsetX);
    if (cardHit && onAddKeyframe) {
      const h = canvasHeight();
      const { y: tY, h: tH } = getMusicTrackBounds(h);
      const cardLocal = xToCardLocal(e.offsetX, cardHit);
      const db = yToDb(e.offsetY, tY, tH);
      const newId = onAddKeyframe(cardHit.id, cardLocal, db);
      drag = { ...emptyDrag(), active: true, type: 'keyframe', startX: e.offsetX, startY: e.offsetY, engaged: true, cardId: cardHit.id, keyframeId: newId };
      onSelectCard?.(cardHit.id);
      onKeyframeDragStart?.(cardHit.id, newId);
      if (canvas) canvas.style.cursor = 'grabbing';
      return;
    }
  }

  // 4) Envelope line → pending (resolved by first drag direction)
  if (inMusic && hasMusic!()) {
    const envHit = hitTestEnvelope(e.offsetX, e.offsetY);
    if (envHit) {
      drag = {
        ...emptyDrag(),
        active: true,
        type: 'pending-envelope-or-move',
        startX: e.offsetX, startY: e.offsetY,
        cardId: envHit.id,
        anchorVideoStart: envHit.videoStart,
      };
      onSelectCard?.(envHit.id);
      return;
    }
  }

  // 5) Plain click on a card body → select + start move
  if (inMusic && hasMusic!()) {
    const cardHit = hitTestCard(e.offsetX);
    if (cardHit) {
      drag = {
        ...emptyDrag(),
        active: true,
        type: 'card-move',
        startX: e.offsetX, startY: e.offsetY,
        cardId: cardHit.id,
        anchorVideoStart: cardHit.videoStart,
      };
      onSelectCard?.(cardHit.id);
      return;
    }

    // Click on empty music row → deselect + seek playhead
    onSelectCard?.(null);
    drag = { ...emptyDrag(), active: true, type: 'playhead', startX: e.offsetX, startY: e.offsetY };
    return;
  }

  // Top track or out of music row → seek
  drag = { ...emptyDrag(), active: true, type: 'playhead', startX: e.offsetX, startY: e.offsetY };
}

function handleMouseMove(e: MouseEvent): void {
  if (drag.active) {
    const dx = e.offsetX - drag.startX;
    const dy = e.offsetY - drag.startY;
    const moved = Math.max(Math.abs(dx), Math.abs(dy));

    if (!drag.engaged && moved >= DRAG_THRESHOLD_PX) {
      drag.engaged = true;
      // Pending envelope → commit based on direction
      if (drag.type === 'pending-envelope-or-move') {
        if (Math.abs(dy) > Math.abs(dx)) {
          // Vertical → volume envelope
          drag.type = 'volume-envelope';
          drag.anchorBaselineDb = getVolumeBaselineDb!();
          onVolumeDragStart?.();
          const h = canvasHeight();
          const { y: tY, h: tH } = getMusicTrackBounds(h);
          const dbNow = yToDb(e.offsetY, tY, tH);
          onVolumeDrag?.(dbNow, dbNow - drag.anchorBaselineDb);
        } else {
          // Horizontal → card move
          drag.type = 'card-move';
          if (drag.cardId) onCardDragStart?.(drag.cardId);
        }
      } else if (drag.type === 'card-move') {
        if (drag.cardId) onCardDragStart?.(drag.cardId);
      }
    }

    if (drag.engaged) {
      if (drag.type === 'card-move' && drag.cardId) {
        const w = canvasWidth();
        const vd = getVideoDuration!();
        const dtSec = xToTime(dx, vd, w);
        const newStart = Math.max(0, drag.anchorVideoStart + dtSec);
        onCardDrag?.(drag.cardId, newStart);
        if (canvas) canvas.style.cursor = 'grabbing';
        return;
      }
      if ((drag.type === 'trim-head' || drag.type === 'trim-tail') && drag.cardId) {
        // Send a SIGNED delta (positive = shrink / trim inward, negative =
        // extend / restore) in the anchor's coordinate system. The mixer
        // clamps against the card's orig* bounds + neighbors, so outward
        // drags can reach all the way back to the original edge even after
        // prior trims.
        const anchorW = drag.anchorCardScreenW;
        const anchorDur = drag.anchorCardDuration;
        const cursorFracFromAnchorStart = anchorW > 0
          ? (e.offsetX - drag.anchorCardScreenX) / anchorW
          : 0;
        const cursorInAnchor = cursorFracFromAnchorStart * anchorDur;
        if (drag.type === 'trim-head') {
          onTrimUpdate?.(drag.cardId, 'head', cursorInAnchor);
        } else {
          onTrimUpdate?.(drag.cardId, 'tail', anchorDur - cursorInAnchor);
        }
        if (canvas) canvas.style.cursor = 'ew-resize';
        return;
      }
      if (drag.type === 'keyframe' && drag.cardId && drag.keyframeId) {
        const cards = getCards!();
        const card = cards.find(c => c.id === drag.cardId);
        if (card) {
          const cardLocal = xToCardLocal(e.offsetX, card);
          const h = canvasHeight();
          const { y: tY, h: tH } = getMusicTrackBounds(h);
          const db = yToDb(e.offsetY, tY, tH);
          onMoveKeyframe?.(card.id, drag.keyframeId, cardLocal, db);
        }
        if (canvas) canvas.style.cursor = 'grabbing';
        return;
      }
      if (drag.type === 'volume-envelope') {
        const h = canvasHeight();
        const { y: tY, h: tH } = getMusicTrackBounds(h);
        const dbNow = yToDb(e.offsetY, tY, tH);
        onVolumeDrag?.(dbNow, dbNow - drag.anchorBaselineDb);
        if (canvas) canvas.style.cursor = 'ns-resize';
        return;
      }
      if (drag.type === 'playhead') {
        const w = canvasWidth();
        const vd = getVideoDuration!();
        onSeek?.(Math.max(0, Math.min(vd, xToTime(Math.max(0, Math.min(e.offsetX, w)), vd, w))));
        return;
      }
    }
    return;
  }

  // Hover cursor
  if (!canvas) return;
  const inMusic = isInMusicTrack(e.offsetY);

  if (inMusic && hasMusic!()) {
    const kfHover = hitTestKeyframe(e.offsetX, e.offsetY);
    onHoverKeyframe?.(kfHover?.card.id ?? null, kfHover?.kf.id ?? null);

    const trimHit = !kfHover ? hitTestTrimEdge(e.offsetX, e.offsetY) : null;
    onTrimHover?.(trimHit?.card.id ?? null, trimHit?.edge ?? null);

    const envHit = !kfHover && !trimHit ? hitTestEnvelope(e.offsetX, e.offsetY) : null;
    const cardHover = !kfHover && !trimHit && !envHit ? hitTestCard(e.offsetX) : null;
    onHoverCard?.(envHit?.id ?? cardHover?.id ?? kfHover?.card.id ?? trimHit?.card.id ?? null);

    if (kfHover) canvas.style.cursor = 'grab';
    else if (trimHit) canvas.style.cursor = 'ew-resize';
    else if (envHit) canvas.style.cursor = e.altKey ? 'copy' : 'ns-resize';
    else if (cardHover) canvas.style.cursor = e.altKey ? 'copy' : 'grab';
    else canvas.style.cursor = 'default';
  } else {
    onHoverKeyframe?.(null, null);
    onTrimHover?.(null, null);
    onHoverCard?.(null);
    canvas.style.cursor = 'default';
  }
}

function handleMouseUp(): void {
  if (!drag.active) return;

  const wasType = drag.type;
  const wasEngaged = drag.engaged;
  const wasCardId = drag.cardId;
  const wasStartX = drag.startX;
  drag = emptyDrag();

  if (wasEngaged) {
    if (wasType === 'card-move') {
      onCardDragEnd?.();
    } else if (wasType === 'trim-head' || wasType === 'trim-tail') {
      onTrimEnd?.();
    } else if (wasType === 'keyframe') {
      onKeyframeDragEnd?.();
    } else if (wasType === 'volume-envelope') {
      onVolumeDragEnd?.();
    }
    return;
  }

  // Click (no drag)
  if (wasType === 'playhead') {
    if (!canvas) return;
    const w = canvasWidth();
    const vd = getVideoDuration!();
    onSeek?.(Math.max(0, Math.min(vd, xToTime(Math.max(0, Math.min(wasStartX, w)), vd, w))));
  }
  // Card-body click without drag: selection was already applied on mousedown
}

function handleMouseLeave(): void {
  if (drag.engaged) {
    if (drag.type === 'card-move') onCardDragEnd?.();
    else if (drag.type === 'trim-head' || drag.type === 'trim-tail') onTrimEnd?.();
    else if (drag.type === 'keyframe') onKeyframeDragEnd?.();
    else if (drag.type === 'volume-envelope') onVolumeDragEnd?.();
  }
  drag = emptyDrag();
  onHoverKeyframe?.(null, null);
  onTrimHover?.(null, null);
  onHoverCard?.(null);
  if (canvas) canvas.style.cursor = 'default';
}

function handleContextMenu(e: MouseEvent): void {
  e.preventDefault();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MusicInteractionOptions {
  canvas: HTMLCanvasElement;
  getVideoDuration: () => number;
  getCards: () => MusicCard[];
  getSelectedCardId: () => string | null;
  hasMusic: () => boolean;
  getPlayhead: () => number;
  getVolumeBaselineDb: () => number;

  onSeek: (t: number) => void;
  onSelectCard: (id: string | null) => void;
  onHoverCard: (id: string | null) => void;

  onCardDragStart: (id: string) => void;
  onCardDrag: (id: string, newVideoStart: number) => void;
  onCardDragEnd: () => void;

  onTrimStart: (cardId: string, edge: 'head' | 'tail') => void;
  onTrimUpdate: (cardId: string, edge: 'head' | 'tail', newTrimSec: number) => void;
  onTrimEnd: () => void;
  onTrimHover: (cardId: string | null, edge: 'head' | 'tail' | null) => void;

  onAddKeyframe: (cardId: string, cardLocalTime: number, db: number) => string;
  onMoveKeyframe: (cardId: string, kfId: string, cardLocalTime: number, db: number) => void;
  onDeleteKeyframe: (cardId: string, kfId: string) => void;
  onHoverKeyframe: (cardId: string | null, kfId: string | null) => void;
  onKeyframeDragStart: (cardId: string, kfId: string) => void;
  onKeyframeDragEnd: () => void;

  onVolumeDragStart: () => void;
  onVolumeDrag: (db: number, deltaFromAnchorDb: number) => void;
  onVolumeDragEnd: () => void;
}

export function initMusicInteraction(opts: MusicInteractionOptions): void {
  canvas = opts.canvas;
  getVideoDuration = opts.getVideoDuration;
  getCards = opts.getCards;
  getSelectedCardId = opts.getSelectedCardId;
  hasMusic = opts.hasMusic;
  getPlayhead = opts.getPlayhead;
  getVolumeBaselineDb = opts.getVolumeBaselineDb;

  onSeek = opts.onSeek;
  onSelectCard = opts.onSelectCard;
  onHoverCard = opts.onHoverCard;

  onCardDragStart = opts.onCardDragStart;
  onCardDrag = opts.onCardDrag;
  onCardDragEnd = opts.onCardDragEnd;

  onTrimStart = opts.onTrimStart;
  onTrimUpdate = opts.onTrimUpdate;
  onTrimEnd = opts.onTrimEnd;
  onTrimHover = opts.onTrimHover;

  onAddKeyframe = opts.onAddKeyframe;
  onMoveKeyframe = opts.onMoveKeyframe;
  onDeleteKeyframe = opts.onDeleteKeyframe;
  onHoverKeyframe = opts.onHoverKeyframe;
  onKeyframeDragStart = opts.onKeyframeDragStart;
  onKeyframeDragEnd = opts.onKeyframeDragEnd;

  onVolumeDragStart = opts.onVolumeDragStart;
  onVolumeDrag = opts.onVolumeDrag;
  onVolumeDragEnd = opts.onVolumeDragEnd;

  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseup', handleMouseUp);
  canvas.addEventListener('mouseleave', handleMouseLeave);
  canvas.addEventListener('contextmenu', handleContextMenu);
}

export function destroyMusicInteraction(): void {
  if (canvas) {
    canvas.removeEventListener('mousedown', handleMouseDown);
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('mouseup', handleMouseUp);
    canvas.removeEventListener('mouseleave', handleMouseLeave);
    canvas.removeEventListener('contextmenu', handleContextMenu);
    canvas.style.cursor = 'default';
    canvas = null;
  }
  getVideoDuration = null;
  getCards = null;
  getSelectedCardId = null;
  hasMusic = null;
  getPlayhead = null;
  getVolumeBaselineDb = null;
  onSeek = null;
  onSelectCard = null;
  onHoverCard = null;
  onCardDragStart = null;
  onCardDrag = null;
  onCardDragEnd = null;
  onTrimStart = null;
  onTrimUpdate = null;
  onTrimEnd = null;
  onTrimHover = null;
  onAddKeyframe = null;
  onMoveKeyframe = null;
  onDeleteKeyframe = null;
  onHoverKeyframe = null;
  onKeyframeDragStart = null;
  onKeyframeDragEnd = null;
  onVolumeDragStart = null;
  onVolumeDrag = null;
  onVolumeDragEnd = null;
  drag = emptyDrag();
}
