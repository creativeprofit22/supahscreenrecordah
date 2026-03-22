export interface TranscribedWord {
  text: string;
  start: number; // seconds
  end: number; // seconds
  confidence: number;
  speaker?: string;
}

export interface TranscriptResult {
  words: TranscribedWord[];
  text: string;
  duration: number;
  chapters?: Array<{
    start: number;
    end: number;
    summary: string;
    headline: string;
    gist: string;
  }>;
}

export interface SilenceRegion {
  start: number;
  end: number;
  reason: 'silence' | 'filler';
}
