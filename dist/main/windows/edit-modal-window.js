"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEditModalWindow = getEditModalWindow;
exports.createEditModalWindow = createEditModalWindow;
exports.closeEditModalWindow = closeEditModalWindow;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
let editModalWindow = null;
function getEditModalWindow() {
    return editModalWindow;
}
function createEditModalWindow() {
    const { width: screenWidth, height: screenHeight } = electron_1.screen.getPrimaryDisplay().workAreaSize;
    const windowWidth = 1110;
    const windowHeight = 540;
    editModalWindow = new electron_1.BrowserWindow({
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
            preload: path_1.default.join(__dirname, '..', '..', 'preload', 'edit-modal-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    editModalWindow.loadFile(path_1.default.join(__dirname, '..', '..', '..', 'edit-modal.html'));
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
function closeEditModalWindow() {
    if (editModalWindow && !editModalWindow.isDestroyed()) {
        editModalWindow.close();
        editModalWindow = null;
    }
}
//# sourceMappingURL=edit-modal-window.js.map