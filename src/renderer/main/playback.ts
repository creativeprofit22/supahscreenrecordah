// Post-recording playback UI — preview, export, and exit
// ---------------------------------------------------------------------------

import { screenStream } from './state';
import {
  playbackContainer, playbackVideo,
  playbackExportBtn, playbackExitBtn, playbackSkipBtn,
  processingOverlay, processingSub,
  previewContainer,
  autoTrimBtn, undoAllBtn,
  captionToggleBtn, captionStylePicker,
  srtToggleLabel, srtExportCheckbox,
} from './dom';
import { startZoomLoop } from './zoom';
import { startWaveformCapture, getSavedMicDeviceIdForRestart, clearSavedMicDeviceIdForRestart } from './overlays/waveform';
import { getPauseCutPoints } from './recording';
import {
  initReview, destroyReview, getReviewSegments, getReviewWords,
  bulkRemoveSilences, bulkRemoveFillers, bulkRemoveSilencesAndFillers,
  trimTail, trimHead, undoAll, getTrimIn, getTrimOut,
} from './review/review-controller';
import { getCaptionYFraction, getCaptionXFraction, getCaptionScale, getCaptionHighlightColor } from './review/caption-preview';
import type { PauseTimestamp } from '../../shared/types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pendingRecordingBlob: Blob | null = null;
let playbackBlobUrl: string | null = null;
let pendingPauseTimestamps: PauseTimestamp[] = [];
let selectedCaptionStyle: import('../../shared/feature-types').CaptionStylePreset | null = null;

/** Get the active caption style for preview rendering, or null if disabled. */
export function getActiveCaptionStyle(): import('../../shared/feature-types').CaptionStylePreset | null {
  return selectedCaptionStyle;
}

// ---------------------------------------------------------------------------
// Enter / exit playback mode
// ---------------------------------------------------------------------------

export async function enterPlaybackMode(blob: Blob): Promise<void> {
  console.log('[rec] enterPlaybackMode — blob size:', blob.size, 'type:', blob.type);
  pendingRecordingBlob = blob;

  // Snapshot pause cut points from the just-finished recording session
  const cutPoints = getPauseCutPoints();
  pendingPauseTimestamps = cutPoints.map((cutPoint) => ({ cutPoint }));
  if (pendingPauseTimestamps.length > 0) {
    console.log('[rec] Pause cut points:', cutPoints.map((t) => t.toFixed(3) + 's').join(', '));
  }

  // Show processing indicator
  previewContainer.style.display = 'none';
  processingSub.textContent = 'Remuxing and enhancing audio';
  processingOverlay.classList.remove('hidden');

  // Send blob to main process for remuxing (fMP4 → faststart MP4)
  try {
    processingSub.textContent = 'Converting to playback format...';
    const arrayBuffer = await blob.arrayBuffer();
    console.log('[rec] Sending buffer to preparePlayback, size:', arrayBuffer.byteLength);
    processingSub.textContent = 'Re-encoding video for preview...';
    const remuxedBuffer = await window.mainAPI.preparePlayback(arrayBuffer);
    console.log('[rec] Got remuxed buffer, size:', remuxedBuffer.byteLength);
    const remuxedBlob = new Blob([remuxedBuffer], { type: 'video/mp4' });
    playbackBlobUrl = URL.createObjectURL(remuxedBlob);
    playbackVideo.src = playbackBlobUrl;
    console.log('[rec] Set playbackVideo.src to blob URL');
  } catch (err) {
    console.warn('[rec] Playback preparation failed, falling back to blob URL:', err);
    playbackBlobUrl = URL.createObjectURL(blob);
    playbackVideo.src = playbackBlobUrl;
  }

  // Hide processing indicator
  processingOverlay.classList.add('hidden');

  // Start review analysis (waveform + transcription) in the background
  void initReview();

  // Log video events for debugging
  playbackVideo.onloadedmetadata = () => {
    console.log(
      '[rec] Video loadedmetadata — duration:', playbackVideo.duration,
      'videoWidth:', playbackVideo.videoWidth,
      'videoHeight:', playbackVideo.videoHeight,
    );
  };
  playbackVideo.onerror = () => {
    const e = playbackVideo.error;
    console.error('[rec] Video error — code:', e?.code, 'message:', e?.message);
  };
  playbackVideo.oncanplay = () => {
    console.log('[rec] Video canplay event fired');
  };

  playbackContainer.classList.remove('hidden');
}

/** Enter playback from a pre-existing buffer (e.g. last recording recovery). */
export async function enterPlaybackFromBuffer(buffer: ArrayBuffer): Promise<void> {
  console.log('[rec] enterPlaybackFromBuffer — size:', buffer.byteLength);
  const blob = new Blob([buffer], { type: 'video/mp4' });
  pendingRecordingBlob = blob;
  pendingPauseTimestamps = [];

  previewContainer.style.display = 'none';
  playbackBlobUrl = URL.createObjectURL(blob);
  playbackVideo.src = playbackBlobUrl;
  console.log('[rec] Set playbackVideo.src from last recording');

  // Start review analysis
  void initReview();

  playbackVideo.onloadedmetadata = () => {
    console.log('[rec] Last recording loaded — duration:', playbackVideo.duration);
  };
  playbackVideo.onerror = () => {
    const e = playbackVideo.error;
    console.error('[rec] Video error — code:', e?.code, 'message:', e?.message);
  };

  playbackContainer.classList.remove('hidden');
}

export function exitPlaybackMode(): void {
  destroyReview();
  playbackVideo.pause();

  if (playbackBlobUrl) {
    URL.revokeObjectURL(playbackBlobUrl);
    playbackBlobUrl = null;
  }

  playbackVideo.removeAttribute('src');
  playbackVideo.load(); // reset internal state without triggering "empty src" error

  // Clean up temp playback file on disk
  void window.mainAPI.cleanupPlayback();

  // Restore the toolbar that was hidden during review
  void window.mainAPI.showToolbar();

  pendingRecordingBlob = null;
  selectedCaptionStyle = null;
  captionToggleBtn.classList.remove('active');
  captionStylePicker.classList.add('hidden');
  captionStylePicker.querySelectorAll('.style-card').forEach(c => c.classList.remove('active'));
  srtToggleLabel.classList.add('hidden');
  srtExportCheckbox.checked = false;
  playbackContainer.classList.add('hidden');
  previewContainer.style.display = '';

  // Restore mouse tracking + zoom render loop if a screen source is active.
  if (screenStream) {
    void window.mainAPI.startMouseTracking();
    startZoomLoop();
  }

  // Restart waveform mic capture if a mic was selected before recording.
  const savedMic = getSavedMicDeviceIdForRestart();
  if (savedMic) {
    void startWaveformCapture(savedMic);
    clearSavedMicDeviceIdForRestart();
  }
}

// ---------------------------------------------------------------------------
// Button handlers
// ---------------------------------------------------------------------------

export function initPlaybackHandlers(): void {
  playbackExportBtn.addEventListener('click', () => {
    void (async () => {
      if (!pendingRecordingBlob) {
        return;
      }

      const filePath = await window.mainAPI.exportRecording();
      if (!filePath) {
        return; // user cancelled
      }

      // Show processing overlay during export
      playbackContainer.classList.add('hidden');
      processingSub.textContent = 'Preparing file for export...';
      processingOverlay.classList.remove('hidden');

      try {
        processingSub.textContent = 'Writing recording data...';
        const arrayBuffer = await pendingRecordingBlob.arrayBuffer();

        // Check if there are reviewed segments with cuts
        const reviewSegments = getReviewSegments();
        const hasDisabledSegments = reviewSegments.length > 0 && reviewSegments.some(s => !s.enabled);

        // Check if trim handles were adjusted
        const tIn = getTrimIn();
        const tOut = getTrimOut();
        const duration = playbackVideo.duration || 0;
        const hasTrim = tIn > 0.05 || (tOut < duration - 0.05 && tOut < Infinity);

        if (hasDisabledSegments || selectedCaptionStyle || hasTrim) {
          // Build keep-segments from enabled review segments, then merge adjacent ones
          const keepRaw = reviewSegments
            .filter(s => s.enabled)
            .map(s => ({ start: s.start, end: s.end }));

          // Apply trim bounds — clamp and discard segments outside trim range
          const trimmedRaw = keepRaw
            .map(s => ({
              start: Math.max(s.start, tIn),
              end: Math.min(s.end, tOut < Infinity ? tOut : duration),
            }))
            .filter(s => s.end - s.start > 0.01);

          // Merge adjacent/overlapping segments, drop zero-duration ones
          const keepSegments: Array<{ start: number; end: number }> = [];
          for (const seg of trimmedRaw) {
            const last = keepSegments[keepSegments.length - 1];
            if (last && Math.abs(seg.start - last.end) < 0.05) {
              last.end = seg.end;
            } else {
              keepSegments.push({ ...seg });
            }
          }

          // If no segments were disabled but captions are on, use one big segment
          if (keepSegments.length === 0) {
            keepSegments.push({ start: tIn, end: tOut < Infinity ? tOut : duration });
          }

          // Build caption options if a style is selected
          const captionOpts = selectedCaptionStyle ? {
            style: selectedCaptionStyle,
            words: getReviewWords(),
            resolution: {
              width: playbackVideo.videoWidth || 1920,
              height: playbackVideo.videoHeight || 1080,
            },
            exportSrt: srtExportCheckbox.checked,
            yFraction: getCaptionYFraction(),
            xFraction: getCaptionXFraction(),
            scale: getCaptionScale(),
            highlightColor: getCaptionHighlightColor() ?? undefined,
          } : undefined;

          processingSub.textContent = selectedCaptionStyle
            ? 'Cutting segments, burning captions...'
            : 'Cutting segments and enhancing audio...';
          await window.mainAPI.exportWithSegments(filePath, arrayBuffer, keepSegments, captionOpts);
        } else {
          // No review cuts — use standard export pipeline
          processingSub.textContent = 'Enhancing audio and finalizing...';
          await window.mainAPI.saveRecording(
            filePath,
            arrayBuffer,
            pendingPauseTimestamps.length > 0 ? pendingPauseTimestamps : undefined,
          );
        }

        console.log('[rec] Export complete:', filePath);
      } catch (err) {
        console.error('Failed to export recording:', err);
      }

      processingOverlay.classList.add('hidden');
      exitPlaybackMode();
    })();
  });

  playbackExitBtn.addEventListener('click', () => {
    exitPlaybackMode();
  });

  // --- Auto-trim dropdown ---------------------------------------------------
  const dropdownMenu = document.createElement('div');
  dropdownMenu.className = 'auto-trim-dropdown hidden';
  const options: Array<{ label: string; action: () => void }> = [
    { label: 'Remove silences > 2s', action: () => bulkRemoveSilences(2) },
    { label: 'Remove silences > 3s', action: () => bulkRemoveSilences(3) },
    { label: 'Remove silences > 5s', action: () => bulkRemoveSilences(5) },
    { label: 'Remove all fillers', action: () => bulkRemoveFillers() },
    { label: 'Remove silences + fillers', action: () => bulkRemoveSilencesAndFillers() },
  ];
  for (const opt of options) {
    const item = document.createElement('button');
    item.className = 'auto-trim-option';
    item.textContent = opt.label;
    item.addEventListener('click', () => {
      opt.action();
      dropdownMenu.classList.add('hidden');
    });
    dropdownMenu.appendChild(item);
  }
  autoTrimBtn.parentElement!.style.position = 'relative';
  autoTrimBtn.parentElement!.appendChild(dropdownMenu);

  autoTrimBtn.addEventListener('click', () => {
    dropdownMenu.classList.toggle('hidden');
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!autoTrimBtn.contains(e.target as Node) && !dropdownMenu.contains(e.target as Node)) {
      dropdownMenu.classList.add('hidden');
    }
  });

  // --- Undo All button -------------------------------------------------------
  undoAllBtn.addEventListener('click', () => {
    undoAll();
  });

  // --- Caption toggle + style picker -----------------------------------------
  captionToggleBtn.addEventListener('click', () => {
    const isOpen = !captionStylePicker.classList.contains('hidden');
    if (isOpen) {
      // Close picker
      captionStylePicker.classList.add('hidden');
    } else {
      // Open picker
      captionStylePicker.classList.remove('hidden');
    }
  });

  // Style card click — select/deselect
  captionStylePicker.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest('.style-card') as HTMLElement | null;
    if (!card) return;

    const style = card.dataset.style as import('../../shared/feature-types').CaptionStylePreset;

    if (selectedCaptionStyle === style) {
      // Deselect — remove captions
      selectedCaptionStyle = null;
      card.classList.remove('active');
      captionToggleBtn.classList.remove('active');
      srtToggleLabel.classList.add('hidden');
    } else {
      // Select new style
      captionStylePicker.querySelectorAll('.style-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectedCaptionStyle = style;
      captionToggleBtn.classList.add('active');
      srtToggleLabel.classList.remove('hidden');
    }
  });

  // --- Skip button — export original blob without review cuts ----------------
  playbackSkipBtn.addEventListener('click', () => {
    void skipReview();
  });

  // --- Keyboard shortcuts (active when playback container is visible) --------
  document.addEventListener('keydown', (e) => {
    if (playbackContainer.classList.contains('hidden')) return;

    // Don't capture shortcuts when focused on input elements
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (playbackVideo.paused) {
          void playbackVideo.play();
        } else {
          playbackVideo.pause();
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        playbackVideo.currentTime = Math.max(0, playbackVideo.currentTime - 5);
        break;
      case 'ArrowRight':
        e.preventDefault();
        playbackVideo.currentTime = Math.min(playbackVideo.duration, playbackVideo.currentTime + 5);
        break;
      case 'Escape':
        e.preventDefault();
        exitPlaybackMode();
        break;
      case 'Enter':
        e.preventDefault();
        playbackExportBtn.click();
        break;
    }
  });
}

async function skipReview(): Promise<void> {
  if (!pendingRecordingBlob) return;

  const filePath = await window.mainAPI.exportRecording();
  if (!filePath) return;

  playbackContainer.classList.add('hidden');
  processingSub.textContent = 'Preparing file for export...';
  processingOverlay.classList.remove('hidden');

  try {
    processingSub.textContent = 'Enhancing audio and finalizing...';
    const arrayBuffer = await pendingRecordingBlob.arrayBuffer();
    await window.mainAPI.saveRecording(
      filePath,
      arrayBuffer,
      pendingPauseTimestamps.length > 0 ? pendingPauseTimestamps : undefined,
    );
    console.log('[rec] Skip export complete:', filePath);
  } catch (err) {
    console.error('Failed to skip-export recording:', err);
  }

  processingOverlay.classList.add('hidden');
  exitPlaybackMode();
}
