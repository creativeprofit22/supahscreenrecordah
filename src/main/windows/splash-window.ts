import { BrowserWindow, screen, nativeImage } from 'electron';
import path from 'path';

let splashWindow: BrowserWindow | null = null;

export function getSplashWindow(): BrowserWindow | null {
  return splashWindow;
}

export function createSplashWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay();
  const { x: waX, y: waY, width: waWidth, height: waHeight } = display.workArea;

  const windowWidth = 420;
  const windowHeight = 320;

  const iconPath = path.join(__dirname, '..', '..', 'assets',
    process.platform === 'win32' ? 'icon.ico' : 'icon_1024x1024.png');

  splashWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round(waX + (waWidth - windowWidth) / 2),
    y: Math.round(waY + (waHeight - windowHeight) / 2),
    frame: false,
    resizable: false,
    transparent: true,
    hasShadow: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'splash-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  splashWindow.loadURL('app://./pages/splash.html');

  // Gracefully handle renderer crash
  splashWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Splash renderer crashed: ${details.reason}`);
    closeSplashWindow();
  });

  splashWindow.on('closed', () => {
    splashWindow = null;
  });

  return splashWindow;
}

/** Signal the splash to fade out, then close after the animation. */
export function dismissSplash(): void {
  if (!splashWindow || splashWindow.isDestroyed()) return;

  splashWindow.webContents.send('splash:ready');

  // Close after fade-out animation completes (400ms CSS + buffer)
  setTimeout(() => {
    closeSplashWindow();
  }, 500);
}

export function closeSplashWindow(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}
