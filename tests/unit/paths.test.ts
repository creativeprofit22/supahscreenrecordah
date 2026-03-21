import { describe, it, expect } from 'vitest';
import path from 'path';
import { isValidSavePath } from '../../src/shared/paths';

describe('isValidSavePath', () => {
  const allowedDir = '/home/user/recordings';
  const allowedDirs = [allowedDir];

  describe('valid paths', () => {
    it('accepts a path directly inside allowed directory', () => {
      expect(isValidSavePath('/home/user/recordings/video.mp4', allowedDirs)).toBe(true);
    });

    it('accepts a path in a subdirectory of allowed dir', () => {
      expect(
        isValidSavePath('/home/user/recordings/2024/January/video.mp4', allowedDirs),
      ).toBe(true);
    });

    it('accepts path exactly matching allowed dir', () => {
      expect(isValidSavePath('/home/user/recordings', allowedDirs)).toBe(true);
    });

    it('accepts with trailing path separator in file path', () => {
      // path.resolve normalizes this
      expect(isValidSavePath('/home/user/recordings/sub/', allowedDirs)).toBe(true);
    });
  });

  describe('invalid paths', () => {
    it('rejects a path outside allowed directories', () => {
      expect(isValidSavePath('/home/user/documents/video.mp4', allowedDirs)).toBe(false);
    });

    it('rejects directory traversal attempt', () => {
      expect(
        isValidSavePath('/home/user/recordings/../../etc/passwd', allowedDirs),
      ).toBe(false);
    });

    it('rejects path that is a prefix but not a subdirectory', () => {
      // "/home/user/recordings-extra" starts with "/home/user/recordings" but is not inside it
      expect(isValidSavePath('/home/user/recordings-extra/file.mp4', allowedDirs)).toBe(false);
    });

    it('rejects root path', () => {
      expect(isValidSavePath('/', allowedDirs)).toBe(false);
    });

    it('rejects parent directory of allowed dir', () => {
      expect(isValidSavePath('/home/user', allowedDirs)).toBe(false);
    });
  });

  describe('edge cases with falsy/invalid input', () => {
    it('returns false for empty string', () => {
      expect(isValidSavePath('', allowedDirs)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isValidSavePath(null as unknown as string, allowedDirs)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isValidSavePath(undefined as unknown as string, allowedDirs)).toBe(false);
    });

    it('returns false for number input', () => {
      expect(isValidSavePath(42 as unknown as string, allowedDirs)).toBe(false);
    });
  });

  describe('multiple allowed directories', () => {
    const multiDirs = ['/home/user/recordings', '/home/user/exports', '/tmp/scratch'];

    it('accepts path in first allowed directory', () => {
      expect(isValidSavePath('/home/user/recordings/file.mp4', multiDirs)).toBe(true);
    });

    it('accepts path in second allowed directory', () => {
      expect(isValidSavePath('/home/user/exports/file.mp4', multiDirs)).toBe(true);
    });

    it('accepts path in third allowed directory', () => {
      expect(isValidSavePath('/tmp/scratch/temp.mp4', multiDirs)).toBe(true);
    });

    it('rejects path not in any allowed directory', () => {
      expect(isValidSavePath('/var/log/syslog', multiDirs)).toBe(false);
    });
  });

  describe('paths with relative components', () => {
    it('resolves relative components that end up inside allowed dir', () => {
      // /home/user/recordings/sub/../file.mp4 resolves to /home/user/recordings/file.mp4
      expect(
        isValidSavePath('/home/user/recordings/sub/../file.mp4', allowedDirs),
      ).toBe(true);
    });

    it('rejects relative components that escape allowed dir', () => {
      expect(
        isValidSavePath('/home/user/recordings/../documents/file.mp4', allowedDirs),
      ).toBe(false);
    });
  });

  describe('empty allowed directories', () => {
    it('rejects any path when no directories are allowed', () => {
      expect(isValidSavePath('/home/user/recordings/file.mp4', [])).toBe(false);
    });
  });
});
