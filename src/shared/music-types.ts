import type { WaveformData } from './review-types';

/** A saved music track in the user's library */
export interface MusicTrack {
  id: string;
  name: string;       // display name (filename without extension)
  path: string;       // absolute file path
  duration: number;   // seconds
  addedAt: number;    // Date.now() when added
}

/** A volume automation keyframe inside a card. `time` is card-local seconds (0..card.duration). */
export interface VolumeKeyframe {
  id: string;
  time: number;
  db: number;
}

/**
 * A music card = one independent clip on the music row.
 *
 * `sourceStart` + `duration` define the CURRENT window into the original
 * music file that this card plays. `videoStart` is where the card sits on
 * the video timeline. `origSourceStart` + `origDuration` define the largest
 * source window this card can occupy — trim is clamped against them so
 * dragging a trim edge back outward always restores previously-trimmed audio.
 * Splitting a card creates two cards with complementary `orig*` ranges;
 * trimming shrinks `sourceStart`/`duration` within `orig*` without touching
 * them.
 */
export interface MusicCard {
  id: string;
  videoStart: number;   // seconds on the video timeline
  sourceStart: number;  // seconds in the original music file
  duration: number;     // seconds (same in video time and source time; 1:1)
  origSourceStart: number; // immutable after creation — minimum sourceStart
  origDuration: number;    // immutable after creation — (origSourceStart + origDuration) is max sourceStart+duration
  keyframes: VolumeKeyframe[];
}

/** Legacy single-clip cut (kept as type for any migration code). */
export interface MusicCut {
  id: string;
  start: number;
  end: number;
  enabled: boolean;
}

/** Full state for the music mixer UI */
export interface MusicMixState {
  track: MusicTrack;
  waveform: WaveformData;
  cards: MusicCard[];
  volume: number;       // global baseline linear gain (0..~2)
  fadeInSec: number;    // applied to the first card
  fadeOutSec: number;   // applied to the last card
  autoCloseGaps: boolean;
}

/** Persisted music library data */
export interface MusicLibraryData {
  tracks: MusicTrack[];
  lastTrackId: string | null;
  lastVolume: number;
}

/** Options passed to the FFmpeg music mix command */
export interface MusicMixOptions {
  videoPath: string;
  musicPath: string;
  outputPath: string;
  volume: number;          // global baseline linear gain
  cards: MusicCard[];
  musicDuration: number;   // original music file duration
  videoDuration: number;
  fadeInSec: number;
  fadeOutSec: number;
}
