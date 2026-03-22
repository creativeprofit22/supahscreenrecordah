// KIE.ai thumbnail generation service
// Uses Nano Banana 2 model (best for thumbnails — fast, supports many aspect ratios)

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { findFfmpeg } from '../dependencies';
import { downloadFile } from './download';
import type { ExportPlatform, ThumbnailResult } from '../../../shared/feature-types';
import { EXPORT_PRESETS } from '../../../shared/feature-types';

const execFileAsync = promisify(execFile);

const KIE_BASE = 'https://api.kie.ai/api/v1';
const INITIAL_POLL_DELAY_MS = 40_000;
const POLL_INTERVAL_MS = 20_000;
const TIMEOUT_MS = 300_000; // 5 minutes

const NANO_ASPECTS = [
  '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3',
  '4:5', '5:4', '8:1', '9:16', '16:9', '21:9', 'auto',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey(apiKey?: string): string {
  const key = apiKey || process.env.KIE_API_KEY || '';
  if (!key) throw new Error('KIE_API_KEY not set');
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), 'supah-thumbnails');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function genFilename(prompt: string, ext = 'png'): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const hash = crypto.createHash('md5').update(prompt).digest('hex').slice(0, 6);
  const safe = prompt.slice(0, 25).replace(/[^a-zA-Z0-9]/g, '_');
  return `${ts}_${safe}_${hash}.${ext}`;
}

// ---------------------------------------------------------------------------
// KIE.ai API
// ---------------------------------------------------------------------------

interface KieCreateTaskResponse {
  taskId?: string;
  data?: {
    taskId?: string;
    resultUrls?: string[];
  };
}

interface KieRecordInfoResponse {
  data?: {
    state?: string;
    resultUrls?: string[];
    resultJson?: string;
    error?: string;
    message?: string;
    errorMessage?: string;
    failMsg?: string;
  };
}

/**
 * Extract image URLs from a completed KIE.ai task response.
 */
function extractResultUrls(data: KieRecordInfoResponse['data']): string[] {
  if (!data) return [];

  // Try resultJson first (may contain nested resultUrls)
  if (data.resultJson) {
    try {
      const rj = JSON.parse(data.resultJson) as { resultUrls?: string[] };
      if (rj.resultUrls?.length) return rj.resultUrls;
    } catch { /* fall through */ }
  }

  return data.resultUrls ?? [];
}

/**
 * Generate a thumbnail using KIE.ai Nano Banana 2 model.
 *
 * @param prompt       - Image generation prompt
 * @param aspectRatio  - Aspect ratio string (e.g. '16:9', '9:16', '1:1')
 * @param apiKey       - KIE.ai API key (falls back to KIE_API_KEY env var)
 * @returns Local file path to the downloaded PNG
 */
export async function generateThumbnail(
  prompt: string,
  aspectRatio: string,
  apiKey: string,
): Promise<string> {
  const key = getApiKey(apiKey);

  // Validate aspect ratio
  if (!NANO_ASPECTS.includes(aspectRatio as typeof NANO_ASPECTS[number])) {
    throw new Error(
      `Invalid aspect ratio '${aspectRatio}' for nano-banana-2. Valid: ${NANO_ASPECTS.join(', ')}`,
    );
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };

  // 1. Create task
  const createRes = await fetch(`${KIE_BASE}/jobs/createTask`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'nano-banana-2',
      input: {
        prompt,
        aspect_ratio: aspectRatio,
        resolution: '2K',
        output_format: 'png',
      },
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`KIE createTask failed (${createRes.status}): ${body}`);
  }

  const createData = (await createRes.json()) as KieCreateTaskResponse;
  const taskId = createData.taskId ?? createData.data?.taskId;

  // Handle immediate result (rare but possible)
  if (!taskId) {
    const urls = createData.data?.resultUrls ?? [];
    if (urls.length) return downloadToTemp(urls[0], prompt);
    throw new Error(`KIE createTask returned no taskId: ${JSON.stringify(createData)}`);
  }

  // 2. Poll for result
  const deadline = Date.now() + TIMEOUT_MS;
  await sleep(INITIAL_POLL_DELAY_MS);

  while (Date.now() < deadline) {
    const pollRes = await fetch(
      `${KIE_BASE}/jobs/recordInfo?taskId=${taskId}`,
      { headers: { Authorization: `Bearer ${key}` } },
    );

    if (!pollRes.ok) {
      const body = await pollRes.text();
      throw new Error(`KIE recordInfo failed (${pollRes.status}): ${body}`);
    }

    const pollData = (await pollRes.json()) as KieRecordInfoResponse;
    const state = (pollData.data?.state ?? '').toLowerCase();

    if (['completed', 'success', 'done'].includes(state)) {
      const urls = extractResultUrls(pollData.data);
      if (!urls.length) {
        throw new Error('KIE task completed but returned no image URLs');
      }
      return downloadToTemp(urls[0], prompt);
    }

    if (['failed', 'error', 'fail'].includes(state)) {
      const d = pollData.data ?? {};
      const errMsg = d.failMsg || d.error || d.message || d.errorMessage || 'Unknown error';
      throw new Error(`KIE task ${taskId} failed (${state}): ${errMsg}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error('KIE image generation timed out after 5 minutes');
}

async function downloadToTemp(url: string, prompt: string): Promise<string> {
  const destPath = path.join(tmpDir(), genFilename(prompt));
  await downloadFile(url, destPath);
  return destPath;
}

// ---------------------------------------------------------------------------
// Multi-platform thumbnail generation
// ---------------------------------------------------------------------------

/**
 * Generate thumbnails for multiple export platforms.
 * Deduplicates aspect ratios so identical sizes are generated only once.
 */
export async function generateThumbnailsForPlatforms(
  prompt: string,
  platforms: ExportPlatform[],
  apiKey?: string,
): Promise<ThumbnailResult[]> {
  const key = getApiKey(apiKey);

  // Map each platform to its thumbnail aspect ratio
  const platformAspects = platforms.map(p => ({
    platform: p,
    aspectRatio: EXPORT_PRESETS[p].thumbnailAspect,
  }));

  // Deduplicate: generate once per unique aspect ratio
  const uniqueAspects = [...new Set(platformAspects.map(pa => pa.aspectRatio))];

  const aspectToPath = new Map<string, string>();
  for (const aspect of uniqueAspects) {
    const filePath = await generateThumbnail(prompt, aspect, key);
    aspectToPath.set(aspect, filePath);
  }

  // Build result array — each platform gets the generated image for its aspect
  return platformAspects.map(({ platform, aspectRatio }) => ({
    platform,
    aspectRatio,
    imagePath: aspectToPath.get(aspectRatio)!,
    prompt,
  }));
}

// ---------------------------------------------------------------------------
// Key-frame extraction
// ---------------------------------------------------------------------------

/**
 * Extract key frames from a video file using FFmpeg scene-change detection.
 * Returns local paths to extracted PNG frames.
 */
export async function extractKeyFrames(
  videoPath: string,
  count = 5,
): Promise<string[]> {
  const ffmpegPath = await findFfmpeg();
  if (!ffmpegPath) throw new Error('FFmpeg not found — install it or set the path');

  const outDir = path.join(tmpDir(), `keyframes_${Date.now()}`);
  await fs.promises.mkdir(outDir, { recursive: true });

  const outPattern = path.join(outDir, 'frame_%d.png');

  await execFileAsync(ffmpegPath, [
    '-i', videoPath,
    '-vf', `select='gt(scene,0.3)',scale=1280:720`,
    '-frames:v', String(count),
    '-fps_mode', 'vfn',
    outPattern,
  ], { timeout: 60_000 });

  // Collect generated frame files
  const files = await fs.promises.readdir(outDir);
  return files
    .filter(f => f.startsWith('frame_') && f.endsWith('.png'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] ?? '0', 10);
      const numB = parseInt(b.match(/\d+/)?.[0] ?? '0', 10);
      return numA - numB;
    })
    .map(f => path.join(outDir, f));
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build a thumbnail generation prompt from transcript summary and optional title.
 * The user can override this in the review modal.
 */
export function buildThumbnailPrompt(
  transcriptSummary: string,
  videoTitle?: string,
): string {
  const titlePart = videoTitle
    ? `bold text overlay saying '${videoTitle}', `
    : '';
  const topicSnippet = transcriptSummary.slice(0, 200).trim();

  return `Professional YouTube thumbnail, ${titlePart}vibrant colors, high contrast, engaging, ${topicSnippet}`;
}
