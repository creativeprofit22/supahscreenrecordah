import { BrowserWindow, nativeImage } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createMainWindow(options?: { show?: boolean }): BrowserWindow {
  const shouldShow = options?.show ?? true;

  const iconPath = path.join(__dirname, '..', '..', 'assets',
    process.platform === 'win32' ? 'icon.ico' : 'icon_1024x1024.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 854,
    minHeight: 480,
    show: shouldShow,
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'main-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  // Lock window to 16:9 — matches our 3840×2160 recording canvas exactly
  mainWindow.setAspectRatio(16 / 9);

  mainWindow.loadURL('app://./pages/index.html');

  // Forward renderer console messages to main process stdout for debugging
  mainWindow.webContents.on('console-message', ({ message }) => {
    console.log(`[renderer] ${message}`);
  });

  // Attempt recovery by reloading if the renderer crashes, with a delay
  // and retry limit to prevent infinite crash loops.
  let crashCount = 0;
  const MAX_CRASH_RELOADS = 3;
  const CRASH_RELOAD_DELAY_MS = 1000;

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Main renderer crashed: ${details.reason}`);
    if (details.reason !== 'clean-exit') {
      crashCount++;
      if (crashCount <= MAX_CRASH_RELOADS) {
        console.warn(`Reloading main window (attempt ${crashCount}/${MAX_CRASH_RELOADS})...`);
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.reload();
          }
        }, CRASH_RELOAD_DELAY_MS);
      } else {
        console.error(`Main renderer crashed ${crashCount} times — giving up auto-reload.`);
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}
