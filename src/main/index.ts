import {
  app,
  session,
  ipcMain,
  desktopCapturer,
  nativeImage,
} from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createMainWindow, getMainWindow } from './windows/main-window';
import { createToolbarWindow, getToolbarWindow } from './windows/toolbar-window';
import {
  registerAllHandlers,
  stopUiohook,
  resendStateToMainWindow,
} from './ipc';
import { checkForRecoveryFiles } from './ipc/autosave';
import { isValidSender } from './ipc/helpers';
import { loadConfig } from './store';
import { Channels } from '../shared/channels';
import { registerAppScheme, registerAppProtocolHandler } from './services/protocol';
import { findMatchingSource } from './services/source-matching';
import { findWhisper, findWhisperModel, installWhisper, installWhisperModel } from './services/whisper';

/** Append debug lines to a log file next to the exe for easy inspection. */
function debugLog(line: string): void {
  try {
    const logPath = path.join(app.getPath('userData'), 'display-media-debug.log');
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // ignore
  }
}

/** Source ID selected by the renderer for the next getDisplayMedia call. */
let pendingScreenSourceId: string | null = null;
/** Source name for fallback matching when ID doesn't match (e.g. OS-supplemented windows). */
let pendingScreenSourceName: string | null = null;

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught exception:', error);
  // Give time for the error to be logged, then exit
  // Exit code 1 indicates abnormal termination
  app.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled rejection:', reason);
  // Give time for the error to be logged, then exit
  // Exit code 1 indicates abnormal termination
  app.exit(1);
});

// Register the custom 'app' scheme before the app is ready — required by Chromium.
registerAppScheme();

app
  .whenReady()
  .then(async () => {
    // Clear Chromium's disk cache so rebuilt CSS/JS is always picked up.
    await session.defaultSession.clearCache();

    // Install the app:// protocol handler for serving local files securely.
    registerAppProtocolHandler();

    // Set dock icon (visible in dev mode; packaged builds use the embedded .icns)
    if (process.platform === 'darwin' && app.dock) {
      const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon_1024x1024.png');
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon);
      }
    }

    loadConfig();
    registerAllHandlers();

    // Set up permission request handler to allow media permissions
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, permission, callback) => {
        if (permission === 'media') {
          callback(true);
        } else {
          callback(false);
        }
      },
    );

    // Allow synchronous permission checks (needed for enumerateDevices)
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
      if (permission === 'media') {
        return true;
      }
      return false;
    });

    // IPC: renderer tells main which source to capture before calling getDisplayMedia
    ipcMain.handle(
      Channels.DEVICES_SELECT_SCREEN_SOURCE,
      (event: Electron.IpcMainInvokeEvent, sourceId: string, sourceName?: string) => {
        if (!isValidSender(event)) {
          throw new Error('Unauthorized IPC sender');
        }
        pendingScreenSourceId = sourceId;
        pendingScreenSourceName = sourceName ?? null;
      },
    );

    // Set up display media request handler for screen capture.
    // The renderer calls selectScreenSource(id) then getDisplayMedia().
    // This handler finds the matching source and passes it to Chromium.
    session.defaultSession.setDisplayMediaRequestHandler(
      async (_request, callback) => {
        try {
          const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
          });

          debugLog(`Looking for id="${pendingScreenSourceId}" name="${pendingScreenSourceName}"`);
          debugLog(`Available sources: ${sources.map((s) => `${s.id} "${s.name}"`).join(', ')}`);

          const match = findMatchingSource(sources, pendingScreenSourceId, pendingScreenSourceName);

          debugLog(`Matched via ${match?.method}: ${match?.source.id} "${match?.source.name}"`);

          pendingScreenSourceId = null;
          pendingScreenSourceName = null;

          if (match) {
            callback({ video: match.source as Electron.DesktopCapturerSource, audio: 'loopback' });
          } else {
            console.error('No screen sources available');
            callback({});
          }
        } catch (error) {
          console.error('Failed to get display media sources:', error);
          callback({});
        }
      },
      // Disable macOS 15+ system picker — this app has its own source picker
      // in the toolbar, so we always handle source selection via the callback.
      { useSystemPicker: false },
    );

    createMainWindow();
    createToolbarWindow();

    // Check for crash recovery files from a previous session
    void checkForRecoveryFiles();

    // Silently install whisper binary + model in the background if not present
    void (async () => {
      try {
        const noop = () => {};
        if (!(await findWhisper())) {
          console.log('[startup] Installing whisper binary...');
          await installWhisper(noop);
          console.log('[startup] Whisper binary installed');
        }
        if (!(await findWhisperModel())) {
          console.log('[startup] Downloading whisper model...');
          await installWhisperModel(noop);
          console.log('[startup] Whisper model installed');
        }
      } catch (err) {
        console.warn('[startup] Whisper background install failed:', err);
      }
    })();

    app.on('activate', () => {
      const mainWin = getMainWindow();
      if (mainWin) {
        // Window exists but may be minimized — restore and focus it
        if (mainWin.isMinimized()) {
          mainWin.restore();
        }
        mainWin.show();
        mainWin.focus();
      } else {
        // Main window was closed or never created — recreate it
        createMainWindow({ show: false });
        resendStateToMainWindow();
        if (!getToolbarWindow()) {
          createToolbarWindow();
        }
      }
    });
  })
  .catch((error: unknown) => {
    console.error('Failed to initialize app:', error);
    app.quit();
  });

app.on('will-quit', () => {
  stopUiohook();
});

app.on('before-quit', () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cursor = require('../../native/macos-cursor') as {
      setSystemCursorHidden: (hidden: boolean) => void;
    };
    cursor.setSystemCursorHidden(false);
  } catch {
    // Native addon not available — no-op
  }

  // Clean up any orphaned supahscreenrecordah temp files (playback, export, raw)
  try {
    const tmpDir = os.tmpdir();
    const entries = fs.readdirSync(tmpDir);
    for (const entry of entries) {
      if (entry.startsWith('supahscreenrecordah-') && entry.endsWith('.mp4')) {
        try {
          fs.unlinkSync(path.join(tmpDir, entry));
        } catch {
          // ignore — file may be in use or already deleted
        }
      }
    }
  } catch {
    // ignore tmpdir read failure
  }
});

// Apply security restrictions globally to ALL webContents (current and future).
// This is safer than per-window handlers because it covers dynamically created
// webContents automatically — no window can bypass these restrictions.
app.on('web-contents-created', (_event, contents) => {
  // Prevent navigation away from the app
  contents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Prevent new window creation
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Block <webview> tag attachment (defense-in-depth — webviewTag defaults to
  // false in modern Electron, but explicitly blocking it prevents any bypass)
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
