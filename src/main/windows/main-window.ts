import { BrowserWindow, nativeImage } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createMainWindow(options?: { show?: boolean }): BrowserWindow {
  const shouldShow = options?.show ?? true;

  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon_1024x1024.png');

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

  // Attempt recovery by reloading if the renderer crashes
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Main renderer crashed: ${details.reason}`);
    if (details.reason !== 'clean-exit') {
      mainWindow?.reload();
    }
  });

  // Prevent navigation away from the app
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Prevent new window creation
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}
