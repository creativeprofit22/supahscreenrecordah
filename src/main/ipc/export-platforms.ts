import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import { getConfig, saveConfig } from '../store';
import { isValidSender } from './helpers';
import type { ExportPlatform } from '../../shared/feature-types';

export function registerExportPlatformsHandler(): void {
  ipcMain.handle(Channels.EXPORT_PLATFORMS, async (event, platforms?: ExportPlatform[]) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    // If platforms provided, save them; otherwise return current selection
    if (platforms !== undefined) {
      await saveConfig({ exportPlatforms: platforms });
      return platforms;
    }
    return getConfig().exportPlatforms ?? [];
  });
}
