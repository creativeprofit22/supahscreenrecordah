import { shell, systemPreferences } from 'electron';
import type { PermissionStatus } from '../../shared/activation-types';

type PermissionValue = 'granted' | 'denied' | 'not-determined';

export async function requestMicrophonePermission(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true;
  }
  return systemPreferences.askForMediaAccess('microphone');
}

export async function requestCameraPermission(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true;
  }
  return systemPreferences.askForMediaAccess('camera');
}

export function checkPermissionStatus(): PermissionStatus {
  if (process.platform !== 'darwin') {
    return {
      camera: 'granted',
      microphone: 'granted',
      screenRecording: 'granted',
      accessibility: 'granted',
    };
  }

  const cameraRaw = systemPreferences.getMediaAccessStatus('camera');
  const micRaw = systemPreferences.getMediaAccessStatus('microphone');
  const screenRaw = systemPreferences.getMediaAccessStatus('screen');
  const accessibilityGranted = systemPreferences.isTrustedAccessibilityClient(false);

  return {
    camera: normalizeStatus(cameraRaw),
    microphone: normalizeStatus(micRaw),
    screenRecording: normalizeStatus(screenRaw),
    accessibility: accessibilityGranted ? 'granted' : 'denied',
  };
}

function normalizeStatus(raw: string): PermissionValue {
  if (raw === 'granted') {
    return 'granted';
  }
  if (raw === 'not-determined') {
    return 'not-determined';
  }
  return 'denied';
}

export async function requestScreenRecordingPermission(): Promise<boolean> {
  if (process.platform === 'darwin') {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
  }
  return false; // User must grant manually
}

export async function requestAccessibilityPermission(): Promise<boolean> {
  if (process.platform === 'darwin') {
    return systemPreferences.isTrustedAccessibilityClient(true);
  }
  return true;
}
