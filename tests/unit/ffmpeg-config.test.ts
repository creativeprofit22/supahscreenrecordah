import { describe, it, expect } from 'vitest';
import {
  VOICE_ENHANCE_FILTER_BASE,
  LOUDNORM_I,
  LOUDNORM_TP,
  LOUDNORM_LRA,
  POST_BOOST_FILTERS,
} from '../../src/main/services/ffmpeg/filters';
import {
  VIDEO_ENCODE_FLAGS,
  FFMPEG_EXEC_OPTIONS,
  FFMPEG_EXEC_OPTIONS_SHORT,
} from '../../src/main/services/ffmpeg/encode';

describe('VOICE_ENHANCE_FILTER_BASE', () => {
  it('is a non-empty string', () => {
    expect(typeof VOICE_ENHANCE_FILTER_BASE).toBe('string');
    expect(VOICE_ENHANCE_FILTER_BASE.length).toBeGreaterThan(0);
  });

  it('contains expected filter names', () => {
    expect(VOICE_ENHANCE_FILTER_BASE).toContain('agate');
    expect(VOICE_ENHANCE_FILTER_BASE).toContain('highpass');
    expect(VOICE_ENHANCE_FILTER_BASE).toContain('afftdn');
    expect(VOICE_ENHANCE_FILTER_BASE).toContain('equalizer');
    expect(VOICE_ENHANCE_FILTER_BASE).toContain('aexciter');
    expect(VOICE_ENHANCE_FILTER_BASE).toContain('acompressor');
  });

  it('is comma-separated (multiple filters)', () => {
    const parts = VOICE_ENHANCE_FILTER_BASE.split(',');
    expect(parts.length).toBeGreaterThan(1);
  });

  it('contains noise gate (agate) as first filter', () => {
    expect(VOICE_ENHANCE_FILTER_BASE.startsWith('agate')).toBe(true);
  });

  it('contains highpass filter for rumble removal', () => {
    expect(VOICE_ENHANCE_FILTER_BASE).toMatch(/highpass=f=\d+/);
  });

  it('contains noise reduction (afftdn)', () => {
    expect(VOICE_ENHANCE_FILTER_BASE).toMatch(/afftdn=nf=-\d+/);
  });

  it('contains multiple equalizer bands', () => {
    const matches = VOICE_ENHANCE_FILTER_BASE.match(/equalizer=/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });
});

describe('LOUDNORM constants', () => {
  it('LOUDNORM_I is -14 (YouTube standard)', () => {
    expect(LOUDNORM_I).toBe(-14);
  });

  it('LOUDNORM_TP is -1.5', () => {
    expect(LOUDNORM_TP).toBe(-1.5);
  });

  it('LOUDNORM_LRA is 11', () => {
    expect(LOUDNORM_LRA).toBe(11);
  });

  it('LOUDNORM_I is a reasonable LUFS value (between -24 and -5)', () => {
    expect(LOUDNORM_I).toBeGreaterThanOrEqual(-24);
    expect(LOUDNORM_I).toBeLessThanOrEqual(-5);
  });

  it('LOUDNORM_TP is a reasonable true peak value (between -3 and 0)', () => {
    expect(LOUDNORM_TP).toBeGreaterThanOrEqual(-3);
    expect(LOUDNORM_TP).toBeLessThanOrEqual(0);
  });

  it('LOUDNORM_LRA is a reasonable loudness range (between 1 and 20)', () => {
    expect(LOUDNORM_LRA).toBeGreaterThanOrEqual(1);
    expect(LOUDNORM_LRA).toBeLessThanOrEqual(20);
  });
});

describe('POST_BOOST_FILTERS', () => {
  it('is a non-empty string', () => {
    expect(typeof POST_BOOST_FILTERS).toBe('string');
    expect(POST_BOOST_FILTERS.length).toBeGreaterThan(0);
  });

  it('contains alimiter', () => {
    expect(POST_BOOST_FILTERS).toContain('alimiter');
  });
});

describe('VIDEO_ENCODE_FLAGS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(VIDEO_ENCODE_FLAGS)).toBe(true);
    expect(VIDEO_ENCODE_FLAGS.length).toBeGreaterThan(0);
  });

  it('all elements are strings', () => {
    for (const flag of VIDEO_ENCODE_FLAGS) {
      expect(typeof flag).toBe('string');
    }
  });

  it('specifies libx264 codec', () => {
    const codecIndex = VIDEO_ENCODE_FLAGS.indexOf('-c:v');
    expect(codecIndex).not.toBe(-1);
    expect(VIDEO_ENCODE_FLAGS[codecIndex + 1]).toBe('libx264');
  });

  it('specifies medium preset', () => {
    const presetIndex = VIDEO_ENCODE_FLAGS.indexOf('-preset');
    expect(presetIndex).not.toBe(-1);
    expect(VIDEO_ENCODE_FLAGS[presetIndex + 1]).toBe('medium');
  });

  it('specifies high profile', () => {
    const profileIndex = VIDEO_ENCODE_FLAGS.indexOf('-profile:v');
    expect(profileIndex).not.toBe(-1);
    expect(VIDEO_ENCODE_FLAGS[profileIndex + 1]).toBe('high');
  });

  it('specifies level 4.0', () => {
    const levelIndex = VIDEO_ENCODE_FLAGS.indexOf('-level');
    expect(levelIndex).not.toBe(-1);
    expect(VIDEO_ENCODE_FLAGS[levelIndex + 1]).toBe('4.0');
  });

  it('specifies CRF 17', () => {
    const crfIndex = VIDEO_ENCODE_FLAGS.indexOf('-crf');
    expect(crfIndex).not.toBe(-1);
    expect(VIDEO_ENCODE_FLAGS[crfIndex + 1]).toBe('17');
  });

  it('specifies yuv420p pixel format', () => {
    const pixFmtIndex = VIDEO_ENCODE_FLAGS.indexOf('-pix_fmt');
    expect(pixFmtIndex).not.toBe(-1);
    expect(VIDEO_ENCODE_FLAGS[pixFmtIndex + 1]).toBe('yuv420p');
  });

  it('specifies 30fps frame rate', () => {
    const rIndex = VIDEO_ENCODE_FLAGS.indexOf('-r');
    expect(rIndex).not.toBe(-1);
    expect(VIDEO_ENCODE_FLAGS[rIndex + 1]).toBe('30');
  });

  it('specifies bt709 colorspace', () => {
    const csIndex = VIDEO_ENCODE_FLAGS.indexOf('-colorspace');
    expect(csIndex).not.toBe(-1);
    expect(VIDEO_ENCODE_FLAGS[csIndex + 1]).toBe('bt709');
  });

  it('specifies keyframe interval of 60 (-g 60)', () => {
    const gIndex = VIDEO_ENCODE_FLAGS.indexOf('-g');
    expect(gIndex).not.toBe(-1);
    expect(VIDEO_ENCODE_FLAGS[gIndex + 1]).toBe('60');
  });

  it('specifies maxrate and bufsize for bitrate control', () => {
    const maxrateIndex = VIDEO_ENCODE_FLAGS.indexOf('-maxrate');
    expect(maxrateIndex).not.toBe(-1);
    expect(VIDEO_ENCODE_FLAGS[maxrateIndex + 1]).toBe('14M');

    const bufsizeIndex = VIDEO_ENCODE_FLAGS.indexOf('-bufsize');
    expect(bufsizeIndex).not.toBe(-1);
    expect(VIDEO_ENCODE_FLAGS[bufsizeIndex + 1]).toBe('28M');
  });

  it('specifies avc1 tag for MP4 compatibility', () => {
    const tagIndex = VIDEO_ENCODE_FLAGS.indexOf('-tag:v');
    expect(tagIndex).not.toBe(-1);
    expect(VIDEO_ENCODE_FLAGS[tagIndex + 1]).toBe('avc1');
  });

  it('flags come in pairs (even length)', () => {
    expect(VIDEO_ENCODE_FLAGS.length % 2).toBe(0);
  });
});

describe('FFMPEG_EXEC_OPTIONS', () => {
  it('has timeout property', () => {
    expect(FFMPEG_EXEC_OPTIONS).toHaveProperty('timeout');
  });

  it('has maxBuffer property', () => {
    expect(FFMPEG_EXEC_OPTIONS).toHaveProperty('maxBuffer');
  });

  it('timeout is 10 minutes (600,000ms)', () => {
    expect(FFMPEG_EXEC_OPTIONS.timeout).toBe(600_000);
  });

  it('maxBuffer is 50MB', () => {
    expect(FFMPEG_EXEC_OPTIONS.maxBuffer).toBe(50 * 1024 * 1024);
  });
});

describe('FFMPEG_EXEC_OPTIONS_SHORT', () => {
  it('has timeout property', () => {
    expect(FFMPEG_EXEC_OPTIONS_SHORT).toHaveProperty('timeout');
  });

  it('has maxBuffer property', () => {
    expect(FFMPEG_EXEC_OPTIONS_SHORT).toHaveProperty('maxBuffer');
  });

  it('timeout is 1 minute (60,000ms)', () => {
    expect(FFMPEG_EXEC_OPTIONS_SHORT.timeout).toBe(60_000);
  });

  it('maxBuffer is 10MB', () => {
    expect(FFMPEG_EXEC_OPTIONS_SHORT.maxBuffer).toBe(10 * 1024 * 1024);
  });

  it('short options have shorter timeout than regular options', () => {
    expect(FFMPEG_EXEC_OPTIONS_SHORT.timeout).toBeLessThan(FFMPEG_EXEC_OPTIONS.timeout);
  });

  it('short options have smaller maxBuffer than regular options', () => {
    expect(FFMPEG_EXEC_OPTIONS_SHORT.maxBuffer).toBeLessThan(FFMPEG_EXEC_OPTIONS.maxBuffer);
  });
});
