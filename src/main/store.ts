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
  },
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
    config.overlay = { ...config.overlay, ...partial.overlay };
  }
  config = { ...config, ...partial, overlay: config.overlay };
  try {
    await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save config:', err);
  }
}

export function getConfig(): AppConfig {
  return config;
}
