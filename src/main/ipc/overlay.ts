import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import { PreviewSelection } from '../../shared/types';
import { getMainWindow } from '../windows/main-window';
import {
  getEditModalWindow,
  createEditModalWindow,
  closeEditModalWindow,
} from '../windows/edit-modal-window';
import { getConfig, saveConfig } from '../store';
import { isValidSender } from './helpers';

/** Last preview selection — cached so we can resend to a recreated main window. */
let lastPreviewSelection: PreviewSelection | null = null;

export function getLastPreviewSelection(): PreviewSelection | null {
  return lastPreviewSelection;
}

export function registerOverlayHandlers(): void {
  ipcMain.handle(Channels.EDIT_MODAL_OPEN, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    const existing = getEditModalWindow();
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return;
    }
    createEditModalWindow();
  });

  ipcMain.on(Channels.EDIT_MODAL_CLOSE, (event) => {
    if (!isValidSender(event)) {
      return;
    }
    // Revert preview to saved overlay settings
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send(Channels.OVERLAY_UPDATE, getConfig().overlay);
    }
    closeEditModalWindow();
  });

  ipcMain.on(Channels.OVERLAY_PREVIEW, (event, data) => {
    if (!isValidSender(event)) {
      return;
    }
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send(Channels.OVERLAY_UPDATE, data);
    }
  });

  ipcMain.on(Channels.CTA_TEST, (event) => {
    if (!isValidSender(event)) {
      return;
    }
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send(Channels.CTA_TEST);
    }
  });

  ipcMain.on(Channels.EDIT_MODAL_SAVE, (event, data) => {
    if (!isValidSender(event)) {
      return;
    }
    void saveConfig({ overlay: data });
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send(Channels.OVERLAY_UPDATE, data);
    }
    closeEditModalWindow();
  });

  // ── Preview forwarding (toolbar → main window) ────────────────
  ipcMain.on(Channels.PREVIEW_UPDATE, (event, selection) => {
    if (!isValidSender(event)) {
      return;
    }
    lastPreviewSelection = selection;
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send(Channels.PREVIEW_UPDATE, selection);
    }
  });

  // ── Blur mode toggle (toolbar → main window) ────────────────
  ipcMain.on(Channels.BLUR_MODE_TOGGLE, (event) => {
    if (!isValidSender(event)) {
      return;
    }
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send(Channels.BLUR_MODE_TOGGLE);
    }
  });

  // ── Aspect ratio update (toolbar → main window) ────────────────
  ipcMain.on(Channels.ASPECT_RATIO_UPDATE, (event, ratio: string) => {
    if (!isValidSender(event)) {
      return;
    }
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      // Resize the window to match the new aspect ratio so the preview
      // isn't pillarboxed inside a mismatched frame.
      const RATIO_CONFIGS: Record<string, { w: number; h: number; minW: number; minH: number }> = {
        '16:9': { w: 1280, h: 720, minW: 854, minH: 480 },
        '9:16': { w: 450, h: 800, minW: 360, minH: 640 },
        '1:1':  { w: 720, h: 720, minW: 480, minH: 480 },
        '4:5':  { w: 640, h: 800, minW: 480, minH: 600 },
      };
      const cfg = RATIO_CONFIGS[ratio];
      if (cfg) {
        const [rw, rh] = ratio.split(':').map(Number);
        // Clear the old minimum first — it may block the new size
        // (e.g. landscape minWidth 854 prevents shrinking to 450 for vertical)
        main.setMinimumSize(1, 1);
        main.setAspectRatio(rw / rh);
        main.setSize(cfg.w, cfg.h, true);
        main.setMinimumSize(cfg.minW, cfg.minH);
      }
      main.webContents.send(Channels.ASPECT_RATIO_UPDATE, ratio);
    }
  });
}
