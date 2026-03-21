import type { BrowserWindow } from 'electron';

interface ActionEvent {
  type: string;
  label: string;
  detail: string;
  timestamp: number;
}

interface MouseHandlers {
  mousedown: (e: { button: number; x: number; y: number }) => void;
  mouseup: (e: { button: number; x: number; y: number }) => void;
  wheel: (e: { rotation: number }) => void;
}

/**
 * Create mouse event handlers for uiohook mousedown/mouseup/wheel events.
 *
 * @param emitAction  — sends an action event to the renderer
 * @param getMainWindow — returns the main BrowserWindow (or null)
 * @param Channels — the IPC channel constants
 * @param flushTypeBuffer — flushes the typing buffer before emitting click actions
 * @param refreshActiveWindow — refreshes the cached active window name
 * @param getCachedActiveWindow — returns the cached active window name
 */
export function createMouseHandlers(
  emitAction: (event: ActionEvent) => void,
  getMainWindow: () => BrowserWindow | null,
  Channels: { MOUSE_CLICK: string },
  flushTypeBuffer: () => void,
  refreshActiveWindow: () => void,
  getCachedActiveWindow: () => string,
): MouseHandlers {
  // ── Scroll tracking ────────────────────────────────────────────
  let lastScrollActionTime = 0;
  const SCROLL_THROTTLE_MS = 800;

  return {
    mousedown(e) {
      // Only trigger on left click (button 1)
      if (e.button === 1) {
        const main = getMainWindow();
        if (main && !main.isDestroyed()) {
          main.webContents.send(Channels.MOUSE_CLICK, { type: 'down', x: e.x, y: e.y });
        }
        // Emit click action — flush any pending typing first
        flushTypeBuffer();
        refreshActiveWindow();
        emitAction({
          type: 'click',
          label: getCachedActiveWindow() || 'screen',
          detail: getCachedActiveWindow(),
          timestamp: Date.now(),
        });
      }
    },

    mouseup(e) {
      if (e.button === 1) {
        const main = getMainWindow();
        if (main && !main.isDestroyed()) {
          main.webContents.send(Channels.MOUSE_CLICK, { type: 'up', x: e.x, y: e.y });
        }
      }
    },

    wheel(e) {
      const now = Date.now();
      if (now - lastScrollActionTime < SCROLL_THROTTLE_MS) {
        return;
      }
      lastScrollActionTime = now;
      refreshActiveWindow();
      const direction = e.rotation > 0 ? 'down' : 'up';
      emitAction({
        type: 'scroll',
        label: direction,
        detail: getCachedActiveWindow(),
        timestamp: Date.now(),
      });
    },
  };
}
