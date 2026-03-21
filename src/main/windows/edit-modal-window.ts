import { BrowserWindow, screen } from 'electron';
import path from 'path';

let editModalWindow: BrowserWindow | null = null;

export function getEditModalWindow(): BrowserWindow | null {
  return editModalWindow;
}

export function createEditModalWindow(): BrowserWindow {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  const windowWidth = 1110;
  const windowHeight = 540;

  editModalWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round((screenWidth - windowWidth) / 2),
    y: Math.round((screenHeight - windowHeight) / 2),
    alwaysOnTop: true,
    frame: false,
    resizable: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'edit-modal-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  editModalWindow.loadURL('app://./pages/edit-modal.html');

  // Exclude edit modal from screen capture so it doesn't appear in recordings.
  editModalWindow.setContentProtection(true);

  // Log and close gracefully if the renderer crashes
  editModalWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Edit-modal renderer crashed: ${details.reason}`);
    if (details.reason !== 'clean-exit' && !editModalWindow?.isDestroyed()) {
      editModalWindow?.close();
    }
  });

  // Prevent navigation away from the app
  editModalWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Prevent new window creation
  editModalWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  editModalWindow.on('closed', () => {
    editModalWindow = null;
  });

  return editModalWindow;
}

export function closeEditModalWindow(): void {
  if (editModalWindow && !editModalWindow.isDestroyed()) {
    editModalWindow.close();
    editModalWindow = null;
  }
}
