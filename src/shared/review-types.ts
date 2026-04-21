import type { TranscribedWord } from '../main/services/assemblyai/types';

/** A segment of the recording timeline, classified by content type */
export interface ReviewSegment {
  id: string;
  start: number; // seconds
  end: number; // seconds
  type: 'silence' | 'filler' | 'speech' | 'manual';
  enabled: boolean; // true = keep, false = cut
}

/** Downsampled waveform for timeline visualization (plain array for IPC serialization) */
export interface WaveformData {
  samples: number[];
  duration: number; // seconds
}

/** Result returned from the main process analysis pipeline */
export interface ReviewAnalysisResult {
  waveform: WaveformData;
  segments: ReviewSegment[];
  words: TranscribedWord[];
}

/** Full state of the review screen UI */
export interface ReviewState {
  segments: ReviewSegment[];
  waveform: WaveformData;
  words: TranscribedWord[];
  duration: number; // seconds
  playheadPosition: number; // seconds
}

/**
 * Snapshot of the review screen's editable state — persisted to disk so
 * that cuts/trims/captions survive crashes and unexpected window closes.
 * The recording file itself is already saved separately as last-recording.mp4.
 */
export interface ReviewSession {
  /** Timestamp of the recording file this session belongs to (ms since epoch).
   *  If the file's mtime doesn't match, the session is stale and gets thrown out. */
  recordingMtime: number;
  /** Saved at (ms since epoch) — shown in the resume banner. */
  savedAt: number;
  segments: ReviewSegment[];
  waveform: WaveformData;
  words: TranscribedWord[];
  trimIn: number;
  trimOut: number | null; // null = full duration (was Infinity in memory)
  duration: number;
  captionStyle: string | null;
}
