import { ipcMain, app } from 'electron';
import fs from 'fs';
import { Channels } from '../../shared/channels';
import { isValidSavePath } from '../../shared/paths';
import { postProcessRecording } from '../services/ffmpeg';
import { isValidSender } from './helpers';

// Allowed directories for saving recordings
const ALLOWED_SAVE_DIRS = [
  app.getPath('home'),
  app.getPath('desktop'),
  app.getPath('documents'),
];

export function registerFileHandlers(): void {
  ipcMain.handle(
    Channels.FILE_SAVE_RECORDING,
    async (event, { filePath, buffer }: { filePath: string; buffer: ArrayBuffer }) => {
      if (!isValidSender(event)) {
        throw new Error('Unauthorized IPC sender');
      }
      // Validate the file path to prevent directory traversal attacks
      if (!isValidSavePath(filePath, ALLOWED_SAVE_DIRS)) {
        throw new Error(`Invalid save path: ${filePath}`);
      }
      try {
        await fs.promises.writeFile(filePath, Buffer.from(buffer));
        // Post-process: remux fMP4 → standard MP4, enhance voice audio
        await postProcessRecording(filePath);
      } catch (err) {
        console.error('Failed to save recording:', err);
        throw err;
      }
    },
  );
}
