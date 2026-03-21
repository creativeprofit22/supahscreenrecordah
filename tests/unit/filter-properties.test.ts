import { describe, it, expect } from 'vitest';
import { buildEnhancementFilter } from '../../src/shared/filters';

/** Helper to create a CameraEnhancement with defaults overridden */
function enh(overrides: Partial<{
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  sharpness: number;
  softness: number;
}> = {}) {
  return {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    warmth: 0,
    sharpness: 0,
    softness: 0,
    ...overrides,
  };
}

describe('buildEnhancementFilter', () => {
  describe('edge cases — all zero/default values', () => {
    it('returns empty string when all values are defaults', () => {
      expect(buildEnhancementFilter(enh())).toBe('');
    });
  });

  describe('brightness extremes', () => {
    it('brightness = 0', () => {
      const result = buildEnhancementFilter(enh({ brightness: 0 }));
      expect(result).toContain('brightness(0)');
    });

    it('brightness = 1', () => {
      const result = buildEnhancementFilter(enh({ brightness: 1 }));
      expect(result).toContain('brightness(');
    });

    it('brightness = 500', () => {
      const result = buildEnhancementFilter(enh({ brightness: 500 }));
      expect(result).toContain('brightness(5)');
    });

    it('brightness = 100 (default) produces no brightness filter', () => {
      const result = buildEnhancementFilter(enh({ brightness: 100 }));
      expect(result).not.toContain('brightness(');
    });
  });

  describe('contrast extremes', () => {
    it('contrast = 0', () => {
      const result = buildEnhancementFilter(enh({ contrast: 0 }));
      expect(result).toContain('contrast(0)');
    });

    it('contrast = 200', () => {
      const result = buildEnhancementFilter(enh({ contrast: 200 }));
      expect(result).toContain('contrast(2)');
    });

    it('contrast = 100 (default) produces no extra contrast filter', () => {
      const result = buildEnhancementFilter(enh({ contrast: 100 }));
      expect(result).not.toContain('contrast(');
    });
  });

  describe('warmth extremes', () => {
    it('warmth = -50 produces hue-rotate', () => {
      const result = buildEnhancementFilter(enh({ warmth: -50 }));
      expect(result).toContain('hue-rotate(');
    });

    it('warmth = 0 (default) produces nothing', () => {
      const result = buildEnhancementFilter(enh({ warmth: 0 }));
      expect(result).toBe('');
    });

    it('warmth = 50 produces sepia', () => {
      const result = buildEnhancementFilter(enh({ warmth: 50 }));
      expect(result).toContain('sepia(');
    });
  });

  describe('sharpness extremes', () => {
    it('sharpness = 0 produces no contrast boost', () => {
      const result = buildEnhancementFilter(enh({ sharpness: 0 }));
      expect(result).toBe('');
    });

    it('sharpness = 100 produces contrast boost', () => {
      const result = buildEnhancementFilter(enh({ sharpness: 100 }));
      expect(result).toContain('contrast(');
    });
  });

  describe('softness extremes', () => {
    it('softness = 0 produces no blur', () => {
      const result = buildEnhancementFilter(enh({ softness: 0 }));
      expect(result).toBe('');
    });

    it('softness = 100 produces blur', () => {
      const result = buildEnhancementFilter(enh({ softness: 100 }));
      expect(result).toContain('blur(');
    });
  });

  describe('all max values simultaneously', () => {
    it('produces a multi-part filter string', () => {
      const result = buildEnhancementFilter(enh({
        brightness: 500,
        contrast: 500,
        saturation: 500,
        warmth: 50,
        sharpness: 100,
        softness: 100,
      }));
      expect(result).toContain('brightness(');
      expect(result).toContain('contrast(');
      expect(result).toContain('saturate(');
      expect(result).toContain('sepia(');
      expect(result).toContain('blur(');
    });
  });

  describe('output guarantees', () => {
    const testCases = [
      enh(),
      enh({ brightness: 0 }),
      enh({ brightness: 500 }),
      enh({ contrast: 0 }),
      enh({ contrast: 500 }),
      enh({ warmth: -50 }),
      enh({ warmth: 50 }),
      enh({ sharpness: 100 }),
      enh({ softness: 100 }),
      enh({ brightness: 0, contrast: 0, saturation: 0, warmth: -50, sharpness: 100, softness: 100 }),
    ];

    for (const [i, testCase] of testCases.entries()) {
      it(`case ${i}: always returns a string`, () => {
        const result = buildEnhancementFilter(testCase);
        expect(typeof result).toBe('string');
      });

      it(`case ${i}: never contains 'undefined'`, () => {
        const result = buildEnhancementFilter(testCase);
        expect(result).not.toContain('undefined');
      });

      it(`case ${i}: never contains 'NaN'`, () => {
        const result = buildEnhancementFilter(testCase);
        expect(result).not.toContain('NaN');
      });

      it(`case ${i}: never contains 'null'`, () => {
        const result = buildEnhancementFilter(testCase);
        expect(result).not.toContain('null');
      });
    }
  });
});
