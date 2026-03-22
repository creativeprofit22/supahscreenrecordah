import type { SilenceRegion } from './types';
import { buildTimestampAdjuster } from './silence';

export interface Chapter {
  start: number; // seconds
  end: number; // seconds
  headline: string;
  summary: string;
  gist: string;
}

/** Format seconds as M:SS or H:MM:SS timestamp. */
function formatTimestamp(seconds: number): string {
  const totalSec = Math.max(0, Math.floor(seconds));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Format chapters as YouTube-compatible chapter timestamps.
 *
 * YouTube requires the first chapter to start at 0:00.
 * If the first chapter doesn't start at 0, a generic "Introduction" is prepended.
 */
export function formatYouTubeChapters(chapters: Chapter[]): string {
  if (chapters.length === 0) return '';

  const lines: string[] = [];

  // YouTube requires first chapter at 0:00
  if (chapters[0].start > 1) {
    lines.push('0:00 Introduction');
  }

  for (const ch of chapters) {
    lines.push(`${formatTimestamp(ch.start)} ${ch.headline}`);
  }

  return lines.join('\n');
}

/**
 * Format chapters as SRT for embedding as chapter metadata.
 */
export function formatChaptersSRT(chapters: Chapter[]): string {
  if (chapters.length === 0) return '';

  const lines: string[] = [];

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const startTs = formatSRTTimestamp(ch.start);
    const endTs = formatSRTTimestamp(ch.end);

    lines.push(String(i + 1));
    lines.push(`${startTs} --> ${endTs}`);
    lines.push(`${ch.headline}\n${ch.summary}`);
    lines.push('');
  }

  return lines.join('\n');
}

/** Format seconds as HH:MM:SS,mmm for SRT. */
function formatSRTTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;

  return (
    `${String(h).padStart(2, '0')}:` +
    `${String(m).padStart(2, '0')}:` +
    `${String(s).padStart(2, '0')},` +
    `${String(ms).padStart(3, '0')}`
  );
}

/**
 * Adjust chapter timestamps for removed silence/filler segments.
 *
 * Uses the same timestamp shifting logic as word adjustment.
 */
export function adjustChaptersForCuts(
  chapters: Chapter[],
  cutRegions: SilenceRegion[],
): Chapter[] {
  if (cutRegions.length === 0) return chapters;

  const adjust = buildTimestampAdjuster(cutRegions);

  return chapters.map((ch) => ({
    ...ch,
    start: adjust(ch.start),
    end: adjust(ch.end),
  }));
}
