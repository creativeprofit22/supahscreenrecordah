import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import { getMainWindow, createMainWindow } from '../windows/main-window';
import { createToolbarWindow } from '../windows/toolbar-window';
import {
  getOnboardingWindow,
  closeOnboardingWindow,
} from '../windows/onboarding-window';
import {
  checkPermissionStatus,
  requestCameraPermission,
  requestMicrophonePermission,
  requestScreenRecordingPermission,
  requestAccessibilityPermission,
} from '../services/permissions';
import { checkDependencies, installFfmpeg } from '../services/dependencies';
import { findWhisper, findWhisperModel, installWhisper, installWhisperModel } from '../services/whisper';
import { isValidSender } from './helpers';

export function registerOnboardingHandlers(): void {
  ipcMain.handle(Channels.ONBOARDING_CHECK_PERMISSIONS, (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    return checkPermissionStatus();
  });

  ipcMain.handle(Channels.ONBOARDING_REQUEST_PERMISSION, async (event, type: string) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    switch (type) {
      case 'camera':
        return requestCameraPermission();
      case 'microphone':
        return requestMicrophonePermission();
      case 'screenRecording':
        return requestScreenRecordingPermission();
      case 'accessibility':
        return requestAccessibilityPermission();
      default:
        return false;
    }
  });

  ipcMain.handle(Channels.ONBOARDING_CHECK_DEPENDENCIES, (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    return checkDependencies();
  });

  ipcMain.handle(Channels.ONBOARDING_INSTALL_DEPENDENCY, async (event, name: string) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    const sendProgress = (progress: import('../../shared/activation-types').InstallProgress) => {
      event.sender.send(Channels.ONBOARDING_INSTALL_PROGRESS, progress);
    };
    if (name === 'ffmpeg') {
      await installFfmpeg(sendProgress);
    } else if (name === 'whisper') {
      await installWhisper(sendProgress);
      await installWhisperModel(sendProgress);
    }
  });

  ipcMain.on(Channels.ONBOARDING_COMPLETE, (event) => {
    if (!isValidSender(event)) {
      return;
    }
    closeOnboardingWindow();
    createMainWindow();
    createToolbarWindow();
  });
}
