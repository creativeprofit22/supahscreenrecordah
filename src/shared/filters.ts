// NOTE: These functions are duplicated in renderer/main.ts which has its own local copies.
// This module exists only for unit testability. Keep in sync with the renderer versions.

interface CameraEnhancement {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  sharpness: number;
  softness: number;
}

export interface CinemaFilterDef {
  cssFilter: string;
  canvasFilter: string;
  shadowTint: string | null;
  shadowAlpha: number;
  highlightTint: string | null;
  highlightAlpha: number;
}

/** Build a CSS/canvas filter string from camera enhancement values */
export function buildEnhancementFilter(enh: CameraEnhancement): string {
  const parts: string[] = [];
  if (enh.brightness !== 100) {
    parts.push(`brightness(${enh.brightness / 100})`);
  }
  if (enh.contrast !== 100) {
    parts.push(`contrast(${enh.contrast / 100})`);
  }
  if (enh.saturation !== 100) {
    parts.push(`saturate(${enh.saturation / 100})`);
  }
  if (enh.warmth !== 0) {
    if (enh.warmth > 0) {
      const sepia = (enh.warmth / 50) * 0.2;
      parts.push(`sepia(${sepia})`);
    } else {
      const hueShift = (enh.warmth / 50) * 30;
      parts.push(`hue-rotate(${hueShift}deg)`);
    }
  }
  if (enh.sharpness > 0) {
    const extra = 1 + (enh.sharpness / 100) * 0.15;
    parts.push(`contrast(${extra})`);
  }
  if (enh.softness > 0) {
    const blur = (enh.softness / 100) * 1.5;
    parts.push(`blur(${blur}px)`);
  }
  return parts.join(' ');
}

export const CINEMA_FILTERS: Record<string, CinemaFilterDef> = {
  matrix: {
    cssFilter: 'sepia(0.4) hue-rotate(70deg) saturate(0.65) contrast(1.4) brightness(0.82)',
    canvasFilter: 'sepia(0.4) hue-rotate(70deg) saturate(0.65) contrast(1.4) brightness(0.82)',
    shadowTint: '#88cc77',
    shadowAlpha: 0.12,
    highlightTint: null,
    highlightAlpha: 0,
  },
  'teal-orange': {
    cssFilter: 'contrast(1.15) saturate(1.2) brightness(0.95)',
    canvasFilter: 'contrast(1.15) saturate(1.2) brightness(0.95)',
    shadowTint: '#1a6b7a',
    shadowAlpha: 0.14,
    highlightTint: '#cc8844',
    highlightAlpha: 0.08,
  },
  noir: {
    cssFilter: 'grayscale(0.85) contrast(1.5) brightness(0.88) saturate(0.3)',
    canvasFilter: 'grayscale(0.85) contrast(1.5) brightness(0.88) saturate(0.3)',
    shadowTint: '#1a2a44',
    shadowAlpha: 0.15,
    highlightTint: '#ccccdd',
    highlightAlpha: 0.04,
  },
  vintage: {
    cssFilter: 'sepia(0.25) contrast(0.9) saturate(0.8) brightness(1.05)',
    canvasFilter: 'sepia(0.25) contrast(0.9) saturate(0.8) brightness(1.05)',
    shadowTint: '#554422',
    shadowAlpha: 0.1,
    highlightTint: '#ddcc99',
    highlightAlpha: 0.1,
  },
  'blade-runner': {
    cssFilter: 'contrast(1.3) saturate(0.85) brightness(0.88) sepia(0.08)',
    canvasFilter: 'contrast(1.3) saturate(0.85) brightness(0.88) sepia(0.08)',
    shadowTint: '#0a4466',
    shadowAlpha: 0.16,
    highlightTint: '#cc9944',
    highlightAlpha: 0.09,
  },
  moonlight: {
    cssFilter: 'saturate(0.75) contrast(1.1) brightness(0.92) hue-rotate(-8deg)',
    canvasFilter: 'saturate(0.75) contrast(1.1) brightness(0.92) hue-rotate(-8deg)',
    shadowTint: '#1a2844',
    shadowAlpha: 0.18,
    highlightTint: '#aabbcc',
    highlightAlpha: 0.05,
  },
};

/** Get the CSS filter string for a cinema filter (for live preview) */
export function getCinemaCSS(filter: string): string {
  if (filter === 'none') {
    return '';
  }
  return CINEMA_FILTERS[filter].cssFilter;
}

/** Get the canvas filter string for a cinema filter (for recording) */
export function getCinemaCanvas(filter: string): string {
  if (filter === 'none') {
    return '';
  }
  return CINEMA_FILTERS[filter].canvasFilter;
}
