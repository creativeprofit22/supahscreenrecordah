// Post-recording playback UI — preview, export, and exit
// ---------------------------------------------------------------------------

import { screenStream } from './state';
import {
  playbackContainer, playbackVideo,
  playbackExportBtn, playbackExitBtn,
  processingOverlay, processingSub,
  previewContainer,
} from './dom';
import { startZoomLoop } from './zoom';
import { startWaveformCapture, getSavedMicDeviceIdForRestart, clearSavedMicDeviceIdForRestart } from './overlays/waveform';
import { getPauseCutPoints } from './recording';
import { initReview, destroyReview } from './review/review-controller';
import type { PauseTimestamp } from '../../shared/types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pendingRecordingBlob: Blob | null = null;
let playbackBlobUrl: string | null = null;
let pendingPauseTimestamps: PauseTimestamp[] = [];

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

  pendingRecordingBlob = null;
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
        processingSub.textContent = 'Enhancing audio and finalizing...';
        await window.mainAPI.saveRecording(
          filePath,
          arrayBuffer,
          pendingPauseTimestamps.length > 0 ? pendingPauseTimestamps : undefined,
        );
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
}
