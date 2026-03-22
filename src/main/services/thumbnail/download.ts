import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

/**
 * Download a file from a URL using curl subprocess.
 * Some KIE.ai temporary URLs block default user agents, so curl with a
 * browser-like User-Agent header is used instead of fetch/https.
 */
export async function downloadFile(url: string, destPath: string): Promise<void> {
  const dir = path.dirname(destPath);
  await fs.promises.mkdir(dir, { recursive: true });

  await execFileAsync('curl', [
    '-sL',
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    '-o', destPath,
    url,
  ], { timeout: 120_000 });

  // Verify the file was actually downloaded
  const stat = await fs.promises.stat(destPath).catch(() => null);
  if (!stat || stat.size === 0) {
    // Clean up empty file
    await fs.promises.unlink(destPath).catch(() => {});
    throw new Error(`Download failed — empty or missing file: ${destPath}`);
  }
}
