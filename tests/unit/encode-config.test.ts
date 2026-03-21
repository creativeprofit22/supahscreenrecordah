import { describe, it, expect } from 'vitest';
import {
  VIDEO_ENCODE_FLAGS,
  FFMPEG_EXEC_OPTIONS,
  FFMPEG_EXEC_OPTIONS_SHORT,
} from '../../src/main/services/ffmpeg/encode';

/** Helper: get the value for a given flag in the flag-value pair array */
function flagValue(flag: string): string | undefined {
  const idx = VIDEO_ENCODE_FLAGS.indexOf(flag);
  if (idx === -1 || idx + 1 >= VIDEO_ENCODE_FLAGS.length) return undefined;
  return VIDEO_ENCODE_FLAGS[idx + 1];
}

describe('VIDEO_ENCODE_FLAGS', () => {
  it('is an even-length array (flag-value pairs)', () => {
    expect(VIDEO_ENCODE_FLAGS.length % 2).toBe(0);
  });

  const requiredFlags = ['-c:v', '-preset', '-profile:v', '-level', '-crf', '-pix_fmt'];

  for (const flag of requiredFlags) {
    it(`contains required flag: ${flag}`, () => {
      expect(VIDEO_ENCODE_FLAGS).toContain(flag);
    });
  }

  it('uses libx264 codec', () => {
    expect(flagValue('-c:v')).toBe('libx264');
  });

  it('uses medium preset', () => {
    expect(flagValue('-preset')).toBe('medium');
  });

  it('uses high profile', () => {
    expect(flagValue('-profile:v')).toBe('high');
  });

  it('uses level 4.0', () => {
    expect(flagValue('-level')).toBe('4.0');
  });

  it('uses yuv420p pixel format', () => {
    expect(flagValue('-pix_fmt')).toBe('yuv420p');
  });

  it('CRF value is between 0 and 51', () => {
    const crf = Number(flagValue('-crf'));
    expect(crf).toBeGreaterThanOrEqual(0);
    expect(crf).toBeLessThanOrEqual(51);
  });

  it('all flags start with "-"', () => {
    for (let i = 0; i < VIDEO_ENCODE_FLAGS.length; i += 2) {
      expect(
        VIDEO_ENCODE_FLAGS[i].startsWith('-'),
        `Flag at index ${i} ("${VIDEO_ENCODE_FLAGS[i]}") should start with "-"`,
      ).toBe(true);
    }
  });
});

describe('FFMPEG_EXEC_OPTIONS', () => {
  it('timeout is at least 60 seconds', () => {
    expect(FFMPEG_EXEC_OPTIONS.timeout).toBeGreaterThanOrEqual(60_000);
  });

  it('maxBuffer is at least 10MB', () => {
    expect(FFMPEG_EXEC_OPTIONS.maxBuffer).toBeGreaterThanOrEqual(10 * 1024 * 1024);
  });
});

describe('FFMPEG_EXEC_OPTIONS_SHORT', () => {
  it('timeout is at least 60 seconds', () => {
    expect(FFMPEG_EXEC_OPTIONS_SHORT.timeout).toBeGreaterThanOrEqual(60_000);
  });

  it('maxBuffer is at least 10MB', () => {
    expect(FFMPEG_EXEC_OPTIONS_SHORT.maxBuffer).toBeGreaterThanOrEqual(10 * 1024 * 1024);
  });

  it('has shorter timeout than FFMPEG_EXEC_OPTIONS', () => {
    expect(FFMPEG_EXEC_OPTIONS_SHORT.timeout).toBeLessThan(FFMPEG_EXEC_OPTIONS.timeout);
  });
});
