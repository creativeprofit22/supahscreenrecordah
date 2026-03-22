import https from 'https';
import fs from 'fs';
import type { TranscribedWord, TranscriptResult } from './types';

const API_BASE = 'api.assemblyai.com';

function getApiKey(): string {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) {
    throw new Error(
      'AssemblyAI API key required. Set ASSEMBLYAI_API_KEY environment variable.',
    );
  }
  return key;
}

/** Make an HTTPS request and return the parsed JSON response. */
function apiRequest<T>(
  method: string,
  path: string,
  apiKey: string,
  body?: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: API_BASE,
        path,
        method,
        headers: {
          authorization: apiKey,
          'content-type': 'application/json',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('error', reject);
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          try {
            const data = JSON.parse(raw) as T;
            resolve(data);
          } catch {
            reject(new Error(`Failed to parse API response: ${raw.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/** Upload a file to AssemblyAI via streaming. Returns the upload URL. */
function uploadFile(filePath: string, apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);

    const req = https.request(
      {
        hostname: API_BASE,
        path: '/v2/upload',
        method: 'POST',
        headers: {
          authorization: apiKey,
          'content-type': 'application/octet-stream',
          'transfer-encoding': 'chunked',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('error', reject);
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          try {
            const data = JSON.parse(raw) as { upload_url?: string; error?: string };
            if (data.upload_url) {
              resolve(data.upload_url);
            } else {
              reject(new Error(`Upload failed: ${data.error ?? raw.slice(0, 200)}`));
            }
          } catch {
            reject(new Error(`Failed to parse upload response: ${raw.slice(0, 200)}`));
          }
        });
      },
    );

    req.on('error', reject);
    fileStream.on('error', (err) => {
      req.destroy();
      reject(new Error(`Failed to read file: ${err.message}`));
    });
    fileStream.pipe(req);
  });
}

/** Poll transcript status until completed or error. */
async function pollTranscript(
  transcriptId: string,
  apiKey: string,
): Promise<AssemblyAITranscriptResponse> {
  const pollIntervalMs = 3000;
  const maxAttempts = 200; // ~10 minutes max

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await apiRequest<AssemblyAITranscriptResponse>(
      'GET',
      `/v2/transcript/${transcriptId}`,
      apiKey,
    );

    if (result.status === 'completed') {
      return result;
    }

    if (result.status === 'error') {
      throw new Error(`Transcription failed: ${result.error ?? 'unknown error'}`);
    }

    // status is 'queued' or 'processing'
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error('Transcription timed out after polling.');
}

interface AssemblyAIWord {
  text: string;
  start: number; // milliseconds
  end: number; // milliseconds
  confidence: number;
  speaker?: string;
}

interface AssemblyAIChapter {
  start: number; // milliseconds
  end: number; // milliseconds
  summary: string;
  headline: string;
  gist: string;
}

interface AssemblyAITranscriptResponse {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error?: string;
  text?: string;
  words?: AssemblyAIWord[];
  audio_duration?: number;
  chapters?: AssemblyAIChapter[];
}

/**
 * Transcribe a video/audio file using AssemblyAI REST API.
 *
 * Flow: upload file → create transcript → poll until done → parse results.
 */
export async function transcribe(
  videoPath: string,
  options?: { autoChapters?: boolean },
): Promise<TranscriptResult> {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Media file not found: ${videoPath}`);
  }

  const apiKey = getApiKey();
  const autoChapters = options?.autoChapters ?? true;

  // Step 1: Upload the file
  console.log('[assemblyai] Uploading file…');
  const audioUrl = await uploadFile(videoPath, apiKey);

  // Step 2: Create transcript request
  console.log('[assemblyai] Starting transcription…');
  const createBody = JSON.stringify({
    audio_url: audioUrl,
    speech_model: 'best',
    word_boost: [],
    auto_chapters: autoChapters,
    speaker_labels: true,
  });

  const created = await apiRequest<AssemblyAITranscriptResponse>(
    'POST',
    '/v2/transcript',
    apiKey,
    createBody,
  );

  if (!created.id) {
    throw new Error(
      `Failed to create transcript: ${created.error ?? 'no id returned'}`,
    );
  }

  // Step 3: Poll until completed
  console.log(`[assemblyai] Polling transcript ${created.id}…`);
  const result = await pollTranscript(created.id, apiKey);

  // Step 4: Parse into TranscriptResult
  const words: TranscribedWord[] = (result.words ?? []).map((w) => ({
    text: w.text,
    start: w.start / 1000, // ms → seconds
    end: w.end / 1000,
    confidence: w.confidence,
    speaker: w.speaker,
  }));

  const chapters = result.chapters?.map((ch) => ({
    start: ch.start / 1000,
    end: ch.end / 1000,
    summary: ch.summary,
    headline: ch.headline,
    gist: ch.gist,
  }));

  console.log(
    `[assemblyai] Transcription complete: ${words.length} words, ${(result.audio_duration ?? 0).toFixed(1)}s`,
  );

  return {
    words,
    text: result.text ?? words.map((w) => w.text).join(' '),
    duration: result.audio_duration ?? 0,
    chapters,
  };
}
