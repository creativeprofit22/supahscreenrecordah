// Music Timeline Renderer — card-based dual-track canvas
// ---------------------------------------------------------------------------

import type { WaveformData } from '../../../shared/review-types';
import type { MusicCard, VolumeKeyframe } from '../../../shared/music-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MusicTimelineState {
  videoWaveform: WaveformData;
  musicWaveform: WaveformData | null;
  videoDuration: number;
  playhead: number;

  cards: MusicCard[];

  selectedCardId: string | null;
  hoverCardId: string | null;
  draggingCardId: string | null;

  trimHover: { cardId: string; edge: 'head' | 'tail' } | null;
  trimDragging: { cardId: string; edge: 'head' | 'tail' } | null;

  hoverKeyframe: { cardId: string; keyframeId: string } | null;
  draggingKeyframe: { cardId: string; keyframeId: string } | null;

  musicVolumeDb: number;
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

export function timeToX(time: number, duration: number, width: number): number {
  if (duration <= 0) return 0;
  return (time / duration) * width;
}

export function xToTime(x: number, duration: number, width: number): number {
  if (width <= 0) return 0;
  return (x / width) * duration;
}

// ---------------------------------------------------------------------------
// Envelope (dB ↔ Y) geometry
// ---------------------------------------------------------------------------

export const ENV_MIN_DB = -60;
export const ENV_MAX_DB = 6;
const ENV_PAD_PX = 3;

export function dbToY(db: number, trackTopY: number, trackHeight: number): number {
  const clamped = Math.max(ENV_MIN_DB, Math.min(ENV_MAX_DB, db));
  const frac = (clamped - ENV_MIN_DB) / (ENV_MAX_DB - ENV_MIN_DB);
  return trackTopY + ENV_PAD_PX + (1 - frac) * (trackHeight - 2 * ENV_PAD_PX);
}

export function yToDb(y: number, trackTopY: number, trackHeight: number): number {
  const frac = 1 - (y - trackTopY - ENV_PAD_PX) / (trackHeight - 2 * ENV_PAD_PX);
  const db = ENV_MIN_DB + frac * (ENV_MAX_DB - ENV_MIN_DB);
  return Math.max(ENV_MIN_DB, Math.min(ENV_MAX_DB, db));
}

/** Layout helper — returns the Y/height of the music track area. */
export function getMusicTrackBounds(canvasHeight: number): { y: number; h: number } {
  const halfH = Math.floor((canvasHeight - TRACK_GAP) / 2);
  return { y: halfH + TRACK_GAP, h: halfH };
}

/** Evaluate a card's envelope at a card-local time (falls back to baseline if no kfs). */
export function evalCardEnvelopeDb(card: MusicCard, cardLocalTime: number, baselineDb: number): number {
  const kfs = card.keyframes;
  if (kfs.length === 0) return baselineDb;
  const sorted = kfs.slice().sort((a, b) => a.time - b.time);
  if (cardLocalTime <= sorted[0].time) return sorted[0].db;
  if (cardLocalTime >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].db;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (cardLocalTime >= a.time && cardLocalTime <= b.time) {
      const dt = b.time - a.time;
      const frac = dt > 0 ? (cardLocalTime - a.time) / dt : 0;
      return a.db + frac * (b.db - a.db);
    }
  }
  return sorted[sorted.length - 1].db;
}

/** Compute the on-screen X bounds for a card. */
export function getCardScreenBounds(
  card: MusicCard,
  videoDuration: number,
  canvasWidth: number,
): { x: number; w: number } {
  const x = timeToX(card.videoStart, videoDuration, canvasWidth);
  const w = timeToX(card.duration, videoDuration, canvasWidth);
  return { x, w };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const TRACK_GAP = 1;

export function renderMusicTimeline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: MusicTimelineState,
): void {
  const {
    videoWaveform, musicWaveform, videoDuration, playhead,
    cards, selectedCardId, hoverCardId, draggingCardId,
    trimHover, trimDragging, hoverKeyframe, draggingKeyframe, musicVolumeDb,
  } = state;

  const halfH = Math.floor((height - TRACK_GAP) / 2);
  const topY = 0;
  const botY = halfH + TRACK_GAP;

  // Background
  ctx.fillStyle = '#1e1e2e';
  ctx.fillRect(0, 0, width, height);

  // Divider
  ctx.fillStyle = 'rgba(205, 214, 244, 0.08)';
  ctx.fillRect(0, halfH, width, TRACK_GAP);

  // Top track — video audio
  drawWaveform(ctx, videoWaveform, 0, width, topY, halfH, '#89dceb', '#94e2d5');

  // Bottom track — music cards
  if (cards.length === 0 || !musicWaveform || musicWaveform.samples.length === 0) {
    ctx.fillStyle = 'rgba(205, 214, 244, 0.06)';
    ctx.fillRect(0, botY, width, halfH);
    ctx.fillStyle = 'rgba(205, 214, 244, 0.2)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Click "Add Music" to load a track', width / 2, botY + halfH / 2);
  } else {
    // Music row background (subtle to distinguish from gaps)
    ctx.fillStyle = 'rgba(205, 214, 244, 0.02)';
    ctx.fillRect(0, botY, width, halfH);

    // Draw each card in video-start order; dragged card drawn last (on top)
    const byOrder = cards.slice().sort((a, b) => a.videoStart - b.videoStart);
    // Move dragged card to end
    if (draggingCardId) {
      const i = byOrder.findIndex(c => c.id === draggingCardId);
      if (i >= 0) {
        const dragged = byOrder.splice(i, 1)[0];
        byOrder.push(dragged);
      }
    }
    for (const card of byOrder) {
      drawCard(
        ctx, card, musicWaveform, videoDuration, width, botY, halfH,
        {
          selected: card.id === selectedCardId,
          hovered: card.id === hoverCardId,
          dragging: card.id === draggingCardId,
          trimHover: trimHover && trimHover.cardId === card.id ? trimHover.edge : null,
          trimDragging: trimDragging && trimDragging.cardId === card.id ? trimDragging.edge : null,
          hoverKeyframeId: hoverKeyframe && hoverKeyframe.cardId === card.id ? hoverKeyframe.keyframeId : null,
          draggingKeyframeId: draggingKeyframe && draggingKeyframe.cardId === card.id ? draggingKeyframe.keyframeId : null,
          musicVolumeDb,
          musicDuration: musicWaveform.duration,
        },
      );
    }
  }

  // Playhead
  if (videoDuration > 0) {
    const px = timeToX(playhead, videoDuration, width);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px - 1, 0, 2, height);
    const tri = 5;
    ctx.beginPath();
    ctx.moveTo(px - tri, 0);
    ctx.lineTo(px + tri, 0);
    ctx.lineTo(px, tri);
    ctx.closePath();
    ctx.fill();

    // Time label
    const label = formatTime(playhead);
    ctx.font = '11px monospace';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    const labelW = ctx.measureText(label).width + 8;
    const labelH = 16;
    let lx = px + 6;
    if (lx + labelW > width) lx = px - 6 - labelW;
    const ly = height - 4;
    ctx.fillStyle = 'rgba(30, 30, 46, 0.8)';
    ctx.fillRect(lx, ly - labelH, labelW, labelH);
    ctx.fillStyle = '#cdd6f4';
    ctx.fillText(label, lx + 4, ly - 3);
  }
}

// ---------------------------------------------------------------------------
// Card drawing
// ---------------------------------------------------------------------------

interface CardDrawOpts {
  selected: boolean;
  hovered: boolean;
  dragging: boolean;
  trimHover: 'head' | 'tail' | null;
  trimDragging: 'head' | 'tail' | null;
  hoverKeyframeId: string | null;
  draggingKeyframeId: string | null;
  musicVolumeDb: number;
  musicDuration: number;
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  card: MusicCard,
  musicWaveform: WaveformData,
  videoDuration: number,
  canvasWidth: number,
  trackY: number,
  trackH: number,
  opts: CardDrawOpts,
): void {
  const { x, w } = getCardScreenBounds(card, videoDuration, canvasWidth);
  if (w <= 0) return;

  const dragging = opts.dragging;
  const active = opts.selected || dragging;

  // Card background
  ctx.fillStyle = active
    ? 'rgba(203, 166, 247, 0.12)'
    : (opts.hovered ? 'rgba(203, 166, 247, 0.06)' : 'rgba(203, 166, 247, 0.02)');
  ctx.fillRect(x, trackY, w, trackH);

  // Clip to card for child drawing
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, trackY, w, trackH);
  ctx.clip();

  // --- Waveform slice from card.sourceStart to card.sourceStart + card.duration ---
  drawCardWaveform(ctx, musicWaveform, card, x, w, trackY, trackH, '#cba6f7', '#b4befe');

  // --- 0 dB reference ---
  const zeroY = dbToY(0, trackY, trackH);
  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(205, 214, 244, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, zeroY);
  ctx.lineTo(x + w, zeroY);
  ctx.stroke();
  ctx.restore();

  // --- Envelope polyline ---
  const kfs = card.keyframes.slice().sort((a, b) => a.time - b.time);
  const cardLocalToX = (t: number): number => x + (card.duration > 0 ? (t / card.duration) * w : 0);

  const envActive = opts.hoverKeyframeId || opts.draggingKeyframeId;
  ctx.strokeStyle = envActive ? '#f9e2af' : 'rgba(249, 226, 175, 0.75)';
  ctx.lineWidth = envActive ? 2.5 : 2;

  if (kfs.length === 0) {
    const envY = dbToY(opts.musicVolumeDb, trackY, trackH);
    ctx.beginPath();
    ctx.moveTo(x, envY);
    ctx.lineTo(x + w, envY);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x, dbToY(kfs[0].db, trackY, trackH));
    for (const kf of kfs) {
      ctx.lineTo(cardLocalToX(kf.time), dbToY(kf.db, trackY, trackH));
    }
    ctx.lineTo(x + w, dbToY(kfs[kfs.length - 1].db, trackY, trackH));
    ctx.stroke();

    // Keyframe diamonds
    for (const kf of kfs) {
      const kx = cardLocalToX(kf.time);
      const ky = dbToY(kf.db, trackY, trackH);
      const isActive = kf.id === opts.hoverKeyframeId || kf.id === opts.draggingKeyframeId;
      const r = isActive ? 6 : 4.5;
      ctx.fillStyle = isActive ? '#f9e2af' : '#1e1e2e';
      ctx.strokeStyle = '#f9e2af';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(kx, ky - r);
      ctx.lineTo(kx + r, ky);
      ctx.lineTo(kx, ky + r);
      ctx.lineTo(kx - r, ky);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore(); // end clip

  // --- Border ---
  if (opts.selected || dragging) {
    ctx.strokeStyle = 'rgba(203, 166, 247, 0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, trackY + 1, w - 2, trackH - 2);
  } else {
    ctx.strokeStyle = opts.hovered ? 'rgba(203, 166, 247, 0.7)' : 'rgba(203, 166, 247, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, trackY + 0.5, w - 1, trackH - 1);
  }

  // --- Trim grips ---
  if (w > 6) {
    drawGrip(ctx, x, trackY, trackH, opts.trimHover === 'head' || opts.trimDragging === 'head');
    drawGrip(ctx, x + w, trackY, trackH, opts.trimHover === 'tail' || opts.trimDragging === 'tail');
  }

  // --- dB label when drag/hover on keyframe or envelope ---
  const labelDb =
    opts.draggingKeyframeId ? kfs.find(k => k.id === opts.draggingKeyframeId)?.db :
    opts.hoverKeyframeId ? kfs.find(k => k.id === opts.hoverKeyframeId)?.db :
    undefined;
  if (labelDb !== undefined) {
    const kf = kfs.find(k => k.id === (opts.draggingKeyframeId ?? opts.hoverKeyframeId));
    if (kf) {
      const lx0 = cardLocalToX(kf.time);
      const ly0 = dbToY(kf.db, trackY, trackH);
      drawDbBubble(ctx, lx0, ly0, kf.db, canvasWidth);
    }
  }

  // --- Trim tooltip ---
  if (opts.trimDragging) {
    const label = opts.trimDragging === 'head'
      ? `Head: ${(card.sourceStart).toFixed(2)}s`
      : `End at: ${(card.sourceStart + card.duration).toFixed(2)}s`;
    drawFloatingLabel(ctx, opts.trimDragging === 'head' ? x : x + w, trackY + 12, label, canvasWidth, 'rgba(203, 166, 247, 0.85)', '#cba6f7');
  }
}

function drawGrip(ctx: CanvasRenderingContext2D, gx: number, trackY: number, trackH: number, active: boolean): void {
  const stripeW = 4;
  ctx.save();
  ctx.fillStyle = active ? '#cba6f7' : 'rgba(203, 166, 247, 0.55)';
  ctx.fillRect(gx - stripeW / 2, trackY + 2, stripeW, trackH - 4);
  ctx.fillStyle = active ? 'rgba(30, 30, 46, 0.6)' : 'rgba(30, 30, 46, 0.4)';
  ctx.fillRect(gx - 0.5, trackY + 6, 1, trackH - 12);
  ctx.restore();
}

function drawDbBubble(ctx: CanvasRenderingContext2D, cx: number, cy: number, db: number, canvasWidth: number): void {
  const label = formatDbLabel(db);
  drawFloatingLabel(ctx, cx, cy - 12, label, canvasWidth, 'rgba(249, 226, 175, 0.8)', '#f9e2af');
}

function drawFloatingLabel(ctx: CanvasRenderingContext2D, cx: number, cy: number, label: string, canvasWidth: number, border: string, fill: string): void {
  ctx.font = '11px monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const labelW = ctx.measureText(label).width + 10;
  const labelH = 16;
  let lx = cx - labelW / 2;
  lx = Math.max(0, Math.min(lx, canvasWidth - labelW));
  ctx.fillStyle = 'rgba(30, 30, 46, 0.92)';
  ctx.fillRect(lx, cy - labelH / 2, labelW, labelH);
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(lx + 0.5, cy - labelH / 2 + 0.5, labelW - 1, labelH - 1);
  ctx.fillStyle = fill;
  ctx.fillText(label, lx + 5, cy + 1);
}

// ---------------------------------------------------------------------------
// Waveform drawing
// ---------------------------------------------------------------------------

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  waveform: WaveformData,
  startX: number,
  regionW: number,
  y: number,
  h: number,
  color1: string,
  color2: string,
): void {
  const samples = waveform.samples;
  if (samples.length === 0) return;
  const maxBarH = (h - 8) / 2;
  const centerY = y + h / 2;
  const barW = regionW / samples.length;
  const gradient = ctx.createLinearGradient(0, centerY + maxBarH, 0, centerY - maxBarH);
  gradient.addColorStop(0, color1);
  gradient.addColorStop(1, color2);
  ctx.fillStyle = gradient;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const barH = sample * maxBarH;
    if (barH < 0.5) continue;
    const bx = startX + i * barW;
    ctx.fillRect(bx, centerY - barH, barW - 1, barH);
    ctx.fillRect(bx, centerY, barW - 1, barH);
  }
}

/** Draw the slice of the music waveform from [sourceStart, sourceStart + duration]. */
function drawCardWaveform(
  ctx: CanvasRenderingContext2D,
  waveform: WaveformData,
  card: MusicCard,
  x: number,
  w: number,
  y: number,
  h: number,
  color1: string,
  color2: string,
): void {
  const samples = waveform.samples;
  const fullDur = waveform.duration || 1;
  if (samples.length === 0 || card.duration <= 0) return;

  // Map [sourceStart, sourceStart+duration] → sample indices
  const startIdx = Math.max(0, Math.floor((card.sourceStart / fullDur) * samples.length));
  const endIdx = Math.min(samples.length, Math.ceil(((card.sourceStart + card.duration) / fullDur) * samples.length));
  const sliceLen = Math.max(1, endIdx - startIdx);

  const maxBarH = (h - 8) / 2;
  const centerY = y + h / 2;
  const barW = w / sliceLen;
  const gradient = ctx.createLinearGradient(0, centerY + maxBarH, 0, centerY - maxBarH);
  gradient.addColorStop(0, color1);
  gradient.addColorStop(1, color2);
  ctx.fillStyle = gradient;

  for (let i = 0; i < sliceLen; i++) {
    const sample = samples[startIdx + i];
    const barH = sample * maxBarH;
    if (barH < 0.5) continue;
    const bx = x + i * barW;
    ctx.fillRect(bx, centerY - barH, barW - 1, barH);
    ctx.fillRect(bx, centerY, barW - 1, barH);
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDbLabel(db: number): string {
  if (db <= ENV_MIN_DB) return '-\u221E dB';
  const sign = db >= 0 ? '+' : '';
  return `${sign}${db.toFixed(1)} dB`;
}
