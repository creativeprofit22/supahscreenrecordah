// Keyboard shortcut overlay — shows key combos as styled pills on the screen area
// ---------------------------------------------------------------------------
// Listens to ActionEvent from the action feed system, filters for keyboard
// shortcuts (modifier + key combos), and renders them as prominent pills.
// ---------------------------------------------------------------------------

import type { ActionEvent } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KeyboardShortcut {
  /** Raw label from action event, e.g. "Ctrl+Shift+S" */
  raw: string;
  /** Parsed key segments, e.g. ["⌃", "⇧", "S"] */
  keys: string[];
  /** Time the shortcut was shown */
  showTime: number;
  /** Current opacity (for fade animation) */
  opacity: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FADE_IN_MS = 100;
const HOLD_MS = 1500;
const FADE_OUT_MS = 300;
const TOTAL_LIFETIME_MS = FADE_IN_MS + HOLD_MS + FADE_OUT_MS;
const DEBOUNCE_MS = 200;

// Pill styling
const BG_COLOR = 'rgba(0, 0, 0, 0.75)';
const TEXT_COLOR = '#ffffff';
const SUB_PILL_BG = 'rgba(255, 255, 255, 0.15)';
const FONT_SIZE = 14;        // base px (scaled by canvas scale)
const SUB_PILL_PAD_H = 10;   // horizontal padding inside each key sub-pill
const SUB_PILL_PAD_V = 6;    // vertical padding inside each key sub-pill
const OUTER_PAD_H = 12;      // outer pill horizontal padding
const OUTER_PAD_V = 8;       // outer pill vertical padding
const PLUS_GAP = 6;          // gap around the "+" separator
const CORNER_RADIUS = 10;    // outer pill corner radius
const SUB_CORNER_RADIUS = 6; // sub-pill corner radius
const BOTTOM_OFFSET = 40;    // px from bottom of screen area (base, scaled)

// ---------------------------------------------------------------------------
// Modifier symbol mapping
// ---------------------------------------------------------------------------

const MODIFIER_SYMBOLS: Record<string, string> = {
  'Ctrl': '⌃',
  'Alt': '⌥',
  'Shift': '⇧',
  'Cmd': '⌘',
  '⌘': '⌘',
  '⌥': '⌥',
  '⇧': '⇧',
};

const MODIFIER_NAMES = new Set(['Ctrl', 'Alt', 'Shift', 'Cmd', '⌘', '⌥', '⇧']);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentShortcut: KeyboardShortcut | null = null;
let lastComboRaw = '';
let lastComboTime = 0;

// ---------------------------------------------------------------------------
// Public state accessors (for state.ts integration)
// ---------------------------------------------------------------------------

export function getCurrentShortcut(): KeyboardShortcut | null {
  return currentShortcut;
}

export function clearKeyboardOverlay(): void {
  currentShortcut = null;
  lastComboRaw = '';
  lastComboTime = 0;
}

// ---------------------------------------------------------------------------
// Detection — parse ActionEvent for keyboard shortcuts
// ---------------------------------------------------------------------------

/**
 * Parse a shortcut label like "Ctrl+Shift+S" or "⌘+C" into key segments.
 * Returns null if this is not a modifier combo (single key presses are ignored).
 */
function parseShortcutLabel(label: string): string[] | null {
  const parts = label.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    return null; // single key, not a combo
  }

  // Must have at least one modifier
  const hasModifier = parts.some((p) => MODIFIER_NAMES.has(p));
  if (!hasModifier) {
    return null;
  }

  // Convert to display symbols
  return parts.map((p) => {
    const symbol = MODIFIER_SYMBOLS[p];
    if (symbol) {
      return symbol;
    }
    // Title-case the key name
    if (p.length === 1) {
      return p.toUpperCase();
    }
    return p.charAt(0).toUpperCase() + p.slice(1);
  });
}

/**
 * Feed an ActionEvent into the keyboard overlay.
 * Only 'shortcut' type events with modifier combos are displayed.
 */
export function handleKeyboardOverlayEvent(event: ActionEvent): void {
  if (event.type !== 'shortcut') {
    return;
  }

  const keys = parseShortcutLabel(event.label);
  if (!keys) {
    return;
  }

  const now = performance.now();

  // Debounce rapid repeats of the same combo
  if (event.label === lastComboRaw && now - lastComboTime < DEBOUNCE_MS) {
    return;
  }

  lastComboRaw = event.label;
  lastComboTime = now;

  currentShortcut = {
    raw: event.label,
    keys,
    showTime: now,
    opacity: 1,
  };
}

// ---------------------------------------------------------------------------
// Canvas rendering
// ---------------------------------------------------------------------------

/**
 * Draw the keyboard shortcut overlay on the recording canvas.
 * Should be called AFTER screen content is drawn, within the screen clip area.
 *
 * @param ctx - Canvas rendering context
 * @param screenX - Left edge of screen area in canvas coords
 * @param screenY - Top edge of screen area in canvas coords
 * @param screenW - Width of screen area in canvas coords
 * @param screenH - Height of screen area in canvas coords
 * @param scale - Canvas scale factor
 */
export function drawKeyboardOverlayOnCanvas(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  screenW: number,
  screenH: number,
  scale: number,
): void {
  if (!currentShortcut) {
    return;
  }

  const now = performance.now();
  const elapsed = now - currentShortcut.showTime;

  // Expired — clear it
  if (elapsed >= TOTAL_LIFETIME_MS) {
    currentShortcut = null;
    return;
  }

  // Compute opacity: fade in → hold → fade out
  let opacity: number;
  if (elapsed < FADE_IN_MS) {
    opacity = elapsed / FADE_IN_MS;
  } else if (elapsed < FADE_IN_MS + HOLD_MS) {
    opacity = 1;
  } else {
    const fadeElapsed = elapsed - FADE_IN_MS - HOLD_MS;
    opacity = 1 - fadeElapsed / FADE_OUT_MS;
  }
  opacity = Math.max(0, Math.min(1, opacity));
  currentShortcut.opacity = opacity;

  const fontSize = FONT_SIZE * scale;
  const subPadH = SUB_PILL_PAD_H * scale;
  const subPadV = SUB_PILL_PAD_V * scale;
  const outerPadH = OUTER_PAD_H * scale;
  const outerPadV = OUTER_PAD_V * scale;
  const plusGap = PLUS_GAP * scale;
  const cornerR = CORNER_RADIUS * scale;
  const subCornerR = SUB_CORNER_RADIUS * scale;
  const bottomOff = BOTTOM_OFFSET * scale;

  const font = `600 ${fontSize}px -apple-system, "Segoe UI", system-ui, sans-serif`;
  const plusFont = `400 ${fontSize * 0.85}px -apple-system, "Segoe UI", system-ui, sans-serif`;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const keys = currentShortcut.keys;

  // Measure each sub-pill
  const subPills: Array<{ text: string; textW: number; pillW: number }> = [];
  for (const key of keys) {
    ctx.font = font;
    const textW = ctx.measureText(key).width;
    const pillW = textW + subPadH * 2;
    subPills.push({ text: key, textW, pillW });
  }

  // Measure "+" separators
  ctx.font = plusFont;
  const plusW = ctx.measureText('+').width;

  // Total outer pill width
  const subPillsTotal = subPills.reduce((sum, sp) => sum + sp.pillW, 0);
  const separatorsTotal = (keys.length - 1) * (plusGap + plusW + plusGap);
  const subPillH = fontSize + subPadV * 2;
  const outerW = outerPadH * 2 + subPillsTotal + separatorsTotal;
  const outerH = outerPadV * 2 + subPillH;

  // Position: bottom-center of screen area
  const pillX = screenX + (screenW - outerW) / 2;
  const pillY = screenY + screenH - outerH - bottomOff;

  ctx.save();
  ctx.globalAlpha = opacity;

  // Draw outer pill background
  ctx.fillStyle = BG_COLOR;
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, outerW, outerH, cornerR);
  ctx.fill();

  // Draw each sub-pill + "+" separators
  let curX = pillX + outerPadH;
  const subY = pillY + outerPadV;

  for (let i = 0; i < subPills.length; i++) {
    const sp = subPills[i]!;

    // Sub-pill background
    ctx.fillStyle = SUB_PILL_BG;
    ctx.beginPath();
    ctx.roundRect(curX, subY, sp.pillW, subPillH, subCornerR);
    ctx.fill();

    // Sub-pill text
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = font;
    ctx.fillText(sp.text, curX + sp.pillW / 2, subY + subPillH / 2);

    curX += sp.pillW;

    // Draw "+" separator (except after last key)
    if (i < subPills.length - 1) {
      curX += plusGap;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = plusFont;
      ctx.fillText('+', curX + plusW / 2, subY + subPillH / 2);
      curX += plusW + plusGap;
    }
  }

  ctx.restore();
}
