import { describe, it, expect } from 'vitest';
import {
  buildEnhancementFilter,
  getCinemaCSS,
  getCinemaCanvas,
  CINEMA_FILTERS,
} from '../../src/shared/filters';

describe('buildEnhancementFilter', () => {
  const defaults = {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    warmth: 0,
    sharpness: 0,
    softness: 0,
  };

  it('returns empty string for all-default values', () => {
    expect(buildEnhancementFilter(defaults)).toBe('');
  });

  describe('brightness', () => {
    it('returns brightness filter when not 100', () => {
      expect(buildEnhancementFilter({ ...defaults, brightness: 150 })).toBe('brightness(1.5)');
    });

    it('handles brightness below 100', () => {
      expect(buildEnhancementFilter({ ...defaults, brightness: 50 })).toBe('brightness(0.5)');
    });

    it('handles brightness of 0', () => {
      expect(buildEnhancementFilter({ ...defaults, brightness: 0 })).toBe('brightness(0)');
    });

    it('handles brightness of 200', () => {
      expect(buildEnhancementFilter({ ...defaults, brightness: 200 })).toBe('brightness(2)');
    });
  });

  describe('contrast', () => {
    it('returns contrast filter when not 100', () => {
      expect(buildEnhancementFilter({ ...defaults, contrast: 50 })).toBe('contrast(0.5)');
    });

    it('handles contrast above 100', () => {
      expect(buildEnhancementFilter({ ...defaults, contrast: 200 })).toBe('contrast(2)');
    });
  });

  describe('saturation', () => {
    it('returns saturate filter when not 100', () => {
      expect(buildEnhancementFilter({ ...defaults, saturation: 200 })).toBe('saturate(2)');
    });

    it('handles low saturation', () => {
      expect(buildEnhancementFilter({ ...defaults, saturation: 25 })).toBe('saturate(0.25)');
    });
  });

  describe('warmth', () => {
    it('applies sepia for positive warmth', () => {
      const result = buildEnhancementFilter({ ...defaults, warmth: 25 });
      // sepia = (25/50) * 0.2 = 0.1
      expect(result).toBe('sepia(0.1)');
    });

    it('applies sepia for warmth of 50', () => {
      const result = buildEnhancementFilter({ ...defaults, warmth: 50 });
      // sepia = (50/50) * 0.2 = 0.2
      expect(result).toBe('sepia(0.2)');
    });

    it('applies hue-rotate for negative warmth', () => {
      const result = buildEnhancementFilter({ ...defaults, warmth: -25 });
      // hueShift = (-25/50) * 30 = -15
      expect(result).toBe('hue-rotate(-15deg)');
    });

    it('applies hue-rotate for warmth of -50', () => {
      const result = buildEnhancementFilter({ ...defaults, warmth: -50 });
      // hueShift = (-50/50) * 30 = -30
      expect(result).toBe('hue-rotate(-30deg)');
    });

    it('does not apply filter for warmth of 0', () => {
      expect(buildEnhancementFilter({ ...defaults, warmth: 0 })).toBe('');
    });
  });

  describe('sharpness', () => {
    it('applies extra contrast for positive sharpness', () => {
      const result = buildEnhancementFilter({ ...defaults, sharpness: 50 });
      // extra = 1 + (50/100) * 0.15 = 1.075
      expect(result).toBe('contrast(1.075)');
    });

    it('applies extra contrast for sharpness of 100', () => {
      const result = buildEnhancementFilter({ ...defaults, sharpness: 100 });
      // extra = 1 + (100/100) * 0.15 = 1.15
      expect(result).toBe('contrast(1.15)');
    });

    it('does not apply filter for sharpness of 0', () => {
      expect(buildEnhancementFilter({ ...defaults, sharpness: 0 })).toBe('');
    });
  });

  describe('softness', () => {
    it('applies blur for positive softness', () => {
      const result = buildEnhancementFilter({ ...defaults, softness: 50 });
      // blur = (50/100) * 1.5 = 0.75
      expect(result).toBe('blur(0.75px)');
    });

    it('applies blur for softness of 100', () => {
      const result = buildEnhancementFilter({ ...defaults, softness: 100 });
      // blur = (100/100) * 1.5 = 1.5
      expect(result).toBe('blur(1.5px)');
    });

    it('does not apply filter for softness of 0', () => {
      expect(buildEnhancementFilter({ ...defaults, softness: 0 })).toBe('');
    });
  });

  describe('combined filters', () => {
    it('combines brightness and contrast', () => {
      const result = buildEnhancementFilter({
        ...defaults,
        brightness: 120,
        contrast: 80,
      });
      expect(result).toBe('brightness(1.2) contrast(0.8)');
    });

    it('combines all non-default values', () => {
      const result = buildEnhancementFilter({
        brightness: 120,
        contrast: 80,
        saturation: 150,
        warmth: 25,
        sharpness: 50,
        softness: 30,
      });
      // brightness(1.2) contrast(0.8) saturate(1.5) sepia(0.1) contrast(1.075) blur(0.45px)
      expect(result).toContain('brightness(1.2)');
      expect(result).toContain('contrast(0.8)');
      expect(result).toContain('saturate(1.5)');
      expect(result).toContain('sepia(0.1)');
      expect(result).toContain('contrast(1.075)');
      // (30/100) * 1.5 = 0.44999999999999996 due to floating point
      expect(result).toMatch(/blur\(0\.4\d+px\)/);
    });

    it('preserves filter order: brightness, contrast, saturate, warmth, sharpness, softness', () => {
      const result = buildEnhancementFilter({
        brightness: 120,
        contrast: 80,
        saturation: 150,
        warmth: 25,
        sharpness: 50,
        softness: 30,
      });
      const parts = result.split(' ');
      expect(parts[0]).toMatch(/^brightness/);
      expect(parts[1]).toMatch(/^contrast/);
      expect(parts[2]).toMatch(/^saturate/);
      expect(parts[3]).toMatch(/^sepia/);
      expect(parts[4]).toMatch(/^contrast/);
      expect(parts[5]).toMatch(/^blur/);
    });
  });
});

describe('CINEMA_FILTERS', () => {
  const expectedKeys = ['matrix', 'teal-orange', 'noir', 'vintage', 'blade-runner', 'moonlight'];

  it('contains all expected filter keys', () => {
    for (const key of expectedKeys) {
      expect(CINEMA_FILTERS).toHaveProperty(key);
    }
  });

  it('has exactly the expected number of filters', () => {
    expect(Object.keys(CINEMA_FILTERS)).toHaveLength(expectedKeys.length);
  });

  it.each(expectedKeys)('filter "%s" has all required fields', (key) => {
    const filter = CINEMA_FILTERS[key];
    expect(filter).toHaveProperty('cssFilter');
    expect(filter).toHaveProperty('canvasFilter');
    expect(filter).toHaveProperty('shadowTint');
    expect(filter).toHaveProperty('shadowAlpha');
    expect(filter).toHaveProperty('highlightTint');
    expect(filter).toHaveProperty('highlightAlpha');
  });

  it.each(expectedKeys)('filter "%s" has non-empty cssFilter and canvasFilter', (key) => {
    const filter = CINEMA_FILTERS[key];
    expect(filter.cssFilter).toBeTruthy();
    expect(filter.canvasFilter).toBeTruthy();
    expect(typeof filter.cssFilter).toBe('string');
    expect(typeof filter.canvasFilter).toBe('string');
  });

  it.each(expectedKeys)('filter "%s" has valid alpha values between 0 and 1', (key) => {
    const filter = CINEMA_FILTERS[key];
    expect(filter.shadowAlpha).toBeGreaterThanOrEqual(0);
    expect(filter.shadowAlpha).toBeLessThanOrEqual(1);
    expect(filter.highlightAlpha).toBeGreaterThanOrEqual(0);
    expect(filter.highlightAlpha).toBeLessThanOrEqual(1);
  });

  it('matrix filter has green shadow tint', () => {
    expect(CINEMA_FILTERS['matrix'].shadowTint).toBe('#88cc77');
  });
});

describe('getCinemaCSS', () => {
  it('returns empty string for "none"', () => {
    expect(getCinemaCSS('none')).toBe('');
  });

  it('returns the cssFilter string for "matrix"', () => {
    expect(getCinemaCSS('matrix')).toBe(CINEMA_FILTERS['matrix'].cssFilter);
  });

  it.each(Object.keys(CINEMA_FILTERS))('returns cssFilter for "%s"', (key) => {
    expect(getCinemaCSS(key)).toBe(CINEMA_FILTERS[key].cssFilter);
  });
});

describe('getCinemaCanvas', () => {
  it('returns empty string for "none"', () => {
    expect(getCinemaCanvas('none')).toBe('');
  });

  it('returns the canvasFilter string for "matrix"', () => {
    expect(getCinemaCanvas('matrix')).toBe(CINEMA_FILTERS['matrix'].canvasFilter);
  });

  it.each(Object.keys(CINEMA_FILTERS))('returns canvasFilter for "%s"', (key) => {
    expect(getCinemaCanvas(key)).toBe(CINEMA_FILTERS[key].canvasFilter);
  });
});
