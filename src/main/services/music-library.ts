// Music Library — persists saved tracks and last-used preferences to userData
// ---------------------------------------------------------------------------

import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { MusicTrack, MusicLibraryData } from '../../shared/music-types';

const LIBRARY_FILE = 'music-library.json';

function getLibraryPath(): string {
  return path.join(app.getPath('userData'), LIBRARY_FILE);
}

const DEFAULT_DATA: MusicLibraryData = {
  tracks: [],
  lastTrackId: null,
  lastVolume: 0.3,
};

/** Load library from disk. Returns defaults if file doesn't exist. */
export function loadLibrary(): MusicLibraryData {
  try {
    const raw = fs.readFileSync(getLibraryPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<MusicLibraryData>;
    return {
      tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
      lastTrackId: parsed.lastTrackId ?? null,
      lastVolume: typeof parsed.lastVolume === 'number' ? parsed.lastVolume : 0.3,
    };
  } catch {
    return { ...DEFAULT_DATA };
  }
}

/** Save library to disk. */
function saveLibrary(data: MusicLibraryData): void {
  try {
    fs.writeFileSync(getLibraryPath(), JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[music-library] Failed to save:', err);
  }
}

/** Add a track to the library. Returns the new MusicTrack. */
export function addTrack(filePath: string, duration: number): MusicTrack {
  const lib = loadLibrary();

  // Don't add duplicates by path
  const existing = lib.tracks.find(t => t.path === filePath);
  if (existing) {
    existing.duration = duration;
    saveLibrary(lib);
    return existing;
  }

  const track: MusicTrack = {
    id: `music-${Date.now()}`,
    name: path.basename(filePath, path.extname(filePath)),
    path: filePath,
    duration,
    addedAt: Date.now(),
  };

  lib.tracks.push(track);
  saveLibrary(lib);
  return track;
}

/** Remove a track from the library by id. */
export function removeTrack(trackId: string): void {
  const lib = loadLibrary();
  lib.tracks = lib.tracks.filter(t => t.id !== trackId);
  if (lib.lastTrackId === trackId) lib.lastTrackId = null;
  saveLibrary(lib);
}

/** Set the last-used track id. */
export function setLastTrack(trackId: string | null): void {
  const lib = loadLibrary();
  lib.lastTrackId = trackId;
  saveLibrary(lib);
}

/** Set the last-used volume. */
export function setLastVolume(volume: number): void {
  const lib = loadLibrary();
  lib.lastVolume = Math.max(0, Math.min(1, volume));
  saveLibrary(lib);
}
