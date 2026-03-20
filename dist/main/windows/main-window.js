"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMainWindow = getMainWindow;
exports.createMainWindow = createMainWindow;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
let mainWindow = null;
function getMainWindow() {
    return mainWindow;
}
function createMainWindow(options) {
    const shouldShow = options?.show ?? true;
    const iconPath = path_1.default.join(__dirname, '..', '..', 'assets', 'icon_1024x1024.png');
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 720,
        minWidth: 854,
        minHeight: 480,
        show: shouldShow,
        icon: electron_1.nativeImage.createFromPath(iconPath),
        webPreferences: {
            preload: path_1.default.join(__dirname, '..', '..', 'preload', 'main-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    // Lock window to 16:9 — matches our 3840×2160 recording canvas exactly
    mainWindow.setAspectRatio(16 / 9);
    mainWindow.loadFile(path_1.default.join(__dirname, '..', '..', '..', 'index.html'));
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
//# sourceMappingURL=main-window.js.map