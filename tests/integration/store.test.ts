import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const testDir = path.join(os.tmpdir(), `supahscreenrecordah-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

vi.mock('electron', () => ({
  app: {
    getPath: () => testDir,
  },
}));

// Dynamic import so the mock is in place before the module resolves
let loadConfig: typeof import('../../src/main/store')['loadConfig'];
let saveConfig: typeof import('../../src/main/store')['saveConfig'];
let getConfig: typeof import('../../src/main/store')['getConfig'];

const CONFIG_FILE = path.join(testDir, 'config.json');

const DEFAULT_OVERLAY = {
  name: '',
  nameFont: 'Roboto',
  nameFontSize: 25,
  bgColor: '#6b8cce',
  bgStyle: 'solid',
  cinemaFilter: 'none',
  cameraEnhancement: {
    brightness: 105,
    contrast: 110,
    saturation: 115,
    warmth: 5,
    sharpness: 0,
    softness: 0,
  },
  socials: { x: '', youtube: '', tiktok: '', instagram: '' },
  ambientParticles: false,
  mouseZoom: 1.5,
  zoomLingerMs: 2500,
  ctaText: '',
  ctaIcon: '',
  ctaIntervalMs: 180000,
};

const DEFAULT_CONFIG = {
  screenName: '',
  cameraLabel: '',
  micLabel: '',
  layout: 'camera-right',
  overlay: DEFAULT_OVERLAY,
};

describe('Config Store Integration', () => {
  beforeEach(async () => {
    // Ensure test directory exists and is clean
    fs.mkdirSync(testDir, { recursive: true });
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }

    // Re-import the module fresh so module-level state resets
    vi.resetModules();
    const store = await import('../../src/main/store');
    loadConfig = store.loadConfig;
    saveConfig = store.saveConfig;
    getConfig = store.getConfig;
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  });

  it('loadConfig() returns defaults when no file exists', () => {
    const config = loadConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('saveConfig() writes to disk, loadConfig() reads it back', async () => {
    await saveConfig({ screenName: 'My Screen', cameraLabel: 'Webcam' });

    // Verify file was actually written
    expect(fs.existsSync(CONFIG_FILE)).toBe(true);

    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.screenName).toBe('My Screen');
    expect(parsed.cameraLabel).toBe('Webcam');

    // Re-import to reset in-memory state, then load
    vi.resetModules();
    const store2 = await import('../../src/main/store');
    const loaded = store2.loadConfig();
    expect(loaded.screenName).toBe('My Screen');
    expect(loaded.cameraLabel).toBe('Webcam');
    // Non-updated fields keep defaults
    expect(loaded.micLabel).toBe('');
    expect(loaded.layout).toBe('camera-right');
  });

  it('saveConfig() merges partial updates correctly', async () => {
    await saveConfig({ screenName: 'Screen1' });
    await saveConfig({ cameraLabel: 'Cam1' });

    const config = getConfig();
    expect(config.screenName).toBe('Screen1');
    expect(config.cameraLabel).toBe('Cam1');
    expect(config.micLabel).toBe('');
  });

  it('overlay partial updates merge correctly (overlay is nested)', async () => {
    await saveConfig({
      overlay: { ...DEFAULT_OVERLAY, name: 'My Name', bgColor: '#ff0000' },
    });

    let config = getConfig();
    expect(config.overlay.name).toBe('My Name');
    expect(config.overlay.bgColor).toBe('#ff0000');
    // Other overlay defaults preserved
    expect(config.overlay.nameFont).toBe('Roboto');
    expect(config.overlay.mouseZoom).toBe(1.5);

    // Partial overlay update with only changed fields merges with existing
    // saveConfig does: config.overlay = { ...config.overlay, ...partial.overlay }
    await saveConfig({
      overlay: { cinemaFilter: 'matrix' } as any,
    });

    config = getConfig();
    expect(config.overlay.cinemaFilter).toBe('matrix');
    // Previous overlay values preserved through merge
    expect(config.overlay.name).toBe('My Name');
    expect(config.overlay.bgColor).toBe('#ff0000');
    expect(config.overlay.nameFont).toBe('Roboto');
  });

  it('getConfig() returns current in-memory config', () => {
    const config = getConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config.screenName).toBe('');
    expect(config.overlay.nameFont).toBe('Roboto');
  });

  it('corrupt JSON file → loadConfig() returns defaults', () => {
    // Write invalid JSON
    fs.writeFileSync(CONFIG_FILE, '{ this is not valid json!!!', 'utf-8');

    const config = loadConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('partially valid config file merges with defaults', () => {
    // Write a config with only some fields
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify({ screenName: 'Partial', micLabel: 'Mic1' }),
      'utf-8',
    );

    const config = loadConfig();
    expect(config.screenName).toBe('Partial');
    expect(config.micLabel).toBe('Mic1');
    expect(config.cameraLabel).toBe(''); // default
    expect(config.layout).toBe('camera-right'); // default
    expect(config.overlay).toEqual(DEFAULT_OVERLAY); // full default overlay
  });

  it('config file with partial overlay merges overlay defaults', () => {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify({
        overlay: { name: 'TestName', bgColor: '#123456' },
      }),
      'utf-8',
    );

    const config = loadConfig();
    expect(config.overlay.name).toBe('TestName');
    expect(config.overlay.bgColor).toBe('#123456');
    // Defaults filled in
    expect(config.overlay.nameFont).toBe('Roboto');
    expect(config.overlay.nameFontSize).toBe(25);
    expect(config.overlay.mouseZoom).toBe(1.5);
  });
});
