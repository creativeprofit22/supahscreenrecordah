"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const main_window_1 = require("./windows/main-window");
const toolbar_window_1 = require("./windows/toolbar-window");
const onboarding_window_1 = require("./windows/onboarding-window");
const ipc_handlers_1 = require("./ipc-handlers");
const store_1 = require("./store");
const activation_1 = require("./services/activation");
const channels_1 = require("../shared/channels");
/** Source ID selected by the renderer for the next getDisplayMedia call. */
let pendingScreenSourceId = null;
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
});
electron_1.app
    .whenReady()
    .then(async () => {
    // Set dock icon (visible in dev mode; packaged builds use the embedded .icns)
    if (process.platform === 'darwin' && electron_1.app.dock) {
        const iconPath = path_1.default.join(__dirname, '..', '..', 'assets', 'icon_1024x1024.png');
        const icon = electron_1.nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) {
            electron_1.app.dock.setIcon(icon);
        }
    }
    (0, store_1.loadConfig)();
    (0, ipc_handlers_1.registerIpcHandlers)();
    (0, ipc_handlers_1.registerActivationHandlers)();
    // Set up permission request handler to allow media permissions
    electron_1.session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        if (permission === 'media') {
            callback(true);
        }
        else {
            callback(false);
        }
    });
    // Allow synchronous permission checks (needed for enumerateDevices)
    electron_1.session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
        if (permission === 'media') {
            return true;
        }
        return false;
    });
    // IPC: renderer tells main which source to capture before calling getDisplayMedia
    electron_1.ipcMain.handle(channels_1.Channels.DEVICES_SELECT_SCREEN_SOURCE, (_event, sourceId) => {
        pendingScreenSourceId = sourceId;
    });
    // Set up display media request handler for screen capture.
    // The renderer calls selectScreenSource(id) then getDisplayMedia().
    // This handler finds the matching source and passes it to Chromium.
    electron_1.session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
        try {
            const sources = await electron_1.desktopCapturer.getSources({ types: ['screen', 'window'] });
            const target = (pendingScreenSourceId
                ? sources.find((s) => s.id === pendingScreenSourceId)
                : undefined) ?? sources[0];
            pendingScreenSourceId = null;
            if (target) {
                callback({ video: target, audio: 'loopback' });
            }
            else {
                console.error('No screen sources available');
                callback({});
            }
        }
        catch (error) {
            console.error('Failed to get display media sources:', error);
            callback({});
        }
    }, 
    // Disable macOS 15+ system picker — this app has its own source picker
    // in the toolbar, so we always handle source selection via the callback.
    { useSystemPicker: false });
    // Gate app behind activation (re-validates with server every launch)
    const activated = await (0, activation_1.isActivated)();
    if (activated) {
        (0, main_window_1.createMainWindow)();
        (0, toolbar_window_1.createToolbarWindow)();
    }
    else {
        (0, onboarding_window_1.createOnboardingWindow)();
    }
    electron_1.app.on('activate', () => {
        const mainWin = (0, main_window_1.getMainWindow)();
        if (mainWin) {
            // Window exists but may be minimized — restore and focus it
            if (mainWin.isMinimized()) {
                mainWin.restore();
            }
            mainWin.show();
            mainWin.focus();
        }
        else {
            // Main window was closed or never created — recreate it
            (0, activation_1.isActivated)()
                .then((valid) => {
                if (valid) {
                    (0, main_window_1.createMainWindow)({ show: false });
                    (0, ipc_handlers_1.resendStateToMainWindow)();
                    if (!(0, toolbar_window_1.getToolbarWindow)()) {
                        (0, toolbar_window_1.createToolbarWindow)();
                    }
                }
                else if (electron_1.BrowserWindow.getAllWindows().length === 0) {
                    (0, onboarding_window_1.createOnboardingWindow)();
                }
            })
                .catch(() => {
                if (electron_1.BrowserWindow.getAllWindows().length === 0) {
                    (0, onboarding_window_1.createOnboardingWindow)();
                }
            });
        }
    });
})
    .catch((error) => {
    console.error('Failed to initialize app:', error);
    electron_1.app.quit();
});
electron_1.app.on('will-quit', () => {
    (0, ipc_handlers_1.stopUiohook)();
});
electron_1.app.on('before-quit', () => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const cursor = require('../../native/macos-cursor');
        cursor.setSystemCursorHidden(false);
    }
    catch {
        // Native addon not available — no-op
    }
    // Clean up any orphaned supahscreenrecordah temp files (playback, export, raw)
    try {
        const tmpDir = os_1.default.tmpdir();
        const entries = fs_1.default.readdirSync(tmpDir);
        for (const entry of entries) {
            if (entry.startsWith('supahscreenrecordah-') && entry.endsWith('.mp4')) {
                try {
                    fs_1.default.unlinkSync(path_1.default.join(tmpDir, entry));
                }
                catch {
                    // ignore — file may be in use or already deleted
                }
            }
        }
    }
    catch {
        // ignore tmpdir read failure
    }
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
//# sourceMappingURL=index.js.map