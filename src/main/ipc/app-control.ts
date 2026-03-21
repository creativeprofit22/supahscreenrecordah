import { ipcMain, app, shell, net } from 'electron';
import { Channels } from '../../shared/channels';
import { isValidSender } from './helpers';

export function registerAppControlHandlers(): void {
  ipcMain.on(Channels.APP_QUIT, (event) => {
    if (!isValidSender(event)) {
      return;
    }
    app.quit();
  });

  ipcMain.handle(Channels.APP_OPEN_EXTERNAL, async (event, url: string) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    if (typeof url === 'string' && url.startsWith('https://')) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle(Channels.APP_CHECK_UPDATE, async (event) => {
    if (!isValidSender(event)) {
      throw new Error('Unauthorized IPC sender');
    }
    try {
      const currentVersion = app.getVersion();
      const response = await net.fetch(
        'https://api.github.com/repos/creativeprofit22/supahscreenrecordah/releases/latest',
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': `supahscreenrecordah/${currentVersion}`,
          },
        },
      );
      if (!response.ok) {
        return { available: false, version: '', url: '' };
      }
      const data = (await response.json()) as { tag_name: string; html_url: string };
      const latestVersion = data.tag_name.replace(/^v/, '');
      const available =
        latestVersion.localeCompare(currentVersion, undefined, { numeric: true }) > 0;
      return { available, version: latestVersion, url: data.html_url };
    } catch (err) {
      console.warn('[update] Failed to check for updates:', err);
      return { available: false, version: '', url: '' };
    }
  });
}
