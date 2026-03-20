"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getToolbarWindow = getToolbarWindow;
exports.createToolbarWindow = createToolbarWindow;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
let toolbarWindow = null;
function getToolbarWindow() {
    return toolbarWindow;
}
function createToolbarWindow() {
    const display = electron_1.screen.getPrimaryDisplay();
    const { x: waX, y: waY, width: waWidth, height: waHeight } = display.workArea;
    const windowWidth = 900;
    const windowHeight = 72;
    toolbarWindow = new electron_1.BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        x: Math.round(waX + (waWidth - windowWidth) / 2),
        y: waY + waHeight - windowHeight,
        alwaysOnTop: true,
        frame: false,
        resizable: false,
        transparent: true,
        hasShadow: false,
        backgroundColor: '#00000000',
        skipTaskbar: true,
        webPreferences: {
            preload: path_1.default.join(__dirname, '..', '..', 'preload', 'toolbar-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    toolbarWindow.loadFile(path_1.default.join(__dirname, '..', '..', '..', 'toolbar.html'));
    // Exclude toolbar from screen capture so it doesn't appear in recordings.
    // On macOS this sets sharingType = NSWindowSharingNone; on Windows it uses
    // WDA_EXCLUDEFROMCAPTURE. Electron's own desktopCapturer respects this.
    toolbarWindow.setContentProtection(true);
    // Log and close gracefully if the renderer crashes
    toolbarWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error(`Toolbar renderer crashed: ${details.reason}`);
        if (details.reason !== 'clean-exit' && !toolbarWindow?.isDestroyed()) {
            toolbarWindow?.close();
        }
    });
    // Prevent navigation away from the app
    toolbarWindow.webContents.on('will-navigate', (event) => {
        event.preventDefault();
    });
    // Prevent new window creation
    toolbarWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    toolbarWindow.on('closed', () => {
        toolbarWindow = null;
    });
    return toolbarWindow;
}
//# sourceMappingURL=toolbar-window.js.map