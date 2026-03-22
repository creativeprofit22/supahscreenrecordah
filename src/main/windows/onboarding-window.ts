import { BrowserWindow, screen } from 'electron';
import path from 'path';

let onboardingWindow: BrowserWindow | null = null;

export function getOnboardingWindow(): BrowserWindow | null {
  return onboardingWindow;
}

export function createOnboardingWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay();
  const { x: waX, y: waY, width: waWidth, height: waHeight } = display.workArea;

  const windowWidth = 500;
  const windowHeight = 520;

  onboardingWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round(waX + (waWidth - windowWidth) / 2),
    y: Math.round(waY + (waHeight - windowHeight) / 2),
    frame: false,
    resizable: false,
    transparent: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'onboarding-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  onboardingWindow.loadURL('app://./pages/onboarding.html');

  // Attempt recovery by reloading if the renderer crashes, with a delay
  // and retry limit to prevent infinite crash loops.
  let crashCount = 0;
  const MAX_CRASH_RELOADS = 3;
  const CRASH_RELOAD_DELAY_MS = 1000;

  onboardingWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Onboarding renderer crashed: ${details.reason}`);
    if (details.reason !== 'clean-exit') {
      crashCount++;
      if (crashCount <= MAX_CRASH_RELOADS) {
        console.warn(`Reloading onboarding window (attempt ${crashCount}/${MAX_CRASH_RELOADS})...`);
        setTimeout(() => {
          if (onboardingWindow && !onboardingWindow.isDestroyed()) {
            onboardingWindow.reload();
          }
        }, CRASH_RELOAD_DELAY_MS);
      } else {
        console.error(`Onboarding renderer crashed ${crashCount} times — giving up auto-reload.`);
      }
    }
  });

  onboardingWindow.on('closed', () => {
    onboardingWindow = null;
  });

  return onboardingWindow;
}

export function closeOnboardingWindow(): void {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.close();
    onboardingWindow = null;
  }
}
