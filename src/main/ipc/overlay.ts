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
}
