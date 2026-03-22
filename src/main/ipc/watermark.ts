import { ipcMain, dialog } from 'electron';
import { Channels } from '../../shared/channels';
import { getEditModalWindow } from '../windows/edit-modal-window';
import { isValidSender } from './helpers';

export function registerWatermarkHandlers(): void {
  ipcMain.handle(Channels.WATERMARK_SELECT_FILE, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }

    const parent = getEditModalWindow();
    const result = await dialog.showOpenDialog(parent && !parent.isDestroyed() ? parent : undefined as never, {
      title: 'Select Watermark Image',
      filters: [
        { name: 'Images', extensions: ['png', 'svg', 'jpg', 'jpeg', 'webp'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });
}
