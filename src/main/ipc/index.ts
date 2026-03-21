import { Channels } from '../../shared/channels';
import { getMainWindow } from '../windows/main-window';
import { getConfig } from '../store';
import { registerDeviceHandlers } from './devices';
import { registerRecordingHandlers } from './recording';
import { registerPlaybackHandlers } from './playback';
import { registerFileHandlers } from './file';
import { registerOverlayHandlers, getLastPreviewSelection } from './overlay';
import { registerMouseHandlers } from './mouse';
import { registerConfigHandlers } from './config';
import { registerAppControlHandlers } from './app-control';
import { registerOnboardingHandlers } from './onboarding';

export function registerAllHandlers(): void {
  registerDeviceHandlers();
  registerRecordingHandlers();
  registerPlaybackHandlers();
  registerFileHandlers();
  registerOverlayHandlers();
  registerMouseHandlers();
  registerConfigHandlers();
  registerAppControlHandlers();
  registerOnboardingHandlers();
}

// For main/index.ts backward compat:
export { registerAllHandlers as registerIpcHandlers };
export { stopUiohook } from '../input';

/** Resend cached preview + overlay state to a newly created main window.
 *  The window should be created with `show: false` — this function sends
 *  the state once the page loads, waits for streams to connect, then
 *  fades the window in smoothly. */
export function resendStateToMainWindow(): void {
  const main = getMainWindow();
  if (!main || main.isDestroyed()) {
    return;
  }
  main.webContents.once('did-finish-load', () => {
    // Inject CSS fade-in: start transparent, transition to opaque
    void main.webContents
      .insertCSS('body { opacity: 0; transition: opacity 0.3s ease-in-out; }')
      .then((cssKey) => {
        // Send cached state so streams start connecting
        const lastPreviewSelection = getLastPreviewSelection();
        if (lastPreviewSelection) {
          main.webContents.send(Channels.PREVIEW_UPDATE, lastPreviewSelection);
        }
        const config = getConfig();
        if (config.overlay) {
          main.webContents.send(Channels.OVERLAY_UPDATE, config.overlay);
        }
        // Give streams a moment to connect, then show + fade in
        setTimeout(() => {
          if (!main.isDestroyed()) {
            main.show();
            // Remove the injected opacity so the transition triggers
            void main.webContents.removeInsertedCSS(cssKey);
          }
        }, 600);
      });
  });
}
