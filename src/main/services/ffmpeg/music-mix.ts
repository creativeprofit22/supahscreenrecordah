// Music Mix — merge N music cards into an exported video
// ---------------------------------------------------------------------------

import { execFile } from 'child_process';
import { promisify } from 'util';
import { findFfmpeg } from '../dependencies';
import { FFMPEG_EXEC_OPTIONS } from './encode';
import type { MusicMixOptions, MusicCard } from '../../../shared/music-types';

const execFileAsync = promisify(execFile);

function dbToLinear(db: number): number {
  if (db <= -60) return 0;
  return Math.pow(10, db / 20);
}

/**
 * Build a per-card piecewise-linear volume expression (card-local time `t`
 * since the card's atrim output, which starts at 0). Returns null for
 * constant cards so the baseline volume can be applied directly.
 */
function buildCardVolumeExpr(card: MusicCard): string | null {
  const kfs = card.keyframes;
  if (kfs.length === 0) return null;
  const sorted = kfs.slice()
    .filter(k => k.time >= 0 && k.time <= card.duration + 0.001)
    .sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return null;

  const pts = sorted.map(k => ({ t: Math.max(0, Math.min(card.duration, k.time)), gain: dbToLinear(k.db) }));
  let expr = pts[pts.length - 1].gain.toFixed(4);
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i], b = pts[i + 1];
    const dt = b.t - a.t;
    const interp = dt > 0
      ? `(${a.gain.toFixed(4)}+(${b.gain.toFixed(4)}-${a.gain.toFixed(4)})*(t-${a.t.toFixed(3)})/${dt.toFixed(3)})`
      : b.gain.toFixed(4);
    expr = `if(lt(t,${b.t.toFixed(3)}),${interp},${expr})`;
  }
  expr = `if(lt(t,${pts[0].t.toFixed(3)}),${pts[0].gain.toFixed(4)},${expr})`;
  return expr;
}

/**
 * For each card: atrim the source window, reset PTS, apply volume
 * (expression or constant), adelay to the card's videoStart. Then amix all
 * card streams together with the video's audio.
 */
function buildMusicFilter(opts: MusicMixOptions): string {
  const { cards, videoDuration, volume, fadeInSec, fadeOutSec } = opts;
  const parts: string[] = [];
  const cardLabels: string[] = [];

  const sortedCards = cards.slice().sort((a, b) => a.videoStart - b.videoStart);

  for (let i = 0; i < sortedCards.length; i++) {
    const card = sortedCards[i];
    if (card.duration <= 0.01) continue;

    let label = `c${i}_trim`;
    // 1. Trim to card's source window
    parts.push(`[1:a]atrim=${card.sourceStart.toFixed(3)}:${(card.sourceStart + card.duration).toFixed(3)},asetpts=PTS-STARTPTS[${label}]`);

    // 2. Volume (expression or constant)
    const expr = buildCardVolumeExpr(card);
    const volLabel = `c${i}_vol`;
    if (expr) {
      parts.push(`[${label}]volume=${expr}:eval=frame[${volLabel}]`);
    } else {
      parts.push(`[${label}]volume=${volume.toFixed(3)}[${volLabel}]`);
    }
    label = volLabel;

    // 3. Fade on first card (in) and last card (out)
    const isFirst = i === 0;
    const isLast = i === sortedCards.length - 1;
    const fadeFilters: string[] = [];
    if (isFirst && fadeInSec > 0) {
      fadeFilters.push(`afade=t=in:st=0:d=${Math.min(fadeInSec, card.duration).toFixed(2)}`);
    }
    if (isLast && fadeOutSec > 0) {
      const fadeStart = Math.max(0, card.duration - fadeOutSec);
      fadeFilters.push(`afade=t=out:st=${fadeStart.toFixed(2)}:d=${Math.min(fadeOutSec, card.duration).toFixed(2)}`);
    }
    if (fadeFilters.length > 0) {
      const fadeLabel = `c${i}_fade`;
      parts.push(`[${label}]${fadeFilters.join(',')}[${fadeLabel}]`);
      label = fadeLabel;
    }

    // 4. Delay to card's videoStart position
    const delayMs = Math.round(Math.max(0, card.videoStart) * 1000);
    const delayLabel = `c${i}_del`;
    if (delayMs > 0) {
      parts.push(`[${label}]adelay=${delayMs}|${delayMs}[${delayLabel}]`);
      label = delayLabel;
    }

    // 5. Pad to video duration (so each stream has matching length for mix)
    const padLabel = `c${i}_pad`;
    parts.push(`[${label}]apad=whole_dur=${videoDuration.toFixed(3)},atrim=0:${videoDuration.toFixed(3)}[${padLabel}]`);
    cardLabels.push(padLabel);
  }

  if (cardLabels.length === 0) {
    // Fallback — just pass through voice
    parts.push(`[0:a]acopy[aout]`);
    return parts.join(';\n');
  }

  // Mix voice + all card streams
  const mixInputs = ['[0:a]', ...cardLabels.map(l => `[${l}]`)].join('');
  const n = cardLabels.length + 1;
  parts.push(`${mixInputs}amix=inputs=${n}:duration=first:dropout_transition=0:normalize=0[aout]`);

  return parts.join(';\n');
}

export async function mixMusic(opts: MusicMixOptions): Promise<void> {
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) throw new Error('FFmpeg not found');

  console.log('[music-mix] ---- EXPORT START ----');
  console.log('[music-mix] videoPath:', opts.videoPath);
  console.log('[music-mix] musicPath:', opts.musicPath);
  console.log('[music-mix] outputPath:', opts.outputPath);
  console.log('[music-mix] videoDuration:', opts.videoDuration, 'musicDuration:', opts.musicDuration);
  console.log('[music-mix] volume:', opts.volume, 'fadeIn:', opts.fadeInSec, 'fadeOut:', opts.fadeOutSec);
  console.log('[music-mix] cards:', JSON.stringify(opts.cards, null, 2));

  const filterComplex = buildMusicFilter(opts);
  console.log('[music-mix] filter_complex:\n', filterComplex);

  const args = [
    '-i', opts.videoPath,
    '-i', opts.musicPath,
    '-filter_complex', filterComplex,
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-y',
    opts.outputPath,
  ];

  console.log('[music-mix] ffmpeg args:', args);

  try {
    const { stdout, stderr } = await execFileAsync(ffmpeg, args, FFMPEG_EXEC_OPTIONS);
    console.log('[music-mix] ffmpeg stdout:', stdout);
    console.log('[music-mix] ffmpeg stderr (tail):', stderr.slice(-4000));
    console.log('[music-mix] ---- EXPORT DONE ----');
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string; code?: number };
    console.error('[music-mix] ffmpeg FAILED — code:', e.code, 'message:', e.message);
    console.error('[music-mix] ffmpeg stdout:', e.stdout);
    console.error('[music-mix] ffmpeg stderr:', e.stderr);
    throw err;
  }
}
