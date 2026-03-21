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

/** Valid ffmpeg audio filter segment: name=key:value or name=value */
const FFMPEG_FILTER_SEGMENT = /^[a-z_]+=/;

describe('FFmpeg Pipeline Config Integration', () => {
  describe('Voice enhancement filter chain', () => {
    it('VOICE_ENHANCE_FILTER_BASE is a non-empty comma-separated filter chain', () => {
      expect(VOICE_ENHANCE_FILTER_BASE.length).toBeGreaterThan(0);
      const segments = VOICE_ENHANCE_FILTER_BASE.split(',');
      expect(segments.length).toBeGreaterThan(1);
      for (const seg of segments) {
        expect(seg.trim()).toMatch(FFMPEG_FILTER_SEGMENT);
      }
    });

    it('VOICE_ENHANCE_FILTER_BASE + loudnorm params form a valid filter chain', () => {
      const loudnorm = `loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}:print_format=json`;
      const fullChain = [VOICE_ENHANCE_FILTER_BASE, loudnorm, POST_BOOST_FILTERS].join(',');

      // Should be comma-separated segments, no empty segments
      const segments = fullChain.split(',');
      expect(segments.length).toBeGreaterThan(3);
      for (const seg of segments) {
        expect(seg.trim().length).toBeGreaterThan(0);
      }
    });

    it('loudnorm targets are reasonable numeric values', () => {
      expect(typeof LOUDNORM_I).toBe('number');
      expect(typeof LOUDNORM_TP).toBe('number');
      expect(typeof LOUDNORM_LRA).toBe('number');
      // YouTube target is -14 LUFS
      expect(LOUDNORM_I).toBe(-14);
      expect(LOUDNORM_TP).toBeLessThan(0);
      expect(LOUDNORM_LRA).toBeGreaterThan(0);
    });

    it('POST_BOOST_FILTERS is a valid ffmpeg filter', () => {
      expect(POST_BOOST_FILTERS.length).toBeGreaterThan(0);
      expect(POST_BOOST_FILTERS).toMatch(FFMPEG_FILTER_SEGMENT);
    });
  });

  describe('VIDEO_ENCODE_FLAGS validation', () => {
    it('contains an even number of elements (flag-value pairs)', () => {
      expect(VIDEO_ENCODE_FLAGS.length % 2).toBe(0);
    });

    it('every odd-indexed element is a flag starting with -', () => {
      for (let i = 0; i < VIDEO_ENCODE_FLAGS.length; i += 2) {
        expect(VIDEO_ENCODE_FLAGS[i]).toMatch(/^-/);
      }
    });

    it('every even-indexed element is a non-empty value', () => {
      for (let i = 1; i < VIDEO_ENCODE_FLAGS.length; i += 2) {
        expect(VIDEO_ENCODE_FLAGS[i].length).toBeGreaterThan(0);
        // Values should NOT start with - (they're values, not flags)
        expect(VIDEO_ENCODE_FLAGS[i]).not.toMatch(/^-/);
      }
    });

    it('uses libx264 codec', () => {
      const codecIdx = VIDEO_ENCODE_FLAGS.indexOf('-c:v');
      expect(codecIdx).toBeGreaterThanOrEqual(0);
      expect(VIDEO_ENCODE_FLAGS[codecIdx + 1]).toBe('libx264');
    });

    it('uses yuv420p pixel format', () => {
      const fmtIdx = VIDEO_ENCODE_FLAGS.indexOf('-pix_fmt');
      expect(fmtIdx).toBeGreaterThanOrEqual(0);
      expect(VIDEO_ENCODE_FLAGS[fmtIdx + 1]).toBe('yuv420p');
    });

    it('sets 30fps output', () => {
      const rIdx = VIDEO_ENCODE_FLAGS.indexOf('-r');
      expect(rIdx).toBeGreaterThanOrEqual(0);
      expect(VIDEO_ENCODE_FLAGS[rIdx + 1]).toBe('30');
    });

    it('uses bt709 colorspace flags', () => {
      const csIdx = VIDEO_ENCODE_FLAGS.indexOf('-colorspace');
      expect(csIdx).toBeGreaterThanOrEqual(0);
      expect(VIDEO_ENCODE_FLAGS[csIdx + 1]).toBe('bt709');
    });
  });

  describe('FFMPEG_EXEC_OPTIONS', () => {
    it('timeout is a positive number (at least 30 seconds)', () => {
      expect(FFMPEG_EXEC_OPTIONS.timeout).toBeGreaterThan(30_000);
    });

    it('timeout is not unreasonably large (under 1 hour)', () => {
      expect(FFMPEG_EXEC_OPTIONS.timeout).toBeLessThanOrEqual(3_600_000);
    });

    it('maxBuffer is positive', () => {
      expect(FFMPEG_EXEC_OPTIONS.maxBuffer).toBeGreaterThan(0);
    });

    it('short options have shorter timeout than standard options', () => {
      expect(FFMPEG_EXEC_OPTIONS_SHORT.timeout).toBeLessThan(FFMPEG_EXEC_OPTIONS.timeout);
    });

    it('short options have smaller maxBuffer than standard options', () => {
      expect(FFMPEG_EXEC_OPTIONS_SHORT.maxBuffer).toBeLessThan(FFMPEG_EXEC_OPTIONS.maxBuffer);
    });
  });

  describe('Complete pass1 filter string format', () => {
    it('pass1 filter string matches the expected format', () => {
      const pass1Filter = [
        VOICE_ENHANCE_FILTER_BASE,
        `loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}:print_format=json`,
        POST_BOOST_FILTERS,
      ].join(',');

      // Must contain the voice enhance filters
      expect(pass1Filter).toContain('agate=');
      expect(pass1Filter).toContain('highpass=');
      expect(pass1Filter).toContain('afftdn=');
      expect(pass1Filter).toContain('equalizer=');
      expect(pass1Filter).toContain('acompressor=');

      // Must contain loudnorm with print_format=json for measurement
      expect(pass1Filter).toContain('loudnorm=');
      expect(pass1Filter).toContain('print_format=json');

      // Must contain post-boost limiter
      expect(pass1Filter).toContain('alimiter=');
    });
  });

  describe('Complete pass2 filter string format', () => {
    it('pass2 filter string uses measured values correctly', () => {
      const mockMeasured = {
        input_i: '-23.5',
        input_lra: '8.2',
        input_tp: '-1.2',
        input_thresh: '-34.1',
        target_offset: '0.3',
      };

      const pass2Filter = [
        'aresample=async=1000:first_pts=0',
        VOICE_ENHANCE_FILTER_BASE,
        `loudnorm=linear=true:I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}` +
          `:measured_i=${mockMeasured.input_i}:measured_lra=${mockMeasured.input_lra}` +
          `:measured_tp=${mockMeasured.input_tp}:measured_thresh=${mockMeasured.input_thresh}` +
          `:offset=${mockMeasured.target_offset}`,
        POST_BOOST_FILTERS,
      ].join(',');

      // Must start with aresample
      expect(pass2Filter).toMatch(/^aresample=/);

      // Must use linear mode
      expect(pass2Filter).toContain('linear=true');

      // Must contain all measured values
      expect(pass2Filter).toContain(`measured_i=${mockMeasured.input_i}`);
      expect(pass2Filter).toContain(`measured_lra=${mockMeasured.input_lra}`);
      expect(pass2Filter).toContain(`measured_tp=${mockMeasured.input_tp}`);
      expect(pass2Filter).toContain(`measured_thresh=${mockMeasured.input_thresh}`);
      expect(pass2Filter).toContain(`offset=${mockMeasured.target_offset}`);

      // Must NOT contain print_format=json (that's pass1 only)
      expect(pass2Filter).not.toContain('print_format=json');

      // Must end with the limiter
      expect(pass2Filter).toMatch(/alimiter=[^\n]+$/);
    });
  });

  describe('Single-pass fallback filter string', () => {
    it('single-pass filter combines all components without measured values', () => {
      const filter = [
        'aresample=async=1000:first_pts=0',
        VOICE_ENHANCE_FILTER_BASE,
        `loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}`,
        POST_BOOST_FILTERS,
      ].join(',');

      expect(filter).toContain('aresample=');
      expect(filter).toContain('loudnorm=');
      expect(filter).not.toContain('linear=true');
      expect(filter).not.toContain('measured_i=');
      expect(filter).not.toContain('print_format=json');
    });
  });
});
