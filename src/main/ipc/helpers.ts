import { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { getMainWindow } from '../windows/main-window';
import { getToolbarWindow } from '../windows/toolbar-window';
import { getEditModalWindow } from '../windows/edit-modal-window';
import { getOnboardingWindow } from '../windows/onboarding-window';
import { getThumbnailWindow } from '../windows/thumbnail-window';
import { Channels } from '../../shared/channels';
import { RecordingState } from '../../shared/types';

/**
 * Validate that an IPC event originates from one of our known windows.
 * Rejects messages from unknown or compromised webContents.
 */
export function isValidSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const validWebContents = [
    getMainWindow()?.webContents,
    getToolbarWindow()?.webContents,
    getEditModalWindow()?.webContents,
    getOnboardingWindow()?.webContents,
    getThumbnailWindow()?.webContents,
  ].filter(Boolean);
  return validWebContents.some((wc) => wc === event.sender);
}


export function sendStateToToolbar(state: RecordingState): void {
  const toolbar = getToolbarWindow();
  if (toolbar && !toolbar.isDestroyed()) {
    toolbar.webContents.send(Channels.TOOLBAR_STATE_UPDATE, state);
  }
}
