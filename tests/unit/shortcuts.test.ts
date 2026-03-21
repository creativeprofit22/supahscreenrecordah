import { describe, it, expect } from 'vitest';
import { SHORTCUT_LABELS } from '../../src/shared/shortcuts';

describe('SHORTCUT_LABELS', () => {
  it('is a non-empty object', () => {
    expect(Object.keys(SHORTCUT_LABELS).length).toBeGreaterThan(0);
  });

  it('contains expected shortcut keys', () => {
    const expectedKeys = [
      '⌘+C',
      '⌘+V',
      '⌘+X',
      '⌘+S',
      '⌘+Z',
      '⌘+⇧+Z',
      '⌘+A',
      '⌘+F',
      '⌘+T',
      '⌘+W',
      '⌘+N',
      '⌘+Q',
      '⌘+Tab',
      '⌘+Space',
    ];
    for (const key of expectedKeys) {
      expect(SHORTCUT_LABELS).toHaveProperty(key);
    }
  });

  it('has expected label values', () => {
    expect(SHORTCUT_LABELS['⌘+C']).toBe('copied');
    expect(SHORTCUT_LABELS['⌘+V']).toBe('pasted');
    expect(SHORTCUT_LABELS['⌘+X']).toBe('cut');
    expect(SHORTCUT_LABELS['⌘+S']).toBe('saved');
    expect(SHORTCUT_LABELS['⌘+Z']).toBe('undo');
    expect(SHORTCUT_LABELS['⌘+⇧+Z']).toBe('redo');
    expect(SHORTCUT_LABELS['⌘+A']).toBe('select all');
    expect(SHORTCUT_LABELS['⌘+F']).toBe('find');
    expect(SHORTCUT_LABELS['⌘+T']).toBe('new tab');
    expect(SHORTCUT_LABELS['⌘+W']).toBe('close tab');
    expect(SHORTCUT_LABELS['⌘+N']).toBe('new window');
    expect(SHORTCUT_LABELS['⌘+Q']).toBe('quit app');
    expect(SHORTCUT_LABELS['⌘+Tab']).toBe('switch app');
    expect(SHORTCUT_LABELS['⌘+Space']).toBe('spotlight');
  });

  it('all values are non-empty strings', () => {
    for (const [key, value] of Object.entries(SHORTCUT_LABELS)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('has exactly 14 entries', () => {
    expect(Object.keys(SHORTCUT_LABELS)).toHaveLength(14);
  });

  it('all keys start with ⌘', () => {
    for (const key of Object.keys(SHORTCUT_LABELS)) {
      expect(key.startsWith('⌘')).toBe(true);
    }
  });
});
