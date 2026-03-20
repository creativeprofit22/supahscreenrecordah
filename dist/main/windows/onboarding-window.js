"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOnboardingWindow = getOnboardingWindow;
exports.createOnboardingWindow = createOnboardingWindow;
exports.closeOnboardingWindow = closeOnboardingWindow;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
let onboardingWindow = null;
function getOnboardingWindow() {
    return onboardingWindow;
}
function createOnboardingWindow() {
    const display = electron_1.screen.getPrimaryDisplay();
    const { x: waX, y: waY, width: waWidth, height: waHeight } = display.workArea;
    const windowWidth = 500;
    const windowHeight = 520;
    onboardingWindow = new electron_1.BrowserWindow({
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
            preload: path_1.default.join(__dirname, '..', '..', 'preload', 'onboarding-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    onboardingWindow.loadFile(path_1.default.join(__dirname, '..', '..', '..', 'onboarding.html'));
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
function closeOnboardingWindow() {
    if (onboardingWindow && !onboardingWindow.isDestroyed()) {
        onboardingWindow.close();
        onboardingWindow = null;
    }
}
//# sourceMappingURL=onboarding-window.js.map