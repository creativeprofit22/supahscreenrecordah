import path from 'path';

/**
 * Validates a file path to prevent directory traversal attacks.
 * Ensures the resolved path is within one of the allowed directories.
 */
export function isValidSavePath(filePath: string, allowedDirs: string[]): boolean {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  const resolved = path.resolve(filePath);
  return allowedDirs.some((allowedDir) => {
    const normalizedAllowed = path.resolve(allowedDir);
    return resolved.startsWith(normalizedAllowed + path.sep) || resolved === normalizedAllowed;
  });
}
