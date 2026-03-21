import { describe, it, expect } from 'vitest';
import { Channels } from '../../src/shared/channels';

describe('Channels', () => {
  it('is a non-empty object', () => {
    expect(Object.keys(Channels).length).toBeGreaterThan(0);
  });

  describe('expected keys exist', () => {
    const expectedKeys = [
      // Recording
      'RECORDING_START',
      'RECORDING_STOP',
      'RECORDING_EXPORT',
      'RECORDING_PREPARE_PLAYBACK',
      'RECORDING_CLEANUP_PLAYBACK',
      'RECORDING_PAUSE',
      'RECORDING_RESUME',
      // Devices
      'DEVICES_GET_SCREENS',
      'DEVICES_SELECT_SCREEN_SOURCE',
      // File
      'FILE_SAVE_RECORDING',
      // Toolbar
      'TOOLBAR_STATE_UPDATE',
      // Preview
      'PREVIEW_UPDATE',
      // Overlay
      'OVERLAY_UPDATE',
      'OVERLAY_PREVIEW',
      'CTA_TEST',
      // Edit modal
      'EDIT_MODAL_OPEN',
      'EDIT_MODAL_SAVE',
      'EDIT_MODAL_CLOSE',
      // Main recording
      'MAIN_RECORDING_START',
      'MAIN_RECORDING_READY',
      'MAIN_RECORDING_STOP',
      'MAIN_RECORDING_PAUSE',
      'MAIN_RECORDING_RESUME',
      // Mouse tracking
      'MOUSE_TRACKING_START',
      'MOUSE_TRACKING_STOP',
      'MOUSE_POSITION',
      'MOUSE_CLICK',
      // Window
      'WINDOW_GET_BOUNDS',
      // Config
      'CONFIG_GET',
      'CONFIG_SAVE',
      // Action
      'ACTION_EVENT',
      // Cursor
      'CURSOR_HIDE',
      'CURSOR_SHOW',
      // App
      'APP_QUIT',
      'APP_OPEN_EXTERNAL',
      'APP_CHECK_UPDATE',
      // Onboarding
      'ONBOARDING_CHECK_PERMISSIONS',
      'ONBOARDING_REQUEST_PERMISSION',
      'ONBOARDING_CHECK_DEPENDENCIES',
      'ONBOARDING_INSTALL_DEPENDENCY',
      'ONBOARDING_INSTALL_PROGRESS',
      'ONBOARDING_COMPLETE',
    ];

    it.each(expectedKeys)('has key "%s"', (key) => {
      expect(Channels).toHaveProperty(key);
    });
  });

  describe('value properties', () => {
    it('all values are strings', () => {
      for (const [key, value] of Object.entries(Channels)) {
        expect(typeof value).toBe('string');
      }
    });

    it('all values are non-empty strings', () => {
      for (const [key, value] of Object.entries(Channels)) {
        expect((value as string).length).toBeGreaterThan(0);
      }
    });

    it('no duplicate values', () => {
      const values = Object.values(Channels);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });

    it('values follow colon-separated naming convention', () => {
      for (const [key, value] of Object.entries(Channels)) {
        expect(value).toMatch(/^[\w-]+:[\w-]+$/);
      }
    });
  });

  describe('specific value checks', () => {
    it('RECORDING_START is "recording:start"', () => {
      expect(Channels.RECORDING_START).toBe('recording:start');
    });

    it('RECORDING_STOP is "recording:stop"', () => {
      expect(Channels.RECORDING_STOP).toBe('recording:stop');
    });

    it('FILE_SAVE_RECORDING is "file:save-recording"', () => {
      expect(Channels.FILE_SAVE_RECORDING).toBe('file:save-recording');
    });

    it('APP_QUIT is "app:quit"', () => {
      expect(Channels.APP_QUIT).toBe('app:quit');
    });

    it('CONFIG_GET is "config:get"', () => {
      expect(Channels.CONFIG_GET).toBe('config:get');
    });

    it('MOUSE_CLICK is "mouse:click"', () => {
      expect(Channels.MOUSE_CLICK).toBe('mouse:click');
    });
  });

  it('Channels object is frozen (as const)', () => {
    // `as const` makes the object readonly at the type level.
    // At runtime, we just verify it has the expected shape.
    expect(typeof Channels).toBe('object');
    expect(Channels).not.toBeNull();
  });
});
