import { uIOhook } from 'uiohook-napi';
import { screen, systemPreferences, dialog } from 'electron';
import { Channels } from '../../shared/channels';
import { SHORTCUT_LABELS } from '../../shared/shortcuts';
import { getMainWindow } from '../windows/main-window';
import {
  KEYCODE_TO_CHAR,
  KEYCODE_TO_NAME,
  MODIFIER_KEYCODES,
  buildShortcutLabel,
  getTypeBuffer,
  appendToTypeBuffer,
  clearTypeBuffer,
  resetFlushTimer,
  clearFlushTimer,
  flushTypeBuffer,
} from './keyboard';
import { createMouseHandlers } from './mouse';
import { refreshActiveWindow, getCachedActiveWindow } from './active-window';

let isUiohookStarted = false;
let mouseTrackingInterval: ReturnType<typeof setInterval> | null = null;

// Native macOS cursor module (optional, loaded at runtime)
let macosCursor: { setSystemCursorHidden: (hidden: boolean) => boolean } | null = null;
if (process.platform === 'darwin') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    macosCursor = require('../../../native/macos-cursor');
  } catch {
    // Not available — cursor hiding will be a no-op
  }
}

/** Send an action event to the renderer */
function emitAction(event: { type: string; label: string; detail: string; timestamp: number }): void {
  const main = getMainWindow();
  if (main && !main.isDestroyed()) {
    main.webContents.send(Channels.ACTION_EVENT, event);
  }
}

/** Flush helper bound to emitAction + getCachedActiveWindow */
function doFlushTypeBuffer(): void {
  flushTypeBuffer(emitAction, getCachedActiveWindow);
}

// ── Global mouse click detection via uiohook-napi ──────────────
export function setupMouseClickDetection(): void {
  if (isUiohookStarted) {
    return;
  }
  // Check for accessibility permissions on macOS
  if (process.platform === 'darwin') {
    const isTrusted = systemPreferences.isTrustedAccessibilityClient(true);
    if (!isTrusted) {
      console.log('Accessibility permission not granted. Click-to-zoom disabled.');
      void dialog.showMessageBox({
        type: 'warning',
        title: 'Accessibility Permission Required',
        message:
          'supahscreenrecordah needs accessibility permissions to detect mouse clicks for click-to-zoom.',
        detail:
          'Please grant permission in System Settings > Privacy & Security > Accessibility, then restart the app.',
        buttons: ['OK'],
      });
      return;
    }
  }

  // ── Mouse handlers ────────────────────────────────────────────
  const mouseHandlers = createMouseHandlers(
    emitAction,
    getMainWindow,
    Channels,
    doFlushTypeBuffer,
    refreshActiveWindow,
    getCachedActiveWindow,
  );

  uIOhook.on('mousedown', mouseHandlers.mousedown);
  uIOhook.on('mouseup', mouseHandlers.mouseup);

  // ── Keyboard tracking ──────────────────────────────────────────
  uIOhook.on('keydown', (e) => {
    // Skip modifier-only presses
    if (MODIFIER_KEYCODES.has(e.keycode)) {
      return;
    }
    refreshActiveWindow();
    const hasModifier = e.metaKey || e.ctrlKey || e.altKey;
    if (hasModifier) {
      // Shortcut detected — flush typing buffer first
      doFlushTypeBuffer();
      const shortcutLabel = buildShortcutLabel(e);
      if (!shortcutLabel) {
        return;
      }
      const description = SHORTCUT_LABELS[shortcutLabel] ?? '';
      emitAction({
        type: 'shortcut',
        label: shortcutLabel,
        detail: description || getCachedActiveWindow(),
        timestamp: Date.now(),
      });
    } else {
      // Regular typing — accumulate into buffer
      const ch = KEYCODE_TO_CHAR[e.keycode];
      if (ch) {
        const actualChar = e.shiftKey ? ch.toUpperCase() : ch;
        appendToTypeBuffer(actualChar);
        // Reset flush timer
        resetFlushTimer(doFlushTypeBuffer);
      } else if (KEYCODE_TO_NAME[e.keycode]) {
        // Named key pressed without modifier (Enter, Tab, etc.)
        // Flush typing buffer with this key appended
        if (getTypeBuffer().length > 0) {
          doFlushTypeBuffer();
        }
      }
    }
  });

  // ── Scroll tracking ────────────────────────────────────────────
  uIOhook.on('wheel', mouseHandlers.wheel);

  try {
    uIOhook.start();
    isUiohookStarted = true;
  } catch (error) {
    console.error('Failed to start uIOhook:', error);
  }
}

/** Stop the global uIOhook listener and clean up mouse tracking. */
export function stopUiohook(): void {
  clearFlushTimer();
  clearTypeBuffer();
  if (mouseTrackingInterval) {
    clearInterval(mouseTrackingInterval);
    mouseTrackingInterval = null;
  }
  // Always restore the system cursor when tracking stops
  macosCursor?.setSystemCursorHidden(false);
  if (isUiohookStarted) {
    try {
      uIOhook.stop();
    } catch (error) {
      console.error('Failed to stop uIOhook:', error);
    }
    uIOhook.removeAllListeners();
    isUiohookStarted = false;
  }
}

/** Start mouse position tracking at ~60fps */
export function startMouseTracking(): void {
  if (mouseTrackingInterval) {
    clearInterval(mouseTrackingInterval);
  }
  mouseTrackingInterval = setInterval(() => {
    const point = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(point);
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send(Channels.MOUSE_POSITION, {
        x: point.x,
        y: point.y,
        cursorType: 'arrow',
        displayBounds: currentDisplay.bounds,
        scaleFactor: currentDisplay.scaleFactor,
      });
    }
  }, 16); // ~60fps tracking
  // Start global click detection if not already running
  setupMouseClickDetection();
}

/** Stop mouse position tracking */
export function stopMouseTracking(): void {
  if (mouseTrackingInterval) {
    clearInterval(mouseTrackingInterval);
    mouseTrackingInterval = null;
  }
}

/** Hide the system cursor (macOS only) */
export function hideSystemCursor(): boolean {
  return macosCursor?.setSystemCursorHidden(true) ?? false;
}

/** Show the system cursor (macOS only) */
export function showSystemCursor(): boolean {
  return macosCursor?.setSystemCursorHidden(false) ?? false;
}
