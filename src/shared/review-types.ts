import type { TranscribedWord } from '../main/services/assemblyai/types';

/** A segment of the recording timeline, classified by content type */
export interface ReviewSegment {
  id: string;
  start: number; // seconds
  end: number; // seconds
  type: 'silence' | 'filler' | 'speech';
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
