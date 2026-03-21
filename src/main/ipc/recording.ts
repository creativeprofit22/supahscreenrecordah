import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import { RecordingState } from '../../shared/types';
import { getMainWindow } from '../windows/main-window';
import { stopUiohook } from '../input';
import { isValidSender, sendStateToToolbar } from './helpers';

let recordingState: RecordingState = { isRecording: false, isPaused: false };

export function getRecordingState(): RecordingState {
  return recordingState;
}

export function registerRecordingHandlers(): void {
  ipcMain.handle(Channels.RECORDING_START, async (event, options) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    recordingState = { isRecording: true, isPaused: false };
    sendStateToToolbar(recordingState);
    // Forward to main window so it can start canvas-based recording
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send(Channels.MAIN_RECORDING_START, options.micDeviceId);
      // Window is hidden when renderer signals MAIN_RECORDING_READY
      // (after getUserMedia has acquired the mic — hiding before that
      // causes Chromium to deliver a silent audio track)
    }
  });

  // Renderer signals that getUserMedia + MediaRecorder.start() succeeded.
  // Now it's safe to hide the window.
  ipcMain.on(Channels.MAIN_RECORDING_READY, (event) => {
    if (!isValidSender(event)) {
      return;
    }
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.hide();
    }
  });

  ipcMain.handle(Channels.RECORDING_STOP, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    recordingState = { isRecording: false, isPaused: false };
    sendStateToToolbar(recordingState);
    // Stop the global input hook now that recording has ended
    stopUiohook();
    // Forward stop to main window — it will enter playback mode
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send(Channels.MAIN_RECORDING_STOP);
      // Show the main window so the user can see the playback
      main.show();
    }
  });

  ipcMain.handle(Channels.RECORDING_PAUSE, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    recordingState = { ...recordingState, isPaused: true };
    sendStateToToolbar(recordingState);
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send(Channels.MAIN_RECORDING_PAUSE);
    }
  });

  ipcMain.handle(Channels.RECORDING_RESUME, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    recordingState = { ...recordingState, isPaused: false };
    sendStateToToolbar(recordingState);
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send(Channels.MAIN_RECORDING_RESUME);
    }
  });
}
