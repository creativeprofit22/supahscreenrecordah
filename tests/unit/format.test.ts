import { describe, it, expect } from 'vitest';
import { formatTime } from '../../src/shared/format';

describe('formatTime', () => {
  describe('MM:SS format (< 1 hour)', () => {
    it('formats 0 seconds as 00:00', () => {
      expect(formatTime(0)).toBe('00:00');
    });

    it('formats 5 seconds as 00:05', () => {
      expect(formatTime(5)).toBe('00:05');
    });

    it('formats 60 seconds as 01:00', () => {
      expect(formatTime(60)).toBe('01:00');
    });

    it('formats 61 seconds as 01:01', () => {
      expect(formatTime(61)).toBe('01:01');
    });

    it('formats 3599 seconds as 59:59', () => {
      expect(formatTime(3599)).toBe('59:59');
    });

    it('formats single-digit seconds with leading zero', () => {
      expect(formatTime(9)).toBe('00:09');
    });

    it('formats single-digit minutes with leading zero', () => {
      expect(formatTime(300)).toBe('05:00');
    });

    it('formats 599 seconds as 09:59', () => {
      expect(formatTime(599)).toBe('09:59');
    });
  });

  describe('HH:MM:SS format (>= 1 hour)', () => {
    it('formats 3600 seconds as 01:00:00', () => {
      expect(formatTime(3600)).toBe('01:00:00');
    });

    it('formats 3661 seconds as 01:01:01', () => {
      expect(formatTime(3661)).toBe('01:01:01');
    });

    it('formats 86400 seconds (24h) as 24:00:00', () => {
      expect(formatTime(86400)).toBe('24:00:00');
    });

    it('formats 360000 seconds (100h) as 100:00:00', () => {
      expect(formatTime(360000)).toBe('100:00:00');
    });

    it('formats hours with leading zero when single digit', () => {
      expect(formatTime(7200)).toBe('02:00:00');
    });

    it('formats 3723 seconds as 01:02:03', () => {
      expect(formatTime(3723)).toBe('01:02:03');
    });

    it('formats max-boundary 1-hour mark correctly', () => {
      expect(formatTime(3600)).toBe('01:00:00');
      expect(formatTime(3599)).toBe('59:59');
    });
  });

  describe('edge cases', () => {
    it('formats 1 second as 00:01', () => {
      expect(formatTime(1)).toBe('00:01');
    });

    it('formats 59 seconds as 00:59', () => {
      expect(formatTime(59)).toBe('00:59');
    });

    it('formats 119 seconds as 01:59', () => {
      expect(formatTime(119)).toBe('01:59');
    });

    it('handles very large values like 999999 seconds', () => {
      // 999999 / 3600 = 277 hours, remainder 2799 = 46 min 39 sec
      expect(formatTime(999999)).toBe('277:46:39');
    });
  });
});
