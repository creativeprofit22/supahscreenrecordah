import { describe, it, expect } from 'vitest';
import {
  buildEnhancementFilter,
  CINEMA_FILTERS,
  getCinemaCSS,
  getCinemaCanvas,
} from '../../src/shared/filters';

const DEFAULT_CAMERA_ENHANCEMENT = {
  brightness: 105,
  contrast: 110,
  saturation: 115,
  warmth: 5,
  sharpness: 0,
  softness: 0,
};

/** CSS filter function pattern: name(value) */
const CSS_FILTER_FN = /\b(brightness|contrast|saturate|sepia|hue-rotate|blur|grayscale)\([^)]+\)/;

describe('Filter Pipeline Integration', () => {
  describe('buildEnhancementFilter with DEFAULT_CONFIG values', () => {
    it('produces a non-empty filter string for the default camera enhancement', () => {
      const filter = buildEnhancementFilter(DEFAULT_CAMERA_ENHANCEMENT);
      expect(filter.length).toBeGreaterThan(0);
    });

    it('includes brightness, contrast, saturate for non-100 values', () => {
      const filter = buildEnhancementFilter(DEFAULT_CAMERA_ENHANCEMENT);
      expect(filter).toContain('brightness(');
      expect(filter).toContain('contrast(');
      expect(filter).toContain('saturate(');
    });

    it('applies warmth as sepia for positive warmth', () => {
      const filter = buildEnhancementFilter(DEFAULT_CAMERA_ENHANCEMENT);
      // warmth = 5 > 0, so sepia should be applied
      expect(filter).toContain('sepia(');
    });

    it('applies hue-rotate for negative warmth', () => {
      const filter = buildEnhancementFilter({
        ...DEFAULT_CAMERA_ENHANCEMENT,
        warmth: -10,
      });
      expect(filter).toContain('hue-rotate(');
      expect(filter).toContain('deg)');
    });

    it('returns empty string when all values are at neutral', () => {
      const neutral = {
        brightness: 100,
        contrast: 100,
        saturation: 100,
        warmth: 0,
        sharpness: 0,
        softness: 0,
      };
      const filter = buildEnhancementFilter(neutral);
      expect(filter).toBe('');
    });

    it('includes blur for positive softness', () => {
      const filter = buildEnhancementFilter({
        ...DEFAULT_CAMERA_ENHANCEMENT,
        softness: 50,
      });
      expect(filter).toContain('blur(');
      expect(filter).toContain('px)');
    });

    it('includes extra contrast for positive sharpness', () => {
      const filter = buildEnhancementFilter({
        ...DEFAULT_CAMERA_ENHANCEMENT,
        sharpness: 50,
      });
      // sharpness adds a second contrast() call
      const matches = filter.match(/contrast\(/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Cinema filters produce valid CSS', () => {
    const filterNames = Object.keys(CINEMA_FILTERS);

    it.each(filterNames)('CINEMA_FILTERS["%s"] has non-empty cssFilter', (name) => {
      const def = CINEMA_FILTERS[name];
      expect(def.cssFilter.length).toBeGreaterThan(0);
      expect(CSS_FILTER_FN.test(def.cssFilter)).toBe(true);
    });

    it.each(filterNames)('CINEMA_FILTERS["%s"] has non-empty canvasFilter', (name) => {
      const def = CINEMA_FILTERS[name];
      expect(def.canvasFilter.length).toBeGreaterThan(0);
      expect(CSS_FILTER_FN.test(def.canvasFilter)).toBe(true);
    });

    it.each(filterNames)('getCinemaCSS("%s") returns the cssFilter string', (name) => {
      const css = getCinemaCSS(name);
      expect(css).toBe(CINEMA_FILTERS[name].cssFilter);
    });

    it.each(filterNames)('getCinemaCanvas("%s") returns the canvasFilter string', (name) => {
      const canvas = getCinemaCanvas(name);
      expect(canvas).toBe(CINEMA_FILTERS[name].canvasFilter);
    });

    it('getCinemaCSS("none") returns empty string', () => {
      expect(getCinemaCSS('none')).toBe('');
    });

    it('getCinemaCanvas("none") returns empty string', () => {
      expect(getCinemaCanvas('none')).toBe('');
    });
  });

  describe('Combining cinema + enhancement filters (full pipeline)', () => {
    it('cinema CSS and enhancement filter can be combined into a single string', () => {
      const cinema = getCinemaCSS('matrix');
      const enhancement = buildEnhancementFilter(DEFAULT_CAMERA_ENHANCEMENT);

      expect(cinema.length).toBeGreaterThan(0);
      expect(enhancement.length).toBeGreaterThan(0);

      // In the real pipeline these are concatenated with a space
      const combined = [cinema, enhancement].filter(Boolean).join(' ');
      expect(combined.length).toBeGreaterThan(cinema.length);
      expect(combined).toContain('sepia(');
      expect(combined).toContain('hue-rotate(');
      expect(combined).toContain('brightness(');
    });

    it('cinema "none" + enhancement produces only enhancement filters', () => {
      const cinema = getCinemaCSS('none');
      const enhancement = buildEnhancementFilter(DEFAULT_CAMERA_ENHANCEMENT);
      const combined = [cinema, enhancement].filter(Boolean).join(' ');

      expect(combined).toBe(enhancement);
    });

    it('cinema filter + neutral enhancement produces only cinema filter', () => {
      const cinema = getCinemaCSS('blade-runner');
      const neutral = {
        brightness: 100,
        contrast: 100,
        saturation: 100,
        warmth: 0,
        sharpness: 0,
        softness: 0,
      };
      const enhancement = buildEnhancementFilter(neutral);
      const combined = [cinema, enhancement].filter(Boolean).join(' ');

      expect(combined).toBe(cinema);
    });

    it('all cinema filter definitions have valid shadowAlpha/highlightAlpha in [0,1]', () => {
      for (const [, def] of Object.entries(CINEMA_FILTERS)) {
        expect(def.shadowAlpha).toBeGreaterThanOrEqual(0);
        expect(def.shadowAlpha).toBeLessThanOrEqual(1);
        expect(def.highlightAlpha).toBeGreaterThanOrEqual(0);
        expect(def.highlightAlpha).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Filter string format validation', () => {
    it('enhancement filter functions are space-separated', () => {
      const filter = buildEnhancementFilter(DEFAULT_CAMERA_ENHANCEMENT);
      // Individual filter functions should be space-separated, no commas
      expect(filter).not.toContain(',');
      const parts = filter.split(' ');
      for (const part of parts) {
        expect(part).toMatch(/^[a-z-]+\([^)]+\)$/);
      }
    });

    it('cinema CSS filter functions are space-separated', () => {
      for (const [, def] of Object.entries(CINEMA_FILTERS)) {
        expect(def.cssFilter).not.toContain(',');
        const parts = def.cssFilter.split(' ');
        for (const part of parts) {
          expect(part).toMatch(/^[a-z-]+\([^)]+\)$/);
        }
      }
    });
  });
});
