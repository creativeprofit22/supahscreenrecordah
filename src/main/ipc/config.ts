import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import { getConfig, saveConfig } from '../store';
import { isValidSender } from './helpers';

export function registerConfigHandlers(): void {
  ipcMain.handle(Channels.CONFIG_GET, (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    return getConfig();
  });

  ipcMain.on(Channels.CONFIG_SAVE, (event, partial) => {
    if (!isValidSender(event)) {
      return;
    }
    void saveConfig(partial);
  });
}
