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

  // Prevent navigation away from the app
  onboardingWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Prevent new window creation
  onboardingWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

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
