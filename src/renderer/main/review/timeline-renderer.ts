// Timeline Canvas Renderer — waveform + segment overlays + playhead
// ---------------------------------------------------------------------------

import type { ReviewSegment, WaveformData } from '../../../shared/review-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimelineRenderState {
  waveform: WaveformData;
  segments: ReviewSegment[];
  playhead: number;   // seconds
  duration: number;   // seconds
  hoverSegmentId: string | null;
  hoverEdge: 'start' | 'end' | null;
  snapTime: number | null;
  trimIn: number;     // seconds — content before this is trimmed
  trimOut: number;    // seconds — content after this is trimmed
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
// Stripe pattern (cached)
// ---------------------------------------------------------------------------

let stripePattern: CanvasPattern | null = null;
let stripePatternCanvas: OffscreenCanvas | null = null;

function getStripePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (stripePattern) return stripePattern;

  const size = 8; // 4px spacing at 45deg ≈ 8px tile
  stripePatternCanvas = new OffscreenCanvas(size, size);
  const pCtx = stripePatternCanvas.getContext('2d')!;
  pCtx.strokeStyle = 'rgba(243, 139, 168, 0.5)';
  pCtx.lineWidth = 1;
  // Diagonal line across tile
  pCtx.beginPath();
  pCtx.moveTo(0, size);
  pCtx.lineTo(size, 0);
  pCtx.stroke();
  // Wrap-around for seamless tiling
  pCtx.beginPath();
  pCtx.moveTo(-size, size);
  pCtx.lineTo(size, -size);
  pCtx.stroke();
  pCtx.beginPath();
  pCtx.moveTo(0, size * 2);
  pCtx.lineTo(size * 2, 0);
  pCtx.stroke();

  stripePattern = ctx.createPattern(stripePatternCanvas, 'repeat');
  return stripePattern;
}

// ---------------------------------------------------------------------------
// Format time as MM:SS
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

export function renderTimeline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: TimelineRenderState,
): void {
  const { waveform, segments, playhead, duration, hoverSegmentId, hoverEdge, snapTime, trimIn, trimOut } = state;

  // 1. Background
  ctx.fillStyle = '#1e1e2e';
  ctx.fillRect(0, 0, width, height);

  // 2. Waveform bars (mirror above + below center)
  const samples = waveform.samples;
  if (samples.length > 0) {
    const barW = width / samples.length;
    const maxBarH = (height - 16) / 2; // half height for mirror
    const centerY = height / 2;

    const gradient = ctx.createLinearGradient(0, centerY + maxBarH, 0, centerY - maxBarH);
    gradient.addColorStop(0, '#89dceb');
    gradient.addColorStop(1, '#94e2d5');
    ctx.fillStyle = gradient;

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const barH = sample * maxBarH;
      const x = i * barW;

      if (barH < 0.5) continue; // skip silent samples

      // Top half (above center)
      ctx.fillRect(x, centerY - barH, barW - 1, barH);
      // Bottom half (below center, mirrored)
      ctx.fillRect(x, centerY, barW - 1, barH);
    }
  }

  // 3. Segment overlays (non-speech only)
  for (const seg of segments) {
    if (seg.type === 'speech') continue;

    const x = timeToX(seg.start, duration, width);
    const w = timeToX(seg.end, duration, width) - x;

    if (!seg.enabled) {
      // Disabled: red tint + diagonal stripes
      ctx.fillStyle = 'rgba(243, 139, 168, 0.3)';
      ctx.fillRect(x, 0, w, height);
      const pattern = getStripePattern(ctx);
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(x, 0, w, height);
      }
    } else if (seg.type === 'silence') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(x, 0, w, height);
    } else if (seg.type === 'filler') {
      ctx.fillStyle = 'rgba(249, 226, 175, 0.25)';
      ctx.fillRect(x, 0, w, height);
    }
  }

  // 3b. Hover highlight on segment body
  if (hoverSegmentId && !hoverEdge) {
    const hovSeg = segments.find(s => s.id === hoverSegmentId);
    if (hovSeg && hovSeg.type !== 'speech') {
      const hx = timeToX(hovSeg.start, duration, width);
      const hw = timeToX(hovSeg.end, duration, width) - hx;
      ctx.fillStyle = 'rgba(205, 214, 244, 0.12)';
      ctx.fillRect(hx, 0, hw, height);
    }
  }

  // 4. Trim handles at segment edges (only for enabled segments — disabled ones are solid blocks)
  for (const seg of segments) {
    if (seg.type === 'speech') continue;
    if (!seg.enabled) continue; // no handles on disabled segments — reduces visual noise

    const isHovered = seg.id === hoverSegmentId;

    // Start edge
    const sx = timeToX(seg.start, duration, width);
    const startHover = isHovered && hoverEdge === 'start';
    const startW = startHover ? 6 : 2;
    const startAlpha = startHover ? 1.0 : 0.35;
    ctx.fillStyle = `rgba(205, 214, 244, ${startAlpha})`;
    ctx.fillRect(sx - Math.floor(startW / 2), 0, startW, height);

    // End edge
    const ex = timeToX(seg.end, duration, width);
    const endHover = isHovered && hoverEdge === 'end';
    const endW = endHover ? 6 : 2;
    const endAlpha = endHover ? 1.0 : 0.35;
    ctx.fillStyle = `rgba(205, 214, 244, ${endAlpha})`;
    ctx.fillRect(ex - Math.floor(endW / 2), 0, endW, height);
  }

  // 4b. Snap indicator line
  if (snapTime !== null && duration > 0) {
    const snapX = timeToX(snapTime, duration, width);
    ctx.save();
    ctx.strokeStyle = '#89dceb'; // cyan
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(snapX, 0);
    ctx.lineTo(snapX, height);
    ctx.stroke();
    ctx.restore();
  }

  // 5. Playhead — 2px white vertical line + triangle at top
  if (duration > 0) {
    const px = timeToX(playhead, duration, width);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px - 1, 0, 2, height);

    // Triangle at top
    const triSize = 6;
    ctx.beginPath();
    ctx.moveTo(px - triSize, 0);
    ctx.lineTo(px + triSize, 0);
    ctx.lineTo(px, triSize);
    ctx.closePath();
    ctx.fill();
  }

  // 6. Trim overlays — shaded regions + draggable handles at edges
  if (duration > 0) {
    const HANDLE_W = 6;

    // Trim-in region (left side)
    const inX = timeToX(trimIn, duration, width);
    if (trimIn > 0) {
      // Shaded region over trimmed content
      ctx.fillStyle = 'rgba(243, 139, 168, 0.35)';
      ctx.fillRect(0, 0, inX, height);
    }
    // Handle bar — always visible (subtle when at edge, bold when adjusted)
    const inActive = trimIn > 0;
    ctx.fillStyle = inActive ? '#f38ba8' : 'rgba(243, 139, 168, 0.4)';
    ctx.fillRect(Math.max(0, inX - HANDLE_W / 2), 0, HANDLE_W, height);
    if (inActive) {
      ctx.fillStyle = 'rgba(30, 30, 46, 0.6)';
      const midY = height / 2;
      ctx.fillRect(inX - 1, midY - 8, 2, 6);
      ctx.fillRect(inX - 1, midY + 2, 2, 6);
    }

    // Trim-out region (right side)
    const outX = timeToX(trimOut, duration, width);
    if (trimOut < duration) {
      // Shaded region over trimmed content
      ctx.fillStyle = 'rgba(243, 139, 168, 0.35)';
      ctx.fillRect(outX, 0, width - outX, height);
    }
    // Handle bar — always visible
    const outActive = trimOut < duration;
    ctx.fillStyle = outActive ? '#f38ba8' : 'rgba(243, 139, 168, 0.4)';
    ctx.fillRect(Math.min(width - HANDLE_W, outX - HANDLE_W / 2), 0, HANDLE_W, height);
    if (outActive) {
      ctx.fillStyle = 'rgba(30, 30, 46, 0.6)';
      const midY = height / 2;
      ctx.fillRect(outX - 1, midY - 8, 2, 6);
      ctx.fillRect(outX - 1, midY + 2, 2, 6);
    }
  }

  // 7. Time label near playhead
  if (duration > 0) {
    const px = timeToX(playhead, duration, width);
    const label = formatTime(playhead);

    ctx.font = '11px monospace';
    ctx.textBaseline = 'bottom';
    const metrics = ctx.measureText(label);
    const labelW = metrics.width + 8;
    const labelH = 16;

    // Position label: prefer right of playhead, flip left if near edge
    let labelX = px + 6;
    if (labelX + labelW > width) {
      labelX = px - 6 - labelW;
    }
    const labelY = height - 4;

    ctx.fillStyle = 'rgba(30, 30, 46, 0.8)';
    ctx.fillRect(labelX, labelY - labelH, labelW, labelH);

    ctx.fillStyle = '#cdd6f4';
    ctx.textAlign = 'left';
    ctx.fillText(label, labelX + 4, labelY - 3);
  }
}
