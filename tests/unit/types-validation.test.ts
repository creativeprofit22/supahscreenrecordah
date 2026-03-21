import { describe, it, expect } from 'vitest';
import { Channels } from '../../src/shared/channels';
import { CINEMA_FILTERS, CinemaFilterDef } from '../../src/shared/filters';
import { SHORTCUT_LABELS } from '../../src/shared/shortcuts';
import type { CinemaFilter } from '../../src/shared/types';

describe('CinemaFilter type values', () => {
  const allCinemaFilters: CinemaFilter[] = [
    'none',
    'matrix',
    'teal-orange',
    'noir',
    'vintage',
    'blade-runner',
    'moonlight',
  ];

  it('every non-none CinemaFilter has a CINEMA_FILTERS entry', () => {
    for (const filter of allCinemaFilters) {
      if (filter === 'none') continue;
      expect(CINEMA_FILTERS).toHaveProperty(filter);
    }
  });

  it('"none" does NOT have a CINEMA_FILTERS entry', () => {
    expect(CINEMA_FILTERS).not.toHaveProperty('none');
  });

  it('CINEMA_FILTERS has no extra keys beyond the known filters', () => {
    const expectedKeys = allCinemaFilters.filter((f) => f !== 'none');
    expect(Object.keys(CINEMA_FILTERS).sort()).toEqual([...expectedKeys].sort());
  });
});

describe('Channels uniqueness and naming', () => {
  const channelValues = Object.values(Channels);

  it('all Channels values are unique', () => {
    const unique = new Set(channelValues);
    expect(unique.size).toBe(channelValues.length);
  });

  it('all Channels values follow "domain:action" pattern', () => {
    const pattern = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;
    for (const value of channelValues) {
      expect(value, `Channel "${value}" should match domain:action`).toMatch(pattern);
    }
  });
});

describe('CINEMA_FILTERS entries structure', () => {
  const requiredProps: (keyof CinemaFilterDef)[] = [
    'cssFilter',
    'canvasFilter',
    'shadowTint',
    'shadowAlpha',
    'highlightTint',
    'highlightAlpha',
  ];

  for (const [name, def] of Object.entries(CINEMA_FILTERS)) {
    describe(`filter "${name}"`, () => {
      it('has all required properties', () => {
        for (const prop of requiredProps) {
          expect(def).toHaveProperty(prop);
        }
      });

      it('cssFilter and canvasFilter are strings', () => {
        expect(typeof def.cssFilter).toBe('string');
        expect(typeof def.canvasFilter).toBe('string');
      });

      it('shadowTint and highlightTint are string or null', () => {
        expect(
          def.shadowTint === null || typeof def.shadowTint === 'string',
        ).toBe(true);
        expect(
          def.highlightTint === null || typeof def.highlightTint === 'string',
        ).toBe(true);
      });

      it('alpha values are numbers between 0 and 1', () => {
        expect(typeof def.shadowAlpha).toBe('number');
        expect(typeof def.highlightAlpha).toBe('number');
        expect(def.shadowAlpha).toBeGreaterThanOrEqual(0);
        expect(def.shadowAlpha).toBeLessThanOrEqual(1);
        expect(def.highlightAlpha).toBeGreaterThanOrEqual(0);
        expect(def.highlightAlpha).toBeLessThanOrEqual(1);
      });
    });
  }
});

describe('SHORTCUT_LABELS', () => {
  it('all keys are valid shortcut format (modifier+key)', () => {
    // Keys should contain at least one "+" separator
    for (const key of Object.keys(SHORTCUT_LABELS)) {
      expect(key, `Shortcut key "${key}" should contain "+"`).toContain('+');
    }
  });

  it('all keys start with a known modifier symbol', () => {
    const validModifiers = ['⌘', '⌃', '⌥', '⇧', 'Ctrl', 'Alt', 'Shift', 'Cmd'];
    for (const key of Object.keys(SHORTCUT_LABELS)) {
      const startsWithModifier = validModifiers.some((mod) => key.startsWith(mod));
      expect(startsWithModifier, `"${key}" should start with a known modifier`).toBe(true);
    }
  });

  it('all values are non-empty strings', () => {
    for (const [key, value] of Object.entries(SHORTCUT_LABELS)) {
      expect(typeof value, `Value for "${key}" should be a string`).toBe('string');
      expect(value.length, `Value for "${key}" should be non-empty`).toBeGreaterThan(0);
    }
  });

  it('has at least one entry', () => {
    expect(Object.keys(SHORTCUT_LABELS).length).toBeGreaterThan(0);
  });
});
