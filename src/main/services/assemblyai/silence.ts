import type { TranscribedWord, SilenceRegion } from './types';

const FILLER_WORDS = new Set([
  'um', 'uh', 'uhh', 'umm', 'erm',
  'like', 'you know', 'basically', 'actually', 'literally',
]);

const SINGLE_FILLER_WORDS = new Set([
  'um', 'uh', 'uhh', 'umm', 'erm',
  'like', 'basically', 'actually', 'literally',
]);

/**
 * Find gaps between words that exceed the minimum silence threshold.
 * Applies padding so cuts don't clip adjacent speech.
 */
export function detectSilences(
  words: TranscribedWord[],
  minSilenceMs: number,
  keepPaddingMs: number,
): SilenceRegion[] {
  if (words.length < 2) return [];

  const minSilenceSec = minSilenceMs / 1000;
  const paddingSec = keepPaddingMs / 1000;
  const regions: SilenceRegion[] = [];

  for (let i = 0; i < words.length - 1; i++) {
    const gapStart = words[i].end;
    const gapEnd = words[i + 1].start;
    const gap = gapEnd - gapStart;

    if (gap >= minSilenceSec) {
      const paddedStart = gapStart + paddingSec;
      const paddedEnd = gapEnd - paddingSec;
      if (paddedEnd > paddedStart) {
        regions.push({ start: paddedStart, end: paddedEnd, reason: 'silence' });
      }
    }
  }

  return regions;
}

/**
 * Find filler words ("um", "uh", "like", etc.) that are likely non-meaningful.
 *
 * Uses confidence < 0.8 as a hint that the word is a standalone filler
 * rather than part of a meaningful sentence (e.g. "I like cats" vs filler "like").
 */
export function detectFillers(words: TranscribedWord[]): SilenceRegion[] {
  const regions: SilenceRegion[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const cleaned = word.text.toLowerCase().replace(/[^\w\s]/g, '').trim();

    // Check two-word fillers first ("you know")
    if (i < words.length - 1) {
      const nextWord = words[i + 1];
      const twoWord = `${cleaned} ${nextWord.text.toLowerCase().replace(/[^\w\s]/g, '').trim()}`;
      if (FILLER_WORDS.has(twoWord)) {
        regions.push({ start: word.start, end: nextWord.end, reason: 'filler' });
        continue;
      }
    }

    // Check single-word fillers — only flag if confidence is low
    if (SINGLE_FILLER_WORDS.has(cleaned) && word.confidence < 0.8) {
      regions.push({ start: word.start, end: word.end, reason: 'filler' });
    }
  }

  return regions;
}

/**
 * Create a function that adjusts timestamps after silence/filler regions have been cut.
 *
 * For each timestamp, subtracts the total duration of all removed regions
 * that precede it. This maps original-timeline timestamps to the trimmed timeline.
 */
export function buildTimestampAdjuster(
  cutRegions: SilenceRegion[],
): (originalTime: number) => number {
  // Sort and merge cut regions (same logic as buildCutSegments)
  if (cutRegions.length === 0) {
    return (t) => t;
  }

  const sorted = [...cutRegions].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [
    { start: sorted[0].start, end: sorted[0].end },
  ];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }

  // Precompute cumulative durations for fast lookup
  const cumulativeCut: Array<{ cutEnd: number; totalRemoved: number }> = [];
  let totalRemoved = 0;

  for (const region of merged) {
    totalRemoved += region.end - region.start;
    cumulativeCut.push({ cutEnd: region.end, totalRemoved });
  }

  return (originalTime: number): number => {
    let removed = 0;
    for (const entry of cumulativeCut) {
      if (originalTime >= entry.cutEnd) {
        removed = entry.totalRemoved;
      } else {
        break;
      }
    }
    return originalTime - removed;
  };
}

/**
 * Adjust all word timestamps for a trimmed video.
 *
 * Filters out words that fall within cut regions, then shifts remaining
 * word timestamps to match the trimmed timeline.
 */
export function adjustWordsForCuts(
  words: TranscribedWord[],
  cutRegions: SilenceRegion[],
): TranscribedWord[] {
  if (cutRegions.length === 0) return words;

  const sorted = [...cutRegions].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [
    { start: sorted[0].start, end: sorted[0].end },
  ];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }

  const adjust = buildTimestampAdjuster(cutRegions);

  return words
    .filter((w) => {
      // Remove words that fall inside a cut region
      const midpoint = (w.start + w.end) / 2;
      return !merged.some((r) => midpoint >= r.start && midpoint < r.end);
    })
    .map((w) => ({
      ...w,
      start: adjust(w.start),
      end: adjust(w.end),
    }));
}

/**
 * Invert cut regions into keep segments.
 *
 * Merges overlapping regions first, then returns the complement
 * (the parts of the timeline to keep).
 */
export function buildCutSegments(
  regions: SilenceRegion[],
  duration: number,
): Array<{ start: number; end: number }> {
  if (regions.length === 0) {
    return [{ start: 0, end: duration }];
  }

  // Sort by start time
  const sorted = [...regions].sort((a, b) => a.start - b.start);

  // Merge overlapping/adjacent regions
  const merged: Array<{ start: number; end: number }> = [
    { start: sorted[0].start, end: sorted[0].end },
  ];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }

  // Invert: build keep segments from the gaps between cut regions
  const keepSegments: Array<{ start: number; end: number }> = [];
  let pos = 0;

  for (const cut of merged) {
    if (cut.start > pos) {
      keepSegments.push({ start: pos, end: cut.start });
    }
    pos = Math.max(pos, cut.end);
  }

  if (pos < duration) {
    keepSegments.push({ start: pos, end: duration });
  }

  return keepSegments;
}
