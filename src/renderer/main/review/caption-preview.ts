// Caption Preview — renders word groups on a canvas overlay synced to playback
// Supports draggable position (X+Y), resizable via corner handles, and per-style rendering.
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

type CaptionAnimation = 'none' | 'word-highlight' | 'karaoke' | 'bounce' | 'pop';

interface StyleConfig {
  fontSize: number;       // multiplier over base
  font: string;           // font family
  bold: boolean;
  outlineWidth: number;
  shadowBlur: number;
  maxWords: number;
  fillColor: string;
  highlightColor: string; // color for active word
  powerWords: boolean;    // use power word colorization
  uppercase: boolean;
  animation: CaptionAnimation;
}

const STYLE_CONFIGS: Record<CaptionStylePreset, StyleConfig> = {
  clean: {
    fontSize: 1.0, font: 'Poppins, sans-serif',
    bold: false, outlineWidth: 2, shadowBlur: 0,
    maxWords: 4, fillColor: '#FFFFFF', highlightColor: '#FFFFFF',
    powerWords: false, uppercase: false, animation: 'none',
  },
  spotlight: {
    fontSize: 1.3, font: 'Montserrat, sans-serif',
    bold: true, outlineWidth: 5, shadowBlur: 4,
    maxWords: 4, fillColor: '#FFFFFF', highlightColor: '#FFFF00',
    powerWords: false, uppercase: true, animation: 'word-highlight',
  },
  electric: {
    fontSize: 1.3, font: 'Bangers, Impact, sans-serif',
    bold: false, outlineWidth: 6, shadowBlur: 6,
    maxWords: 3, fillColor: '#FFFFFF', highlightColor: '#39FF14',
    powerWords: true, uppercase: true, animation: 'pop',
  },
  knockout: {
    fontSize: 1.5, font: 'Luckiest Guy, Impact, sans-serif',
    bold: false, outlineWidth: 8, shadowBlur: 8,
    maxWords: 2, fillColor: '#FFFFFF', highlightColor: '#00BFFF',
    powerWords: true, uppercase: true, animation: 'bounce',
  },
  candy: {
    fontSize: 1.3, font: 'Bangers, Impact, sans-serif',
    bold: false, outlineWidth: 5, shadowBlur: 4,
    maxWords: 3, fillColor: '#FFFFFF', highlightColor: '#FF1493',
    powerWords: false, uppercase: true, animation: 'word-highlight',
  },
  flow: {
    fontSize: 1.1, font: 'Poppins, sans-serif',
    bold: true, outlineWidth: 3, shadowBlur: 2,
    maxWords: 3, fillColor: '#FFFFFF', highlightColor: '#FF6347',
    powerWords: false, uppercase: false, animation: 'karaoke',
  },
};

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------

/** Ease-out bounce (standard 4-stage formula) */
function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/** Compute per-word animation state */
function getWordAnimation(
  word: TranscribedWord,
  currentTime: number,
  animation: CaptionAnimation,
  groupStart: number,
): { scale: number; offsetY: number; opacity: number } {
  const isActive = currentTime >= word.start && currentTime < word.end;
  const elapsed = currentTime - word.start;

  switch (animation) {
    case 'bounce': {
      // Words bounce in when they become active
      if (currentTime < word.start) return { scale: 0, offsetY: 20, opacity: 0 };
      const dur = 0.3; // 300ms bounce-in
      const t = Math.min(elapsed / dur, 1);
      const bounced = easeOutBounce(t);
      return {
        scale: 0.5 + 0.5 * bounced,
        offsetY: 20 * (1 - bounced),
        opacity: t < 0.1 ? t / 0.1 : 1,
      };
    }
    case 'pop': {
      // Active word pops up (scale 1.2), others normal
      if (isActive) {
        const dur = 0.15;
        const t = Math.min(elapsed / dur, 1);
        return { scale: 1 + 0.2 * t, offsetY: -3 * t, opacity: 1 };
      }
      return { scale: 1, offsetY: 0, opacity: 1 };
    }
    case 'word-highlight':
    case 'karaoke':
    default:
      // Active word gets slight scale bump
      if (isActive) return { scale: 1.08, offsetY: -2, opacity: 1 };
      return { scale: 1, offsetY: 0, opacity: 1 };
  }
}

// ---------------------------------------------------------------------------
// Interactive caption state
// ---------------------------------------------------------------------------

/** Caption position as fractions of video render area (0–1) */
let captionXFraction = 0.50;
let captionYFraction = 0.50;

/** Scale multiplier for caption size (1.0 = default for style) */
let captionScale = 1.0;

/** Whether captions are currently active (style selected + words exist) */
let captionsActive = false;
/** Whether the caption is selected (clicked on) — shows bounding box + handles */
let isSelected = false;
let isDragging = false;
let isResizing = false;
let activeHandle: string | null = null; // 'tl', 'tr', 'bl', 'br'
let dragListenersAttached = false;
let cleanupDragListeners: (() => void) | null = null;

/** Last rendered caption bounding box in CSS pixels (not DPR-scaled), relative to canvas */
let lastBBox: { x: number; y: number; w: number; h: number } | null = null;

/** Distance from mouse to caption center at drag start (for smooth dragging) */
let dragOffsetX = 0;
let dragOffsetY = 0;

/** Scale at resize start + initial distance for proportional resizing */
let resizeStartScale = 1.0;
let resizeStartDist = 0;

const HANDLE_SIZE = 6;   // px (CSS) — half-width of corner handle squares
const HANDLE_PAD = 12;   // px — extra click tolerance around handles

/** Cached layout rect — updated once per mousedown, reused during drag/resize to avoid reflow */
let cachedCanvasRect: DOMRect | null = null;
let cachedVideoRect: { x: number; y: number; w: number; h: number } | null = null;
let currentCursor = '';

// ---------------------------------------------------------------------------
// Video rect helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

function isInRect(mx: number, my: number, rx: number, ry: number, rw: number, rh: number): boolean {
  return mx >= rx && mx <= rx + rw && my >= ry && my <= ry + rh;
}

function hitTest(mx: number, my: number): 'caption' | 'tl' | 'tr' | 'bl' | 'br' | null {
  if (!lastBBox) return null;
  const { x, y, w, h } = lastBBox;
  const hp = HANDLE_PAD;

  // Check corner handles first (they take priority)
  if (isInRect(mx, my, x - hp, y - hp, hp * 2, hp * 2)) return 'tl';
  if (isInRect(mx, my, x + w - hp, y - hp, hp * 2, hp * 2)) return 'tr';
  if (isInRect(mx, my, x - hp, y + h - hp, hp * 2, hp * 2)) return 'bl';
  if (isInRect(mx, my, x + w - hp, y + h - hp, hp * 2, hp * 2)) return 'br';

  // Check caption body (with some padding for easier targeting)
  const pad = 8;
  if (isInRect(mx, my, x - pad, y - pad, w + pad * 2, h + pad * 2)) return 'caption';

  return null;
}

function getCursorForHit(hit: ReturnType<typeof hitTest>): string {
  switch (hit) {
    case 'tl': case 'br': return 'nwse-resize';
    case 'tr': case 'bl': return 'nesw-resize';
    case 'caption': return 'move';
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Interaction listeners
// ---------------------------------------------------------------------------

function setupInteractionListeners(canvas: HTMLCanvasElement, video: HTMLVideoElement): void {
  if (dragListenersAttached) return;
  dragListenersAttached = true;

  const onMouseDown = (e: MouseEvent) => {
    if (!captionsActive) return;

    cachedCanvasRect = canvas.getBoundingClientRect();
    cachedVideoRect = getVideoRect(canvas, video);

    const mx = e.clientX - cachedCanvasRect.left;
    const my = e.clientY - cachedCanvasRect.top;

    const hit = lastBBox ? hitTest(mx, my) : null;

    // Click on corner handle → start resize
    if (hit === 'tl' || hit === 'tr' || hit === 'bl' || hit === 'br') {
      isResizing = true;
      isSelected = true;
      activeHandle = hit;
      resizeStartScale = captionScale;
      const cx = lastBBox!.x + lastBBox!.w / 2;
      const cy = lastBBox!.y + lastBBox!.h / 2;
      resizeStartDist = Math.hypot(mx - cx, my - cy);
      video.removeAttribute('controls');
      video.pause();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Click on caption body → select + start drag
    if (hit === 'caption') {
      isSelected = true;
      isDragging = true;
      const captionCssX = cachedVideoRect.x + cachedVideoRect.w * captionXFraction;
      const captionCssY = cachedVideoRect.y + cachedVideoRect.h * captionYFraction;
      dragOffsetX = mx - captionCssX;
      dragOffsetY = my - captionCssY;
      video.removeAttribute('controls');
      video.pause();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Click outside caption → deselect
    if (isSelected) {
      isSelected = false;
      video.setAttribute('controls', '');
      // Let the click fall through to the video
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!captionsActive) return;

    if (isDragging && cachedCanvasRect && cachedVideoRect) {
      const mx = e.clientX - cachedCanvasRect.left;
      const my = e.clientY - cachedCanvasRect.top;
      const newX = (mx - dragOffsetX - cachedVideoRect.x) / cachedVideoRect.w;
      const newY = (my - dragOffsetY - cachedVideoRect.y) / cachedVideoRect.h;
      captionXFraction = Math.max(0.05, Math.min(0.95, newX));
      captionYFraction = Math.max(0.05, Math.min(0.95, newY));
      e.preventDefault();
      return;
    }

    if (isResizing && lastBBox && cachedCanvasRect) {
      const mx = e.clientX - cachedCanvasRect.left;
      const my = e.clientY - cachedCanvasRect.top;
      const cx = lastBBox.x + lastBBox.w / 2;
      const cy = lastBBox.y + lastBBox.h / 2;
      const currentDist = Math.hypot(mx - cx, my - cy);
      if (resizeStartDist > 0) {
        const ratio = currentDist / resizeStartDist;
        captionScale = Math.max(0.3, Math.min(3.0, resizeStartScale * ratio));
      }
      e.preventDefault();
      return;
    }

    // Update cursor on hover — check caption/handles when visible
    if (lastBBox) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = hitTest(mx, my);
      const newCursor = getCursorForHit(hit);
      if (newCursor !== currentCursor) {
        currentCursor = newCursor;
        canvas.style.cursor = newCursor || '';
      }
      // Intercept pointer events when hovering caption/handles OR when selected
      canvas.style.pointerEvents = (hit || isSelected) ? 'auto' : 'none';
    }
  };

  const onMouseUp = () => {
    isDragging = false;
    isResizing = false;
    activeHandle = null;
    cachedCanvasRect = null;
    cachedVideoRect = null;
    // Don't restore controls here — stay selected until user clicks off
  };

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  cleanupDragListeners = () => {
    canvas.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    canvas.style.pointerEvents = 'none';
    canvas.style.cursor = '';
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

/** Get the current caption X fraction for export positioning. */
export function getCaptionXFraction(): number {
  return captionXFraction;
}

/** Get the current caption scale for export. */
export function getCaptionScale(): number {
  return captionScale;
}

/** Get the highlight color for the current style (for export). */
export function getCaptionHighlightColor(): string | null {
  if (!cachedStyle) return null;
  const sc = STYLE_CONFIGS[cachedStyle];
  if (!sc || sc.animation === 'none') return null;
  return sc.highlightColor;
}

/** Reset caption state (called when exiting review). */
export function resetCaptionPreview(): void {
  cachedGroups = [];
  cachedStyle = null;
  cachedWordsLen = 0;
  captionXFraction = 0.50;
  captionYFraction = 0.50;
  captionScale = 1.0;
  captionsActive = false;
  isSelected = false;
  isDragging = false;
  isResizing = false;
  activeHandle = null;
  lastBBox = null;
  cachedCanvasRect = null;
  cachedVideoRect = null;
  currentCursor = '';
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

  if (!style || words.length === 0) {
    captionsActive = false;
    lastBBox = null;
    return;
  }

  captionsActive = true;

  // Set up interaction listeners on first render with captions
  setupInteractionListeners(canvas, video);

  // Don't render captions during disabled (cut) segments
  for (const seg of segments) {
    if (!seg.enabled && currentTime >= seg.start && currentTime < seg.end) {
      lastBBox = null;
      return;
    }
  }

  const sc = STYLE_CONFIGS[style] || STYLE_CONFIGS.spotlight;

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

  if (!activeGroup) {
    lastBBox = null;
    return;
  }

  // Compute video render area within canvas (object-fit: contain)
  const vr = getVideoRect(canvas, video);
  const vrDpr = {
    x: vr.x * dpr,
    y: vr.y * dpr,
    w: vr.w * dpr,
    h: vr.h * dpr,
  };

  // Font size scales with video render height and user scale
  const baseFontSize = Math.round((vrDpr.h / 20) * sc.fontSize * captionScale);
  const fontWeight = sc.bold ? 'bold' : 'normal';
  ctx.font = `${fontWeight} ${baseFontSize}px ${sc.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const centerX = vrDpr.x + vrDpr.w * captionXFraction;
  const captionY = vrDpr.y + vrDpr.h * captionYFraction;

  const rawText = activeGroup.text;
  const displayText = sc.uppercase ? rawText.toUpperCase() : rawText;

  // Measure text to compute bounding box
  const metrics = ctx.measureText(displayText);
  const textW = metrics.width;
  const textH = baseFontSize * 1.3; // approximate line height

  // Store bounding box in CSS pixels (not DPR) for hit testing
  lastBBox = {
    x: (centerX - textW / 2) / dpr,
    y: (captionY - textH / 2) / dpr,
    w: textW / dpr,
    h: textH / dpr,
  };

  // Shadow
  if (sc.shadowBlur > 0) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = sc.shadowBlur * dpr;
    ctx.shadowOffsetX = 2 * dpr;
    ctx.shadowOffsetY = 2 * dpr;
  }

  // Always render word-by-word for highlight/animation support
  renderWordsAnimated(ctx, activeGroup, centerX, captionY, baseFontSize, sc, dpr, currentTime);

  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Draw selection UI (bounding box + corner handles) when caption is selected
  if (isSelected) {
    drawSelectionUI(ctx, centerX, captionY, textW, textH, dpr);
  }
}

// ---------------------------------------------------------------------------
// Selection UI (bounding box + corner handles)
// ---------------------------------------------------------------------------

function drawSelectionUI(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  textW: number,
  textH: number,
  dpr: number,
): void {
  const pad = 10 * dpr;
  const bx = cx - textW / 2 - pad;
  const by = cy - textH / 2 - pad;
  const bw = textW + pad * 2;
  const bh = textH + pad * 2;

  ctx.save();

  // Dashed bounding box
  ctx.strokeStyle = 'rgba(203, 166, 247, 0.7)';
  ctx.lineWidth = 1.5 * dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.strokeRect(bx, by, bw, bh);
  ctx.setLineDash([]);

  // Corner handles
  const hs = HANDLE_SIZE * dpr;
  const handleColor = 'rgba(203, 166, 247, 0.9)';
  const handleBorder = 'rgba(255, 255, 255, 0.9)';

  const corners = [
    { x: bx, y: by },             // top-left
    { x: bx + bw, y: by },        // top-right
    { x: bx, y: by + bh },        // bottom-left
    { x: bx + bw, y: by + bh },   // bottom-right
  ];

  for (const c of corners) {
    ctx.fillStyle = handleColor;
    ctx.fillRect(c.x - hs, c.y - hs, hs * 2, hs * 2);
    ctx.strokeStyle = handleBorder;
    ctx.lineWidth = 1 * dpr;
    ctx.strokeRect(c.x - hs, c.y - hs, hs * 2, hs * 2);
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Text rendering helpers
// ---------------------------------------------------------------------------

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

function renderWordsAnimated(
  ctx: CanvasRenderingContext2D,
  group: WordGroup,
  centerX: number,
  y: number,
  fontSize: number,
  sc: StyleConfig,
  dpr: number,
  currentTime: number,
): void {
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
    const isActive = currentTime >= word.start && currentTime < word.end;
    const isPast = currentTime >= word.end;

    // Determine fill color
    let fillColor: string;
    if (sc.powerWords) {
      const cleaned = cleanWord(word.text);
      const powerColor = POWER_WORDS[cleaned];
      fillColor = powerColor || (isActive ? sc.highlightColor : sc.fillColor);
    } else if (sc.animation !== 'none') {
      fillColor = isActive ? sc.highlightColor : sc.fillColor;
    } else {
      fillColor = sc.fillColor;
    }

    // Karaoke: past words get highlight color too (progressive fill)
    if (sc.animation === 'karaoke' && isPast) {
      fillColor = sc.highlightColor;
    }

    // Animation transform
    const anim = getWordAnimation(word, currentTime, sc.animation, group.start);

    if (anim.opacity <= 0) {
      x += wordWidths[i] + spaceWidth;
      continue;
    }

    const wordX = x + wordWidths[i] / 2;

    ctx.save();
    ctx.globalAlpha = anim.opacity;

    if (anim.scale !== 1 || anim.offsetY !== 0) {
      ctx.translate(wordX, y + anim.offsetY * dpr);
      ctx.scale(anim.scale, anim.scale);
      ctx.translate(-wordX, -(y + anim.offsetY * dpr));
    }

    // Outline
    ctx.lineWidth = outlineW;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.textAlign = 'center';
    ctx.strokeText(text, wordX, y + anim.offsetY * dpr);

    // Fill
    ctx.fillStyle = fillColor;
    ctx.fillText(text, wordX, y + anim.offsetY * dpr);

    ctx.restore();

    x += wordWidths[i] + spaceWidth;
  }
}
