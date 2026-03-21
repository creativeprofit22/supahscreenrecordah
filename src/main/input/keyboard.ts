import { UiohookKey } from 'uiohook-napi';

// ── Action tracking — keyboard event detection ───────────────────

/** Map uiohook keycodes to readable character names */
export const KEYCODE_TO_CHAR: Record<number, string> = {};
export const KEYCODE_TO_NAME: Record<number, string> = {};

// Build keycode → character map from UiohookKey
const letterKeys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
for (const ch of letterKeys) {
  const code = (UiohookKey as Record<string, number>)[ch];
  KEYCODE_TO_CHAR[code] = ch.toLowerCase();
}

for (let d = 0; d <= 9; d++) {
  const code = (UiohookKey as Record<string, number>)[String(d)];
  KEYCODE_TO_CHAR[code] = String(d);
}

// Punctuation & symbol keys
const PUNCT_MAP: [string, string][] = [
  ['Space', ' '],
  ['Comma', ','],
  ['Period', '.'],
  ['Slash', '/'],
  ['Backslash', '\\'],
  ['Semicolon', ';'],
  ['Quote', "'"],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Minus', '-'],
  ['Equal', '='],
  ['Backquote', '`'],
];
for (const [key, ch] of PUNCT_MAP) {
  KEYCODE_TO_CHAR[(UiohookKey as Record<string, number>)[key]] = ch;
}

// Named keys (for shortcut labels)
const NAMED_KEY_MAP: [string, string][] = [
  ['Enter', 'Enter'],
  ['Tab', 'Tab'],
  ['Backspace', 'Backspace'],
  ['Delete', 'Delete'],
  ['Escape', 'Esc'],
  ['ArrowUp', 'Up'],
  ['ArrowDown', 'Down'],
  ['ArrowLeft', 'Left'],
  ['ArrowRight', 'Right'],
  ['Home', 'Home'],
  ['End', 'End'],
  ['PageUp', 'PageUp'],
  ['PageDown', 'PageDown'],
];
for (const [key, name] of NAMED_KEY_MAP) {
  KEYCODE_TO_NAME[(UiohookKey as Record<string, number>)[key]] = name;
}

// F-keys
for (let i = 1; i <= 12; i++) {
  const fKey = `F${i}`;
  KEYCODE_TO_NAME[(UiohookKey as Record<string, number>)[fKey]] = `F${i}`;
}

// Modifier keycodes for filtering
export const MODIFIER_KEYCODES = new Set<number>([
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight,
]);

/** Build a shortcut label like "⌘+C" from modifier flags + keycode */
export function buildShortcutLabel(e: {
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  keycode: number;
}): string {
  const parts: string[] = [];
  if (e.ctrlKey) {
    parts.push('Ctrl');
  }
  if (e.altKey) {
    parts.push('⌥');
  }
  if (e.metaKey) {
    parts.push('⌘');
  }
  if (e.shiftKey) {
    parts.push('⇧');
  }
  // Get key name
  const charName = KEYCODE_TO_CHAR[e.keycode];
  const namedKey = KEYCODE_TO_NAME[e.keycode];
  if (namedKey) {
    parts.push(namedKey);
  } else if (charName) {
    parts.push(charName.toUpperCase());
  } else {
    return '';
  }
  return parts.join('+');
}

// ── Typing buffer — accumulates keystrokes and flushes as a single "type" action ──

let typeBuffer = '';
let typeFlushTimer: ReturnType<typeof setTimeout> | null = null;
export const TYPE_FLUSH_DELAY_MS = 600;
const TYPE_MAX_DISPLAY = 50; // max chars to show in action label

export function getTypeBuffer(): string {
  return typeBuffer;
}

export function appendToTypeBuffer(ch: string): void {
  typeBuffer += ch;
}

export function clearTypeBuffer(): void {
  typeBuffer = '';
}

export function resetFlushTimer(flushFn: () => void): void {
  if (typeFlushTimer) {
    clearTimeout(typeFlushTimer);
  }
  typeFlushTimer = setTimeout(flushFn, TYPE_FLUSH_DELAY_MS);
}

export function clearFlushTimer(): void {
  if (typeFlushTimer) {
    clearTimeout(typeFlushTimer);
    typeFlushTimer = null;
  }
}

/** Flush the typing buffer as a single "type" action */
export function flushTypeBuffer(
  emitAction: (event: { type: string; label: string; detail: string; timestamp: number }) => void,
  getActiveWindow: () => string,
): void {
  if (typeBuffer.length === 0) {
    return;
  }
  const text = typeBuffer.length > TYPE_MAX_DISPLAY ? typeBuffer.slice(-TYPE_MAX_DISPLAY) : typeBuffer;
  typeBuffer = '';
  emitAction({
    type: 'type',
    label: text,
    detail: getActiveWindow(),
    timestamp: Date.now(),
  });
}
