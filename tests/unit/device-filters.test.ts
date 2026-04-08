import { describe, it, expect } from 'vitest';
import { WINDOWS_PROCESS_BLOCKLIST, extractAppSuffix } from '../../src/main/services/device-filters';

describe('WINDOWS_PROCESS_BLOCKLIST', () => {
  it('blocks known system processes', () => {
    const blocked = [
      'searchhost', 'textinputhost', 'shellexperiencehost',
      'runtimebroker', 'dwm', 'widgets', 'conhost',
    ];
    for (const p of blocked) {
      expect(WINDOWS_PROCESS_BLOCKLIST.has(p)).toBe(true);
    }
  });

  it('blocks own app processes', () => {
    expect(WINDOWS_PROCESS_BLOCKLIST.has('supahscreenrecordah')).toBe(true);
    expect(WINDOWS_PROCESS_BLOCKLIST.has('electron')).toBe(true);
  });

  it('does not block user applications', () => {
    const allowed = ['chrome', 'firefox', 'code', 'spotify', 'slack', 'obs64'];
    for (const p of allowed) {
      expect(WINDOWS_PROCESS_BLOCKLIST.has(p)).toBe(false);
    }
  });
});

describe('extractAppSuffix', () => {
  it('extracts suffix from Chrome-style titles', () => {
    expect(extractAppSuffix('GitHub - Google Chrome')).toBe(' - Google Chrome');
  });

  it('extracts suffix from VS Code titles', () => {
    expect(extractAppSuffix('index.ts - myproject - Visual Studio Code'))
      .toBe(' - Visual Studio Code');
  });

  it('extracts last dash for nested dashes', () => {
    expect(extractAppSuffix('Tab A - Tab B - Chrome')).toBe(' - Chrome');
  });

  it('returns null for titles without dashes', () => {
    expect(extractAppSuffix('Discord')).toBeNull();
    expect(extractAppSuffix('Spotify')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractAppSuffix('')).toBeNull();
  });

  it('handles title that is just a separator', () => {
    expect(extractAppSuffix(' - ')).toBe(' - ');
  });
});
