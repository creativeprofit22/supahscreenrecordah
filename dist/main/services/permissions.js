"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestMicrophonePermission = requestMicrophonePermission;
exports.requestCameraPermission = requestCameraPermission;
exports.checkPermissionStatus = checkPermissionStatus;
exports.requestScreenRecordingPermission = requestScreenRecordingPermission;
exports.requestAccessibilityPermission = requestAccessibilityPermission;
const electron_1 = require("electron");
async function requestMicrophonePermission() {
    if (process.platform !== 'darwin') {
        return true;
    }
    return electron_1.systemPreferences.askForMediaAccess('microphone');
}
async function requestCameraPermission() {
    if (process.platform !== 'darwin') {
        return true;
    }
    return electron_1.systemPreferences.askForMediaAccess('camera');
}
function checkPermissionStatus() {
    if (process.platform !== 'darwin') {
        return {
            camera: 'granted',
            microphone: 'granted',
            screenRecording: 'granted',
            accessibility: 'granted',
        };
    }
    const cameraRaw = electron_1.systemPreferences.getMediaAccessStatus('camera');
    const micRaw = electron_1.systemPreferences.getMediaAccessStatus('microphone');
    const screenRaw = electron_1.systemPreferences.getMediaAccessStatus('screen');
    const accessibilityGranted = electron_1.systemPreferences.isTrustedAccessibilityClient(false);
    return {
        camera: normalizeStatus(cameraRaw),
        microphone: normalizeStatus(micRaw),
        screenRecording: normalizeStatus(screenRaw),
        accessibility: accessibilityGranted ? 'granted' : 'denied',
    };
}
function normalizeStatus(raw) {
    if (raw === 'granted') {
        return 'granted';
    }
    if (raw === 'not-determined') {
        return 'not-determined';
    }
    return 'denied';
}
async function requestScreenRecordingPermission() {
    if (process.platform === 'darwin') {
        await electron_1.shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
    return false; // User must grant manually
}
async function requestAccessibilityPermission() {
    if (process.platform === 'darwin') {
        return electron_1.systemPreferences.isTrustedAccessibilityClient(true);
    }
    return true;
}
//# sourceMappingURL=permissions.js.map