import { describe, it, expect } from 'vitest';
import { findMatchingSource } from '../../src/main/services/source-matching';

const screen1 = { id: 'screen:0:0', name: 'Entire Screen' };
const screen2 = { id: 'screen:1:0', name: 'Screen 2' };
const chrome = { id: 'window:123456:0', name: 'GitHub - Google Chrome' };
const vscode = { id: 'window:789012:0', name: 'index.ts - supahscreenrecordah - Visual Studio Code' };
const discord = { id: 'window:345678:0', name: 'Discord' };

const sources = [screen1, screen2, chrome, vscode, discord];

describe('findMatchingSource', () => {
  describe('exact ID match', () => {
    it('matches by exact source ID', () => {
      const result = findMatchingSource(sources, 'window:123456:0', null);
      expect(result).toEqual({ source: chrome, method: 'id' });
    });

    it('matches screen by ID', () => {
      const result = findMatchingSource(sources, 'screen:0:0', null);
      expect(result).toEqual({ source: screen1, method: 'id' });
    });
  });

  describe('exact name match', () => {
    it('falls back to exact name when ID does not match', () => {
      const result = findMatchingSource(sources, 'window:999:0', 'Discord');
      expect(result).toEqual({ source: discord, method: 'exact-name' });
    });

    it('matches when ID is null but name matches', () => {
      const result = findMatchingSource(sources, null, 'Discord');
      expect(result).toEqual({ source: discord, method: 'exact-name' });
    });
  });

  describe('fuzzy name match', () => {
    it('matches when source name contains pending name', () => {
      const result = findMatchingSource(sources, 'window:999:0', 'Google Chrome');
      expect(result).toEqual({ source: chrome, method: 'fuzzy-name' });
    });

    it('matches when pending name contains source name', () => {
      const result = findMatchingSource(sources, 'window:999:0', 'Discord - Voice Channel');
      expect(result).toEqual({ source: discord, method: 'fuzzy-name' });
    });

    it('is case insensitive', () => {
      const result = findMatchingSource(sources, null, 'google chrome');
      expect(result).toEqual({ source: chrome, method: 'fuzzy-name' });
    });
  });

  describe('app suffix match', () => {
    it('matches by app suffix when tab title changed', () => {
      // User selected "GitHub - Google Chrome" but now Chrome shows a different tab
      const currentSources = [
        screen1,
        { id: 'window:123456:0', name: 'Reddit - Google Chrome' },
        vscode,
      ];
      const result = findMatchingSource(currentSources, 'window:999:0', 'GitHub - Google Chrome');
      expect(result?.method).toBe('app-suffix');
      expect(result?.source.name).toBe('Reddit - Google Chrome');
    });

    it('matches VS Code by suffix', () => {
      const currentSources = [
        screen1,
        { id: 'window:789012:0', name: 'preview.ts - supahscreenrecordah - Visual Studio Code' },
      ];
      const result = findMatchingSource(
        currentSources,
        'window:999:0',
        'index.ts - supahscreenrecordah - Visual Studio Code',
      );
      expect(result?.method).toBe('app-suffix');
      expect(result?.source.name).toContain('Visual Studio Code');
    });

    it('does not match app suffix for names without dashes', () => {
      const result = findMatchingSource(sources, 'window:999:0', 'SomeRandomApp');
      // Should fall back since no dash in pending name
      expect(result?.method).toBe('fallback');
    });
  });

  describe('fallback', () => {
    it('falls back to first source when nothing matches', () => {
      const result = findMatchingSource(sources, 'window:999:0', 'Nonexistent App');
      expect(result).toEqual({ source: screen1, method: 'fallback' });
    });

    it('falls back when both ID and name are null', () => {
      const result = findMatchingSource(sources, null, null);
      expect(result).toEqual({ source: screen1, method: 'fallback' });
    });

    it('returns null for empty sources', () => {
      const result = findMatchingSource([], 'window:123:0', 'Chrome');
      expect(result).toBeNull();
    });
  });

  describe('priority order', () => {
    it('prefers ID over name', () => {
      // Source has matching ID but different name
      const result = findMatchingSource(sources, chrome.id, 'Discord');
      expect(result?.method).toBe('id');
      expect(result?.source).toBe(chrome);
    });

    it('prefers exact name over fuzzy name', () => {
      const result = findMatchingSource(sources, 'window:999:0', 'Discord');
      expect(result?.method).toBe('exact-name');
    });

    it('prefers fuzzy name over app suffix', () => {
      // "Google Chrome" is a substring of the source name
      const result = findMatchingSource(sources, 'window:999:0', 'Google Chrome');
      expect(result?.method).toBe('fuzzy-name');
    });
  });
});
