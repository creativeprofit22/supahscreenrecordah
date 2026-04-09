// Caption Preview — renders word groups on a canvas overlay synced to playback
// Only shows captions for enabled (non-cut) segments.
// Supports draggable Y position and per-style rendering.
// ---------------------------------------------------------------------------

import type { TranscribedWord } from '../../../main/services/assemblyai/types';
import type { ReviewSegment } from '../../../shared/review-types';
import type { CaptionStylePreset } from '../../../shared/feature-types';

interface WordGroup {
  words: TranscribedWord[];
  start: number;
  end: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Power words (matches server-side list)
// ---------------------------------------------------------------------------

const POWER_WORDS: Record<string, string> = {
  horror: '#FF0000', terrifying: '#FF0000', scary: '#FF0000',
  creepy: '#FF0000', haunted: '#FF0000', nightmare: '#FF0000',
  death: '#FF0000', dead: '#FF0000', kill: '#FF0000',
  murder: '#FF0000', blood: '#FF0000', evil: '#FF0000',
  different: '#FFD700', unique: '#FFD700', special: '#FFD700',
  rare: '#FFD700', secret: '#FFD700', hidden: '#FFD700',
  exclusive: '#FFD700',
  win: '#00FF00', winning: '#00FF00', success: '#00FF00',
  amazing: '#00FF00', incredible: '#00FF00', insane: '#00FF00',
  perfect: '#00FF00', best: '#00FF00',
  saturated: '#FF8000', trending: '#FF8000', viral: '#FF8000',
  exploding: '#FF8000', massive: '#FF8000', huge: '#FF8000',
  money: '#FFD400', million: '#FFD400', billion: '#FFD400',
  rich: '#FFD400', wealth: '#FFD400', cash: '#FFD400', profit: '#FFD400',
  warning: '#FF6600', danger: '#FF6600', careful: '#FF6600',
  never: '#FF6600', stop: '#FF6600', "don't": '#FF6600',
  now: '#00FFFF', today: '#00FFFF', immediately: '#00FFFF',
  urgent: '#00FFFF', breaking: '#00FFFF', just: '#00FFFF',
};

// ---------------------------------------------------------------------------
// Word grouping
// ---------------------------------------------------------------------------

function groupWords(words: TranscribedWord[], maxWords: number): WordGroup[] {
  if (words.length === 0) return [];

  const groups: WordGroup[] = [];
  let current: TranscribedWord[] = [];

  for (const word of words) {
    current.push(word);
    let shouldBreak = current.length >= maxWords;
    const lastChar = word.text.slice(-1);
    if ('.!?,;:'.includes(lastChar)) shouldBreak = true;

    if (shouldBreak) {
      groups.push({
        words: [...current],
        start: current[0].start,
        end: current[current.length - 1].end,
        text: current.map(w => w.text).join(' '),
      });
      current = [];
    }
  }

  if (current.length > 0) {
    groups.push({
      words: [...current],
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map(w => w.text).join(' '),
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Style configs
// ---------------------------------------------------------------------------

interface StyleConfig {
  fontSize: number;       // multiplier over base
  bold: boolean;
  outlineWidth: number;
  shadowBlur: number;
  maxWords: number;
  fillColor: string;
  powerWords: boolean;    // use power word colorization
  uppercase: boolean;
}

const STYLE_CONFIGS: Record<CaptionStylePreset, StyleConfig> = {
  minimal: {
    fontSize: 1.0, bold: false, outlineWidth: 2, shadowBlur: 0,
    maxWords: 4, fillColor: '#FFFFFF', powerWords: false, uppercase: false,
  },
  bold: {
    fontSize: 1.3, bold: true, outlineWidth: 5, shadowBlur: 4,
    maxWords: 4, fillColor: '#FFFFFF', powerWords: false, uppercase: true,
  },
  viral: {
    fontSize: 1.3, bold: true, outlineWidth: 5, shadowBlur: 6,
    maxWords: 3, fillColor: '#FFFFFF', powerWords: true, uppercase: true,
  },
  mrbeast: {
    fontSize: 1.5, bold: true, outlineWidth: 8, shadowBlur: 8,
    maxWords: 2, fillColor: '#FFD700', powerWords: true, uppercase: true,
  },
  'youtube-shorts': {
    fontSize: 1.3, bold: true, outlineWidth: 5, shadowBlur: 4,
    maxWords: 3, fillColor: '#FFFFFF', powerWords: false, uppercase: true,
  },
  tiktok: {
    fontSize: 1.1, bold: true, outlineWidth: 3, shadowBlur: 2,
    maxWords: 3, fillColor: '#FFFFFF', powerWords: false, uppercase: false,
  },
};

// ---------------------------------------------------------------------------
// Draggable Y position state
// ---------------------------------------------------------------------------

/** Caption Y position as fraction of video height (0 = top, 1 = bottom) */
let captionYFraction = 0.50;
let isDragging = false;
let dragListenersAttached = false;
let cleanupDragListeners: (() => void) | null = null;

/** Get the actual video render rect inside the wrapper (accounting for object-fit: contain) */
function getVideoRect(canvas: HTMLCanvasElement, video: HTMLVideoElement): {
  x: number; y: number; w: number; h: number;
} {
  const rect = canvas.getBoundingClientRect();
  const cw = rect.width;
  const ch = rect.height;
  const vw = video.videoWidth || 1920;
  const vh = video.videoHeight || 1080;
  const videoAspect = vw / vh;
  const containerAspect = cw / ch;

  let renderW: number, renderH: number, renderX: number, renderY: number;
  if (videoAspect > containerAspect) {
    renderW = cw;
    renderH = cw / videoAspect;
    renderX = 0;
    renderY = (ch - renderH) / 2;
  } else {
    renderH = ch;
    renderW = ch * videoAspect;
    renderX = (cw - renderW) / 2;
    renderY = 0;
  }

  return { x: renderX, y: renderY, w: renderW, h: renderH };
}

/** Drag hitzone: only start drag if clicking within 40px of the caption Y line */
const DRAG_HIT_PX = 40;

function setupDragListeners(canvas: HTMLCanvasElement, video: HTMLVideoElement): void {
  if (dragListenersAttached) return;
  dragListenersAttached = true;

  // Listen on the wrapper (parent of both video and canvas) so we don't block video controls.
  // We intercept mousedown only near the caption line, let everything else pass through.
  const wrapper = canvas.parentElement!;

  const onMouseDown = (e: MouseEvent) => {
    const vr = getVideoRect(canvas, video);
    const rect = wrapper.getBoundingClientRect();
    const relY = e.clientY - rect.top - vr.y;
    const captionPx = captionYFraction * vr.h;

    // Only start drag if click is near the caption Y position
    if (Math.abs(relY - captionPx) < DRAG_HIT_PX && relY >= 0 && relY <= vr.h) {
      isDragging = true;
      captionYFraction = Math.max(0.1, Math.min(0.9, relY / vr.h));
      e.preventDefault(); // prevent video controls from activating
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    const vr = getVideoRect(canvas, video);
    const rect = wrapper.getBoundingClientRect();
    const relY = e.clientY - rect.top - vr.y;
    captionYFraction = Math.max(0.1, Math.min(0.9, relY / vr.h));
  };

  const onMouseUp = () => {
    isDragging = false;
  };

  wrapper.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  cleanupDragListeners = () => {
    wrapper.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cachedGroups: WordGroup[] = [];
let cachedStyle: CaptionStylePreset | null = null;
let cachedWordsLen = 0;

/** Get the current caption Y fraction for export positioning. */
export function getCaptionYFraction(): number {
  return captionYFraction;
}

/** Reset caption state (called when exiting review). */
export function resetCaptionPreview(): void {
  cachedGroups = [];
  cachedStyle = null;
  cachedWordsLen = 0;
  captionYFraction = 0.50;
  isDragging = false;
  if (cleanupDragListeners) {
    cleanupDragListeners();
    cleanupDragListeners = null;
  }
  dragListenersAttached = false;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function cleanWord(text: string): string {
  return text.toLowerCase().replace(/[^\w]/g, '');
}

/**
 * Render caption preview on the overlay canvas.
 * Called every frame from the review render loop.
 */
export function renderCaptionPreview(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  currentTime: number,
  words: TranscribedWord[],
  segments: ReviewSegment[],
  style: CaptionStylePreset | null,
): void {
  // Size canvas to match its container
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  ctx.clearRect(0, 0, w, h);

  if (!style || words.length === 0) return;

  // Set up drag listeners on first render with captions
  setupDragListeners(canvas, video);

  // Don't render captions during disabled (cut) segments
  for (const seg of segments) {
    if (!seg.enabled && currentTime >= seg.start && currentTime < seg.end) {
      return;
    }
  }

  const sc = STYLE_CONFIGS[style] || STYLE_CONFIGS.bold;

  // Rebuild groups if words or style changed
  if (style !== cachedStyle || words.length !== cachedWordsLen) {
    cachedGroups = groupWords(words, sc.maxWords);
    cachedStyle = style;
    cachedWordsLen = words.length;
  }

  // Find active group
  let activeGroup: WordGroup | null = null;
  for (const group of cachedGroups) {
    if (currentTime >= group.start && currentTime < group.end) {
      activeGroup = group;
      break;
    }
  }

  if (!activeGroup) return;

  // Compute video render area within canvas (object-fit: contain)
  const vr = getVideoRect(canvas, video);
  const vrDpr = {
    x: vr.x * dpr,
    y: vr.y * dpr,
    w: vr.w * dpr,
    h: vr.h * dpr,
  };

  // Font size scales with video render height
  const baseFontSize = Math.round((vrDpr.h / 20) * sc.fontSize);
  const fontWeight = sc.bold ? 'bold' : 'normal';
  ctx.font = `${fontWeight} ${baseFontSize}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const centerX = vrDpr.x + vrDpr.w / 2;
  const captionY = vrDpr.y + vrDpr.h * captionYFraction;

  // Shadow
  if (sc.shadowBlur > 0) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = sc.shadowBlur * dpr;
    ctx.shadowOffsetX = 2 * dpr;
    ctx.shadowOffsetY = 2 * dpr;
  }

  if (sc.powerWords) {
    // Per-word rendering with power word colorization
    renderWordsWithColors(ctx, activeGroup, centerX, captionY, baseFontSize, sc, dpr);
  } else {
    // Simple single-color text
    const text = sc.uppercase ? activeGroup.text.toUpperCase() : activeGroup.text;
    renderTextWithOutline(ctx, text, centerX, captionY, sc.fillColor, sc.outlineWidth * dpr * 0.6, dpr);
  }

  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Draw subtle drag hint line when hovering/dragging
  if (isDragging) {
    ctx.save();
    ctx.strokeStyle = 'rgba(203, 166, 247, 0.5)';
    ctx.lineWidth = 1 * dpr;
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(vrDpr.x + 20 * dpr, captionY);
    ctx.lineTo(vrDpr.x + vrDpr.w - 20 * dpr, captionY);
    ctx.stroke();
    ctx.restore();
  }
}

function renderTextWithOutline(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fillColor: string,
  outlineWidth: number,
  _dpr: number,
): void {
  ctx.lineWidth = outlineWidth;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeText(text, x, y);

  ctx.fillStyle = fillColor;
  ctx.fillText(text, x, y);
}

function renderWordsWithColors(
  ctx: CanvasRenderingContext2D,
  group: WordGroup,
  centerX: number,
  y: number,
  fontSize: number,
  sc: StyleConfig,
  dpr: number,
): void {
  // Measure total width to center the group
  const wordTexts = group.words.map(w =>
    sc.uppercase ? w.text.toUpperCase() : w.text,
  );
  const spaceWidth = ctx.measureText(' ').width;
  const wordWidths = wordTexts.map(t => ctx.measureText(t).width);
  const totalWidth = wordWidths.reduce((a, b) => a + b, 0) + spaceWidth * (wordTexts.length - 1);

  let x = centerX - totalWidth / 2;
  const outlineW = sc.outlineWidth * dpr * 0.6;

  for (let i = 0; i < group.words.length; i++) {
    const word = group.words[i];
    const text = wordTexts[i];
    const cleaned = cleanWord(word.text);
    const powerColor = POWER_WORDS[cleaned];
    const fillColor = powerColor || sc.fillColor;

    const wordX = x + wordWidths[i] / 2;

    // Outline
    ctx.lineWidth = outlineW;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.textAlign = 'center';
    ctx.strokeText(text, wordX, y);

    // Fill
    ctx.fillStyle = fillColor;
    ctx.fillText(text, wordX, y);

    x += wordWidths[i] + spaceWidth;
  }
}
