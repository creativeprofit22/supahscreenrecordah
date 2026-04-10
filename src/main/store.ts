// Simple JSON file store for persisting app configuration

import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { AppConfig } from '../shared/types';

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  screenName: '',
  cameraLabel: '',
  micLabel: '',
  layout: 'camera-right',
  overlay: {
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
    blurRegions: [],
    aspectRatio: '16:9',
    cursorEffect: { trail: 'none', clickRipple: false, clickRippleColor: '#ffffff' },
    spotlight: false,
    clickSounds: false,
    progressBar: { enabled: false, position: 'bottom', color: '#ffffff', height: 4 },
    watermark: { enabled: false, imagePath: '', position: 'bottom-right', opacity: 0.5, size: 10 },
    webcamBlur: false,
    webcamBlurIntensity: 40,
    shortsBaseZoom: 2.2,
    introOutro: {
      introEnabled: false,
      introTemplate: 'fade-title',
      introText: '',
      introSubtext: '',
      introDuration: 3,
      outroEnabled: false,
      outroTemplate: 'fade-title',
      outroText: '',
      outroSubtext: '',
      outroDuration: 3,
    },
    countdownEnabled: true,
    perspective: false,
    perspectiveIntensity: 2,
  },
  caption: { enabled: false, style: 'clean', position: 'bottom', fontSize: 24, powerWords: false },
  silenceRemoval: { enabled: false, minSilenceMs: 1500, keepPaddingMs: 150, removeFillers: false },
  thumbnail: { enabled: false, platforms: [] },
  exportPlatforms: [],
  autoSaveChunks: true,
};

let config: AppConfig = { ...DEFAULT_CONFIG };

export function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      config = {
        ...DEFAULT_CONFIG,
        ...parsed,
        overlay: {
          ...DEFAULT_CONFIG.overlay,
          ...(parsed.overlay ?? {}),
          cameraEnhancement: {
            ...DEFAULT_CONFIG.overlay.cameraEnhancement,
            ...((parsed.overlay ?? {}).cameraEnhancement ?? {}),
          },
          socials: {
            ...DEFAULT_CONFIG.overlay.socials,
            ...((parsed.overlay ?? {}).socials ?? {}),
          },
          cursorEffect: {
            ...DEFAULT_CONFIG.overlay.cursorEffect,
            ...((parsed.overlay ?? {}).cursorEffect ?? {}),
          },
          progressBar: {
            ...DEFAULT_CONFIG.overlay.progressBar,
            ...((parsed.overlay ?? {}).progressBar ?? {}),
          },
          watermark: {
            ...DEFAULT_CONFIG.overlay.watermark,
            ...((parsed.overlay ?? {}).watermark ?? {}),
          },
          introOutro: {
            ...DEFAULT_CONFIG.overlay.introOutro,
            ...((parsed.overlay ?? {}).introOutro ?? {}),
          },
        },
      };
    }
  } catch (err) {
    console.warn('Failed to load config:', err);
    config = { ...DEFAULT_CONFIG };
  }
  return config;
}

export async function saveConfig(partial: Partial<AppConfig>): Promise<void> {
  if (partial.overlay) {
    const po = partial.overlay;
    config.overlay = {
      ...config.overlay,
      ...po,
      cameraEnhancement: {
        ...config.overlay.cameraEnhancement,
        ...(po.cameraEnhancement ?? {}),
      },
      socials: {
        ...config.overlay.socials,
        ...(po.socials ?? {}),
      },
      cursorEffect: {
        ...config.overlay.cursorEffect,
        ...(po.cursorEffect ?? {}),
      },
      progressBar: {
        ...config.overlay.progressBar,
        ...(po.progressBar ?? {}),
      },
      watermark: {
        ...config.overlay.watermark,
        ...(po.watermark ?? {}),
      },
      introOutro: {
        ...config.overlay.introOutro,
        ...(po.introOutro ?? {}),
      },
    };
  }
  config = { ...config, ...partial, overlay: config.overlay };
  try {
    const tmpFile = CONFIG_FILE + '.tmp';
    await fs.promises.writeFile(tmpFile, JSON.stringify(config, null, 2), 'utf-8');
    await fs.promises.rename(tmpFile, CONFIG_FILE);
  } catch (err) {
    console.warn('Failed to save config:', err);
  }
}

export function getConfig(): AppConfig {
  return config;
}
