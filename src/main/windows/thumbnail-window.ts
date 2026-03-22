import { BrowserWindow, screen } from 'electron';
import path from 'path';
import type { ThumbnailOpenPayload } from '../../shared/types';

let thumbnailWindow: BrowserWindow | null = null;
let pendingPayload: ThumbnailOpenPayload | null = null;

export function getThumbnailWindow(): BrowserWindow | null {
  return thumbnailWindow;
}

export function getThumbnailPayload(): ThumbnailOpenPayload | null {
  return pendingPayload;
}

export function createThumbnailWindow(payload: ThumbnailOpenPayload): BrowserWindow {
  // Close any existing thumbnail window
  closeThumbnailWindow();

  pendingPayload = payload;

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  const windowWidth = 1000;
  const windowHeight = 700;

  thumbnailWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round((screenWidth - windowWidth) / 2),
    y: Math.round((screenHeight - windowHeight) / 2),
    alwaysOnTop: true,
    frame: false,
    resizable: true,
    transparent: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'thumbnail-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  thumbnailWindow.loadURL('app://./pages/thumbnail.html');

  thumbnailWindow.setContentProtection(true);

  thumbnailWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Thumbnail renderer crashed: ${details.reason}`);
    if (details.reason !== 'clean-exit' && !thumbnailWindow?.isDestroyed()) {
      thumbnailWindow?.close();
    }
  });

  thumbnailWindow.on('closed', () => {
    thumbnailWindow = null;
    pendingPayload = null;
  });

  return thumbnailWindow;
}

export function closeThumbnailWindow(): void {
  if (thumbnailWindow && !thumbnailWindow.isDestroyed()) {
    thumbnailWindow.close();
    thumbnailWindow = null;
    pendingPayload = null;
  }
}
