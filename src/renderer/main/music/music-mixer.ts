// Music Mixer Controller — card-based model (split / delete / drag / trim)
// ---------------------------------------------------------------------------

import {
  musicMixer, musicAddBtn, musicTrackNameEl,
  musicVolumeSlider, musicVolumeDbInput, musicVolumeLabel,
  musicFadeInInput, musicFadeOutInput,
  musicLibraryBtn, musicTimelineCanvas, musicTimelineCtx,
  musicSkipBtn, musicExportBtn,
  musicLibraryPanel, musicLibraryList, musicLibraryClose, musicBrowseBtn,
  musicSplitBtn, musicAutoCloseToggle,
  playbackVideo, processingOverlay, processingSub,
} from '../dom';
import { renderMusicTimeline, type MusicTimelineState } from './music-timeline';
import {
  initMusicInteraction, destroyMusicInteraction,
} from './music-interaction';
import type { WaveformData } from '../../../shared/review-types';
import type { MusicTrack, MusicCard, MusicLibraryData, VolumeKeyframe } from '../../../shared/music-types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let active = false;
let destroyed = false;
let rafId: number | null = null;
let exportedVideoPath: string | null = null;

// Video state
let videoWaveform: WaveformData = { samples: [], duration: 0 };
let videoDuration = 0;

// Music state
let currentTrack: MusicTrack | null = null;
let musicWaveform: WaveformData | null = null;
let musicVolume = 0.3;
let fadeInSec = 1;
let fadeOutSec = 2;
let autoCloseGaps = false;

// Cards
let cards: MusicCard[] = [];
let selectedCardId: string | null = null;
let hoverCardId: string | null = null;
let draggingCardId: string | null = null;

// Trim
let trimHover: { cardId: string; edge: 'head' | 'tail' } | null = null;
let trimDragging: { cardId: string; edge: 'head' | 'tail' } | null = null;
let trimAnchorSnapshot: {
  cardId: string;
  videoStart: number;
  sourceStart: number;
  duration: number;
  keyframes: VolumeKeyframe[];
} | null = null;

// Keyframes (per card)
let hoverKeyframe: { cardId: string; keyframeId: string } | null = null;
let draggingKeyframe: { cardId: string; keyframeId: string } | null = null;
let envelopeDragAnchor: Array<{ cardId: string; keyframeId: string; db: number }> = [];

// Library
let library: MusicLibraryData | null = null;

// Audio preview — Web Audio API
let audioCtx: AudioContext | null = null;
let musicAudioBuffer: AudioBuffer | null = null;
// Each playing card has its own source + gain node
type PlayingCard = { cardId: string; source: AudioBufferSourceNode; gain: GainNode };
let playingCards: PlayingCard[] = [];

// Canvas sizing
let lastCanvasW = 0;
let lastCanvasH = 0;
const TIMELINE_HEIGHT = 140;

// Volume range
const MIN_DB = -60;
const MAX_DB = 6;

// Callbacks
let onComplete: (() => void) | null = null;

// ---------------------------------------------------------------------------
// dB helpers
// ---------------------------------------------------------------------------

function dbToLinear(db: number): number {
  if (db <= MIN_DB) return 0;
  return Math.pow(10, db / 20);
}
function linearToDb(lin: number): number {
  if (lin <= 0) return MIN_DB;
  return 20 * Math.log10(lin);
}
/** Plain numeric string for an <input type="number"> — no leading "+" (browsers reject it). */
function formatDbForInput(db: number): string {
  if (db <= MIN_DB) return String(MIN_DB);
  return db.toFixed(1);
}
function syncVolumeUI(): void {
  const db = linearToDb(musicVolume);
  const clampedDb = Math.max(MIN_DB, Math.min(MAX_DB, db));
  musicVolumeSlider.value = String(clampedDb);
  musicVolumeDbInput.value = formatDbForInput(clampedDb);
  musicVolumeLabel.textContent = `${Math.round(musicVolume * 100)}%`;
}

// ---------------------------------------------------------------------------
// Envelope evaluation (per card)
// ---------------------------------------------------------------------------

/** Evaluate the volume envelope in dB at a card-local time. */
function envelopeDbAtCard(card: MusicCard, cardLocalTime: number): number {
  const kfs = card.keyframes;
  if (kfs.length === 0) return linearToDb(musicVolume);
  const sorted = kfs.slice().sort((a, b) => a.time - b.time);
  if (cardLocalTime <= sorted[0].time) return sorted[0].db;
  if (cardLocalTime >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].db;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (cardLocalTime >= a.time && cardLocalTime <= b.time) {
      const dt = b.time - a.time;
      const frac = dt > 0 ? (cardLocalTime - a.time) / dt : 0;
      return a.db + frac * (b.db - a.db);
    }
  }
  return sorted[sorted.length - 1].db;
}

// ---------------------------------------------------------------------------
// Card operations
// ---------------------------------------------------------------------------

function newCardId(): string {
  return `card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function newKeyframeId(): string {
  return `kf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function getSortedCards(): MusicCard[] {
  return cards.slice().sort((a, b) => a.videoStart - b.videoStart);
}

function findCard(id: string): MusicCard | null {
  return cards.find(c => c.id === id) ?? null;
}

function cardVideoEnd(card: MusicCard): number {
  return card.videoStart + card.duration;
}

/** Determine left/right neighbors of `card` in the sorted order. */
function neighbors(card: MusicCard): { prev: MusicCard | null; next: MusicCard | null } {
  const sorted = getSortedCards();
  const i = sorted.findIndex(c => c.id === card.id);
  return { prev: i > 0 ? sorted[i - 1] : null, next: i < sorted.length - 1 ? sorted[i + 1] : null };
}

/** Clamp a proposed new videoStart so the card won't overlap its neighbors. */
function clampVideoStart(card: MusicCard, proposedStart: number): number {
  const { prev, next } = neighbors(card);
  const minStart = prev ? cardVideoEnd(prev) : 0;
  const maxEnd = next ? next.videoStart : Infinity;
  const maxStart = maxEnd - card.duration;
  return Math.max(minStart, Math.min(maxStart, proposedStart));
}

function splitCardAtVideoTime(videoTime: number): void {
  if (!currentTrack) return;
  const card = cards.find(c => videoTime > c.videoStart + 0.05 && videoTime < cardVideoEnd(c) - 0.05);
  if (!card) return; // playhead not inside any card
  const cardLocal = videoTime - card.videoStart;
  if (cardLocal <= 0.05 || cardLocal >= card.duration - 0.05) return;

  // New card B: from split point to end.
  // orig* bounds partition the parent card's original source extent so that
  // A can't trim into B's territory and vice versa.
  const splitSourceAt = card.sourceStart + cardLocal;
  const parentOrigEnd = card.origSourceStart + card.origDuration;
  const b: MusicCard = {
    id: newCardId(),
    videoStart: videoTime,
    sourceStart: splitSourceAt,
    duration: card.duration - cardLocal,
    origSourceStart: splitSourceAt,
    origDuration: parentOrigEnd - splitSourceAt,
    keyframes: [],
  };

  // Distribute keyframes
  const aKfs: VolumeKeyframe[] = [];
  for (const kf of card.keyframes) {
    if (kf.time < cardLocal) {
      aKfs.push(kf);
    } else {
      b.keyframes.push({ id: newKeyframeId(), time: kf.time - cardLocal, db: kf.db });
    }
  }
  card.keyframes = aKfs;
  card.duration = cardLocal;
  card.origDuration = splitSourceAt - card.origSourceStart;

  cards.push(b);
  selectedCardId = b.id;
  restartPlayback(); // audio needs to resync
}

function deleteCard(cardId: string): void {
  const idx = cards.findIndex(c => c.id === cardId);
  if (idx < 0) return;
  const removed = cards[idx];
  cards.splice(idx, 1);

  if (autoCloseGaps) {
    // Shift subsequent cards left by the removed duration
    for (const c of cards) {
      if (c.videoStart >= removed.videoStart) c.videoStart -= removed.duration;
    }
  }

  if (selectedCardId === cardId) selectedCardId = null;
  if (hoverCardId === cardId) hoverCardId = null;
  restartPlayback();
}

/**
 * Apply a signed delta to the head trim edge. Positive = shrink (trim more),
 * negative = extend (restore previously-trimmed audio). Clamped against:
 *   - the card's `origSourceStart` (can't expand past original head),
 *   - video-timeline 0 and the previous neighbor's tail,
 *   - a minimum remaining duration of 0.1s.
 */
function trimCardHead(cardId: string, delta: number): void {
  const card = findCard(cardId);
  if (!card) return;
  const { prev } = neighbors(card);
  const minVideoStart = prev ? cardVideoEnd(prev) : 0;
  // Most-negative allowed delta (extending head):
  //   sourceStart can go as low as origSourceStart  → minDelta = origSourceStart - sourceStart
  //   videoStart can go as low as minVideoStart     → minDelta = minVideoStart - videoStart
  //   pick whichever is less negative (tighter bound).
  const minDelta = Math.max(
    card.origSourceStart - card.sourceStart,
    minVideoStart - card.videoStart,
  );
  const maxDelta = card.duration - 0.1;
  const d = Math.max(minDelta, Math.min(maxDelta, delta));
  if (Math.abs(d) < 0.001) return;
  card.sourceStart += d;
  card.videoStart += d;
  card.duration -= d;
  // Shift keyframes by -d (card-local time origin moves). Drop any that fall
  // outside the new [0, duration] window; clamp marginal ones to the edges.
  card.keyframes = card.keyframes
    .map(k => ({ ...k, time: k.time - d }))
    .filter(k => k.time >= -0.001 && k.time <= card.duration + 0.001)
    .map(k => ({ ...k, time: Math.max(0, Math.min(card.duration, k.time)) }));
}

/**
 * Apply a signed delta to the tail trim edge. Positive = shrink, negative =
 * extend. Clamped against the card's original source end, the next neighbor,
 * the video duration, and a minimum remaining duration of 0.1s.
 */
function trimCardTail(cardId: string, delta: number): void {
  const card = findCard(cardId);
  if (!card) return;
  const { next } = neighbors(card);
  const maxVideoEnd = next ? next.videoStart : (videoDuration > 0 ? videoDuration : Infinity);
  const origSourceEnd = card.origSourceStart + card.origDuration;
  const currentSourceEnd = card.sourceStart + card.duration;
  // Most-negative allowed delta (extending tail):
  //   sourceEnd can grow up to origSourceEnd        → minDelta = currentSourceEnd - origSourceEnd
  //   videoEnd can grow up to maxVideoEnd           → minDelta = cardVideoEnd - maxVideoEnd
  const minDelta = Math.max(
    currentSourceEnd - origSourceEnd,
    cardVideoEnd(card) - maxVideoEnd,
  );
  const maxDelta = card.duration - 0.1;
  const d = Math.max(minDelta, Math.min(maxDelta, delta));
  if (Math.abs(d) < 0.001) return;
  card.duration -= d;
  card.keyframes = card.keyframes.filter(k => k.time <= card.duration + 0.001);
}

function addKeyframeToCard(cardId: string, cardLocalTime: number, db: number): string {
  const card = findCard(cardId);
  if (!card) return '';
  const clampedTime = Math.max(0, Math.min(card.duration, cardLocalTime));
  const clampedDb = Math.max(MIN_DB, Math.min(MAX_DB, db));
  const kf: VolumeKeyframe = { id: newKeyframeId(), time: clampedTime, db: clampedDb };
  card.keyframes.push(kf);
  card.keyframes.sort((a, b) => a.time - b.time);
  return kf.id;
}

function moveKeyframe(cardId: string, kfId: string, cardLocalTime: number, db: number): void {
  const card = findCard(cardId);
  if (!card) return;
  const kf = card.keyframes.find(k => k.id === kfId);
  if (!kf) return;
  kf.time = Math.max(0, Math.min(card.duration, cardLocalTime));
  kf.db = Math.max(MIN_DB, Math.min(MAX_DB, db));
  card.keyframes.sort((a, b) => a.time - b.time);
}

function deleteKeyframeFromCard(cardId: string, kfId: string): void {
  const card = findCard(cardId);
  if (!card) return;
  card.keyframes = card.keyframes.filter(k => k.id !== kfId);
  if (hoverKeyframe?.keyframeId === kfId) hoverKeyframe = null;
  if (draggingKeyframe?.keyframeId === kfId) draggingKeyframe = null;
}

/** Translate all keyframes in every card by a shared dB delta (restore semantics via anchor snapshot). */
function applyEnvelopeDelta(deltaDb: number): void {
  for (const anchor of envelopeDragAnchor) {
    const card = findCard(anchor.cardId);
    if (!card) continue;
    const kf = card.keyframes.find(k => k.id === anchor.keyframeId);
    if (kf) kf.db = Math.max(MIN_DB, Math.min(MAX_DB, anchor.db + deltaDb));
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function showMusicMixer(
  videoPath: string,
  videoWf: WaveformData,
  vidDuration: number,
  completeFn: () => void,
): Promise<void> {
  active = true;
  destroyed = false;
  exportedVideoPath = videoPath;
  videoWaveform = videoWf;
  videoDuration = vidDuration;
  onComplete = completeFn;
  cards = [];
  hoverCardId = null;
  selectedCardId = null;
  draggingCardId = null;
  trimHover = null;
  trimDragging = null;
  hoverKeyframe = null;
  draggingKeyframe = null;

  // Load library and restore last-used track + volume
  library = await window.mainAPI.getMusicLibrary();
  musicVolume = library.lastVolume;
  syncVolumeUI();
  fadeInSec = parseFloat(musicFadeInInput.value) || 1;
  fadeOutSec = parseFloat(musicFadeOutInput.value) || 2;
  autoCloseGaps = false;
  syncAutoCloseToggle();

  if (library.lastTrackId) {
    const lastTrack = library.tracks.find(t => t.id === library!.lastTrackId);
    if (lastTrack) await loadTrack(lastTrack);
  }

  musicMixer.classList.remove('hidden');

  // Pause playback so music doesn't blast on mixer open — user hits play to start
  try { playbackVideo.pause(); } catch { /* ignore */ }

  // After the src swap in playback.ts we only awaited `loadedmetadata`
  // (readyState = HAVE_METADATA). That's enough to read .duration but not
  // enough to hit play — the user would have to scrub first to trigger
  // buffering. Seek to 0 to force the decoder to prime frames, then wait
  // for `canplay` (readyState >= HAVE_FUTURE_DATA) with a timeout.
  try {
    playbackVideo.currentTime = 0;
    if (playbackVideo.readyState < 3 /* HAVE_FUTURE_DATA */) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          playbackVideo.removeEventListener('canplay', done);
          resolve();
        };
        const timer = setTimeout(done, 2000);
        playbackVideo.addEventListener('canplay', done, { once: true });
      });
    }
  } catch { /* ignore */ }

  sizeCanvas();

  initMusicInteraction({
    canvas: musicTimelineCanvas,
    getVideoDuration: () => videoDuration,
    getCards: () => cards,
    getSelectedCardId: () => selectedCardId,
    hasMusic: () => currentTrack !== null,
    getPlayhead: () => playbackVideo.currentTime,
    getVolumeBaselineDb: () => linearToDb(musicVolume),

    onSeek: (t) => { playbackVideo.currentTime = t; },
    onSelectCard: (id) => { selectedCardId = id; },
    onHoverCard: (id) => { hoverCardId = id; },

    onCardDrag: (id, newStart) => {
      const card = findCard(id);
      if (!card) return;
      card.videoStart = clampVideoStart(card, newStart);
    },
    onCardDragEnd: () => {
      draggingCardId = null;
      restartPlayback();
    },
    onCardDragStart: (id) => { draggingCardId = id; },

    onTrimStart: (cardId, edge) => {
      trimDragging = { cardId, edge };
      const card = findCard(cardId);
      if (!card) return;
      // Snapshot the card so onTrimUpdate can reset between frames and apply
      // the drag's cumulative signed delta each time. The signed delta comes
      // from the interaction layer in the anchor's coordinate frame.
      trimAnchorSnapshot = {
        cardId,
        videoStart: card.videoStart,
        sourceStart: card.sourceStart,
        duration: card.duration,
        keyframes: card.keyframes.map(k => ({ ...k })),
      };
    },
    onTrimUpdate: (cardId, edge, deltaSec) => {
      if (!trimAnchorSnapshot || trimAnchorSnapshot.cardId !== cardId) return;
      const card = findCard(cardId);
      if (!card) return;
      // Reset to anchor (so repeated frames of this drag are idempotent), then
      // apply the signed delta through the clamp-aware trim funcs. Because the
      // clamp uses orig* bounds — which did NOT shrink during the previous
      // drag — outward drags always reach back to the original head/tail.
      card.videoStart = trimAnchorSnapshot.videoStart;
      card.sourceStart = trimAnchorSnapshot.sourceStart;
      card.duration = trimAnchorSnapshot.duration;
      card.keyframes = trimAnchorSnapshot.keyframes.map(k => ({ ...k }));
      if (edge === 'head') trimCardHead(cardId, deltaSec);
      else trimCardTail(cardId, deltaSec);
    },
    onTrimEnd: () => { trimDragging = null; trimAnchorSnapshot = null; restartPlayback(); },
    onTrimHover: (cardId, edge) => {
      trimHover = cardId && edge ? { cardId, edge } : null;
    },

    onAddKeyframe: (cardId, cardLocalTime, db) => addKeyframeToCard(cardId, cardLocalTime, db),
    onMoveKeyframe: (cardId, kfId, time, db) => moveKeyframe(cardId, kfId, time, db),
    onDeleteKeyframe: (cardId, kfId) => deleteKeyframeFromCard(cardId, kfId),
    onHoverKeyframe: (cardId, kfId) => {
      hoverKeyframe = cardId && kfId ? { cardId, keyframeId: kfId } : null;
    },
    onKeyframeDragStart: (cardId, kfId) => { draggingKeyframe = { cardId, keyframeId: kfId }; },
    onKeyframeDragEnd: () => { draggingKeyframe = null; },

    onVolumeDragStart: () => {
      envelopeDragAnchor = [];
      for (const c of cards) for (const k of c.keyframes) envelopeDragAnchor.push({ cardId: c.id, keyframeId: k.id, db: k.db });
    },
    onVolumeDrag: (db, delta) => {
      musicVolume = dbToLinear(db);
      if (envelopeDragAnchor.length > 0) applyEnvelopeDelta(delta);
      syncVolumeUI();
    },
    onVolumeDragEnd: () => {
      envelopeDragAnchor = [];
      window.mainAPI.setLastMusicVolume(musicVolume);
    },
  });

  document.addEventListener('keydown', handleMusicKeydown);
  startRenderLoop();
}

export function hideMusicMixer(): void {
  active = false;
  destroyed = true;
  musicMixer.classList.add('hidden');
  musicLibraryPanel.classList.add('hidden');

  destroyMusicInteraction();
  stopAllPlayback();
  document.removeEventListener('keydown', handleMusicKeydown);

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  currentTrack = null;
  musicWaveform = null;
  musicAudioBuffer = null;
  exportedVideoPath = null;
  cards = [];
  lastCanvasW = 0;
  lastCanvasH = 0;
}

export function isMusicMixerActive(): boolean { return active; }

// ---------------------------------------------------------------------------
// Track loading
// ---------------------------------------------------------------------------

async function loadTrack(track: MusicTrack): Promise<void> {
  stopAllPlayback();
  currentTrack = track;

  musicTrackNameEl.textContent = track.name;
  musicTrackNameEl.classList.add('active');

  musicWaveform = await window.mainAPI.getMusicWaveform(track.path);
  if (musicWaveform.duration > 0) currentTrack.duration = musicWaveform.duration;

  await loadAudioBuffer(track.path);

  // Initial single card covering the whole track, starting at video 0
  const safeVideoDuration = videoDuration > 0 ? videoDuration : currentTrack.duration;
  const cardDuration = Math.min(currentTrack.duration, safeVideoDuration);
  console.log('[music-mixer] loadTrack — music:%o videoDur:%o → cardDuration:%o',
    currentTrack.duration, videoDuration, cardDuration);
  cards = [{
    id: newCardId(),
    videoStart: 0,
    sourceStart: 0,
    duration: cardDuration,
    origSourceStart: 0,
    origDuration: currentTrack.duration,
    keyframes: [],
  }];
  selectedCardId = cards[0].id;

  await window.mainAPI.setLastMusicTrack(track.id);
}

async function loadAudioBuffer(filePath: string): Promise<void> {
  try {
    const buffer = await window.mainAPI.readFileAsBuffer(filePath);
    if (!buffer) { musicAudioBuffer = null; return; }
    if (!audioCtx) audioCtx = new AudioContext();
    musicAudioBuffer = await audioCtx.decodeAudioData(buffer);
  } catch (err) {
    console.warn('[music-mixer] Failed to decode audio:', err);
    musicAudioBuffer = null;
  }
}

// ---------------------------------------------------------------------------
// Audio preview — each card plays independently in sync with video
// ---------------------------------------------------------------------------

function stopAllPlayback(): void {
  for (const p of playingCards) {
    try { p.source.stop(); } catch { /* ignore */ }
    try { p.source.disconnect(); } catch { /* ignore */ }
    try { p.gain.disconnect(); } catch { /* ignore */ }
  }
  playingCards = [];
}

function startAllPlayback(): void {
  if (!audioCtx || !musicAudioBuffer || !currentTrack) return;
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => { /* ignore */ });

  const videoTime = playbackVideo.currentTime;

  for (const card of cards) {
    const cardVideoEndTime = card.videoStart + card.duration;
    if (cardVideoEndTime <= videoTime) continue; // card already in the past

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(dbToLinear(envelopeDbAtCard(card, Math.max(0, videoTime - card.videoStart))), audioCtx.currentTime);
    gain.connect(audioCtx.destination);

    const source = audioCtx.createBufferSource();
    source.buffer = musicAudioBuffer;
    source.connect(gain);

    // When should this card's source play?
    // If videoTime < card.videoStart: schedule to start at card.videoStart, playing from sourceStart
    // If inside card: start now, from sourceStart + (videoTime - card.videoStart)
    if (videoTime < card.videoStart) {
      const delaySec = card.videoStart - videoTime;
      const startAt = audioCtx.currentTime + delaySec;
      source.start(startAt, card.sourceStart, card.duration);
    } else {
      const into = videoTime - card.videoStart;
      source.start(0, card.sourceStart + into, card.duration - into);
    }

    const playing: PlayingCard = { cardId: card.id, source, gain };
    source.onended = () => {
      playing.gain.disconnect();
      playingCards = playingCards.filter(p => p !== playing);
    };
    playingCards.push(playing);
  }
}

function restartPlayback(): void {
  if (!audioCtx || !musicAudioBuffer) return;
  const wasPlaying = !playbackVideo.paused && !playbackVideo.ended;
  stopAllPlayback();
  if (wasPlaying) startAllPlayback();
}

function syncMusicPlayback(): void {
  if (!currentTrack || !musicAudioBuffer || !audioCtx) return;
  const videoPlaying = !playbackVideo.paused && !playbackVideo.ended;

  if (videoPlaying && playingCards.length === 0) {
    startAllPlayback();
  } else if (!videoPlaying && playingCards.length > 0) {
    stopAllPlayback();
  }

  // Update per-card gain each frame
  const videoTime = playbackVideo.currentTime;
  for (const p of playingCards) {
    const card = findCard(p.cardId);
    if (!card) continue;
    const cardLocal = videoTime - card.videoStart;
    if (cardLocal < 0 || cardLocal > card.duration) continue;
    const db = envelopeDbAtCard(card, cardLocal);
    p.gain.gain.setValueAtTime(dbToLinear(db), audioCtx.currentTime);
  }
}

function handleVideoSeeked(): void {
  restartPlayback();
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function handleMusicKeydown(e: KeyboardEvent): void {
  if (!active) return;

  // Don't trap keys while typing in inputs
  const target = e.target as HTMLElement | null;
  const inInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

  if (e.code === 'Space' && !inInput) {
    e.preventDefault();
    if (playbackVideo.paused) playbackVideo.play().catch(() => { /* ignore */ });
    else playbackVideo.pause();
    return;
  }

  if (inInput) return;

  if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    splitCardAtVideoTime(playbackVideo.currentTime);
    return;
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCardId) {
    e.preventDefault();
    deleteCard(selectedCardId);
    return;
  }
}

// ---------------------------------------------------------------------------
// Library panel
// ---------------------------------------------------------------------------

function renderLibraryList(): void {
  if (!library) return;
  musicLibraryList.innerHTML = '';
  for (const track of library.tracks) {
    const item = document.createElement('div');
    item.className = 'music-library-item' + (currentTrack?.id === track.id ? ' active' : '');
    const name = document.createElement('span');
    name.className = 'music-library-item-name';
    name.textContent = track.name;
    const dur = document.createElement('span');
    dur.className = 'music-library-item-duration';
    const m = Math.floor(track.duration / 60);
    const s = Math.floor(track.duration % 60);
    dur.textContent = `${m}:${String(s).padStart(2, '0')}`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'music-library-item-remove';
    removeBtn.textContent = '\u00d7';
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.mainAPI.removeMusicTrack(track.id);
      library = await window.mainAPI.getMusicLibrary();
      renderLibraryList();
    });
    item.appendChild(name); item.appendChild(dur); item.appendChild(removeBtn);
    item.addEventListener('click', async () => {
      await loadTrack(track);
      renderLibraryList();
    });
    musicLibraryList.appendChild(item);
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function syncAutoCloseToggle(): void {
  if (autoCloseGaps) musicAutoCloseToggle.classList.add('active');
  else musicAutoCloseToggle.classList.remove('active');
}

function wireEvents(): void {
  musicAddBtn.addEventListener('click', handleAddMusic);

  musicVolumeSlider.addEventListener('input', () => {
    const db = parseFloat(musicVolumeSlider.value);
    musicVolume = dbToLinear(db);
    musicVolumeDbInput.value = formatDbForInput(db);
    musicVolumeLabel.textContent = `${Math.round(musicVolume * 100)}%`;
    window.mainAPI.setLastMusicVolume(musicVolume);
  });

  musicVolumeDbInput.addEventListener('change', () => {
    const raw = parseFloat(musicVolumeDbInput.value);
    if (isNaN(raw)) { syncVolumeUI(); return; }
    const db = Math.max(MIN_DB, Math.min(MAX_DB, raw));
    musicVolume = dbToLinear(db);
    syncVolumeUI();
    window.mainAPI.setLastMusicVolume(musicVolume);
  });

  musicVolumeDbInput.addEventListener('wheel', (e) => {
    e.preventDefault();
    const step = e.shiftKey ? 2 : 0.5;
    const current = linearToDb(musicVolume);
    const next = Math.max(MIN_DB, Math.min(MAX_DB, current - Math.sign(e.deltaY) * step));
    musicVolume = dbToLinear(next);
    syncVolumeUI();
    window.mainAPI.setLastMusicVolume(musicVolume);
  }, { passive: false });

  musicFadeInInput.addEventListener('change', () => {
    fadeInSec = parseFloat(musicFadeInInput.value) || 0;
  });
  musicFadeOutInput.addEventListener('change', () => {
    fadeOutSec = parseFloat(musicFadeOutInput.value) || 0;
  });

  musicSplitBtn.addEventListener('click', () => {
    splitCardAtVideoTime(playbackVideo.currentTime);
  });

  musicAutoCloseToggle.addEventListener('click', () => {
    autoCloseGaps = !autoCloseGaps;
    syncAutoCloseToggle();
  });

  musicLibraryBtn.addEventListener('click', async () => {
    library = await window.mainAPI.getMusicLibrary();
    renderLibraryList();
    musicLibraryPanel.classList.toggle('hidden');
  });
  musicLibraryClose.addEventListener('click', () => {
    musicLibraryPanel.classList.add('hidden');
  });
  musicBrowseBtn.addEventListener('click', handleBrowseMusic);

  musicSkipBtn.addEventListener('click', () => {
    hideMusicMixer();
    onComplete?.();
  });

  musicExportBtn.addEventListener('click', handleExportWithMusic);

  playbackVideo.addEventListener('seeked', handleVideoSeeked);
}

async function handleAddMusic(): Promise<void> {
  const filePath = await window.mainAPI.pickMusicFile();
  if (!filePath) return;
  const track = await window.mainAPI.addMusicTrack(filePath);
  if (track) {
    await loadTrack(track);
    library = await window.mainAPI.getMusicLibrary();
  }
}

async function handleBrowseMusic(): Promise<void> {
  const filePath = await window.mainAPI.pickMusicFile();
  if (!filePath) return;
  const track = await window.mainAPI.addMusicTrack(filePath);
  if (track) {
    await loadTrack(track);
    library = await window.mainAPI.getMusicLibrary();
    renderLibraryList();
  }
}

async function handleExportWithMusic(): Promise<void> {
  if (!currentTrack || !exportedVideoPath || cards.length === 0) return;

  stopAllPlayback();
  processingOverlay.classList.remove('hidden');
  processingSub.textContent = 'Mixing music...';

  try {
    await window.mainAPI.mixMusicExport({
      videoPath: exportedVideoPath,
      musicPath: currentTrack.path,
      outputPath: exportedVideoPath,
      volume: musicVolume,
      cards,
      musicDuration: currentTrack.duration,
      videoDuration,
      fadeInSec,
      fadeOutSec,
    });
  } catch (err) {
    console.error('[music-mixer] Export failed:', err);
  } finally {
    processingOverlay.classList.add('hidden');
  }

  hideMusicMixer();
  onComplete?.();
}

// ---------------------------------------------------------------------------
// Canvas + render loop
// ---------------------------------------------------------------------------

function sizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const containerW = musicTimelineCanvas.parentElement?.clientWidth ?? 600;
  const w = Math.round((containerW - 52) * dpr);
  const h = Math.round(TIMELINE_HEIGHT * dpr);
  if (w === lastCanvasW && h === lastCanvasH) return;
  lastCanvasW = w;
  lastCanvasH = h;
  musicTimelineCanvas.width = w;
  musicTimelineCanvas.height = h;
  musicTimelineCanvas.style.width = `${containerW - 52}px`;
  musicTimelineCanvas.style.height = `${TIMELINE_HEIGHT}px`;
  musicTimelineCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function startRenderLoop(): void {
  if (rafId !== null) return;

  const tick = (): void => {
    if (destroyed) { rafId = null; return; }
    sizeCanvas();
    syncMusicPlayback();

    const containerW = musicTimelineCanvas.parentElement?.clientWidth ?? 600;
    const canvasW = containerW - 52;

    const state: MusicTimelineState = {
      videoWaveform,
      musicWaveform,
      videoDuration,
      playhead: playbackVideo.currentTime,
      cards,
      selectedCardId,
      hoverCardId,
      draggingCardId,
      trimHover,
      trimDragging,
      hoverKeyframe,
      draggingKeyframe,
      musicVolumeDb: linearToDb(musicVolume),
    };

    renderMusicTimeline(musicTimelineCtx, canvasW, TIMELINE_HEIGHT, state);
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

let eventsWired = false;
export function initMusicMixerHandlers(): void {
  if (eventsWired) return;
  eventsWired = true;
  wireEvents();
}
