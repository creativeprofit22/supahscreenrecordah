import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { Channels } from '../../shared/channels';
import { getMainWindow } from '../windows/main-window';
import {
  startMouseTracking,
  stopMouseTracking,
  hideSystemCursor,
  showSystemCursor,
} from '../input';
import { isValidSender } from './helpers';

export function registerMouseHandlers(): void {
  ipcMain.handle(Channels.MOUSE_TRACKING_START, (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    startMouseTracking();
    return true;
  });

  ipcMain.handle(Channels.MOUSE_TRACKING_STOP, (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    stopMouseTracking();
    return true;
  });

  // ── Cursor hide/show (native macOS) ─────────────────────────────
  ipcMain.handle(Channels.CURSOR_HIDE, (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    return hideSystemCursor();
  });

  ipcMain.handle(Channels.CURSOR_SHOW, (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    return showSystemCursor();
  });

  // ── Window bounds (macOS native) ────────────────────────────────
  ipcMain.handle(Channels.WINDOW_GET_BOUNDS, async (event, sourceId: string) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    if (process.platform !== 'darwin') {
      return null;
    }
    // Extract CGWindowID from source ID (format: "window:12345:0")
    const match = /^window:(\d+)/.exec(sourceId);
    if (!match) {
      return null;
    }
    const cgWindowId = match[1];
    // Use swift to query CGWindowListCopyWindowInfo for the window bounds
    const swiftCode = `
import CoreGraphics
import Foundation

let targetId = ${cgWindowId}
let windowList = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as! [[String: Any]]
for window in windowList {
    if let wid = window["kCGWindowNumber"] as? Int, wid == targetId {
        if let bounds = window["kCGWindowBounds"] as? [String: Any],
           let x = bounds["X"] as? Double,
           let y = bounds["Y"] as? Double,
           let w = bounds["Width"] as? Double,
           let h = bounds["Height"] as? Double {
            print("\\(x),\\(y),\\(w),\\(h)")
            exit(0)
        }
    }
}
exit(1)
`;
    return new Promise((resolve) => {
      execFile('swift', ['-e', swiftCode], { timeout: 3000 }, (error, stdout) => {
        if (error) {
          console.warn('Failed to get window bounds:', error.message);
          resolve(null);
          return;
        }
        const parts = stdout.trim().split(',').map(Number);
        const [x, y, width, height] = parts;
        if (
          parts.length === 4 &&
          x !== undefined &&
          y !== undefined &&
          width !== undefined &&
          height !== undefined &&
          parts.every((n) => !isNaN(n))
        ) {
          resolve({ x, y, width, height });
        } else {
          resolve(null);
        }
      });
    });
  });
}
