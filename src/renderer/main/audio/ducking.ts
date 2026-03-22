// Audio ducking — automatically lower system/screen audio when mic detects speech.
// Uses a Web Audio AnalyserNode on the mic source to monitor RMS level.
// When speech is detected (RMS exceeds threshold), the system audio gain is
// smoothly ramped down. When speech stops for a release period, gain ramps back up.

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** RMS threshold in linear amplitude — roughly -40 dB (10^(-40/20) ≈ 0.01) */
const SPEECH_THRESHOLD = 0.01;

/** Attack time — how fast system audio ducks when speech starts (seconds) */
const ATTACK_TIME = 0.1;

/** Release time — how fast system audio restores after speech stops (seconds) */
const RELEASE_TIME = 0.5;

/** How long (ms) mic must be quiet before starting release ramp */
const RELEASE_HOLD_MS = 500;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let analyser: AnalyserNode | null = null;
let systemGainNode: GainNode | null = null;
let audioCtx: AudioContext | null = null;
let duckLevel = 0.3;
let normalLevel = 1.0;
let isDucking = false;
let releaseTimer: number | null = null;
let animFrameId: number | null = null;
let analyserBuffer: Float32Array<ArrayBuffer> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise audio ducking.
 *
 * @param ctx           The recording AudioContext
 * @param micSource     MediaStreamAudioSourceNode for the mic (read-only tap)
 * @param gainNode      The GainNode controlling system/screen audio volume
 */
export function initDucking(
  ctx: AudioContext,
  micSource: MediaStreamAudioSourceNode,
  gainNode: GainNode,
): void {
  disposeDucking();

  audioCtx = ctx;
  systemGainNode = gainNode;

  // Create analyser on the mic source — does not modify the mic signal
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.3;
  micSource.connect(analyser);

  analyserBuffer = new Float32Array(analyser.fftSize);

  // Start the monitoring loop
  monitorLoop();
}

/** Tear down ducking — disconnect analyser, cancel animation frame */
export function disposeDucking(): void {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (releaseTimer !== null) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  if (analyser) {
    analyser.disconnect();
    analyser = null;
  }
  // Restore gain to normal before disposing
  if (systemGainNode && audioCtx) {
    systemGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
    systemGainNode.gain.setValueAtTime(normalLevel, audioCtx.currentTime);
  }
  systemGainNode = null;
  audioCtx = null;
  analyserBuffer = null;
  isDucking = false;
}

/** Set the ducked volume level (0–1). Default is 0.3 (30%). */
export function setDuckLevel(level: number): void {
  duckLevel = Math.max(0, Math.min(1, level));
}

/** Set the normal (un-ducked) volume level (0–1). Default is 1.0. */
export function setNormalLevel(level: number): void {
  normalLevel = Math.max(0, Math.min(1, level));
}

// ---------------------------------------------------------------------------
// Internal monitoring loop
// ---------------------------------------------------------------------------

function monitorLoop(): void {
  if (!analyser || !analyserBuffer || !systemGainNode || !audioCtx) {
    return;
  }

  // Read time-domain data from mic analyser
  analyser.getFloatTimeDomainData(analyserBuffer);

  // Compute RMS (root mean square) of the mic signal
  let sumSquares = 0;
  for (let i = 0; i < analyserBuffer.length; i++) {
    const sample = analyserBuffer[i];
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / analyserBuffer.length);

  const now = audioCtx.currentTime;

  if (rms > SPEECH_THRESHOLD) {
    // Speech detected — duck system audio
    if (releaseTimer !== null) {
      clearTimeout(releaseTimer);
      releaseTimer = null;
    }

    if (!isDucking) {
      isDucking = true;
      systemGainNode.gain.cancelScheduledValues(now);
      systemGainNode.gain.setValueAtTime(systemGainNode.gain.value, now);
      systemGainNode.gain.linearRampToValueAtTime(duckLevel, now + ATTACK_TIME);
    }
  } else {
    // Mic is quiet — schedule release after hold period
    if (isDucking && releaseTimer === null) {
      releaseTimer = window.setTimeout(() => {
        releaseTimer = null;
        if (systemGainNode && audioCtx) {
          const t = audioCtx.currentTime;
          isDucking = false;
          systemGainNode.gain.cancelScheduledValues(t);
          systemGainNode.gain.setValueAtTime(systemGainNode.gain.value, t);
          systemGainNode.gain.linearRampToValueAtTime(normalLevel, t + RELEASE_TIME);
        }
      }, RELEASE_HOLD_MS);
    }
  }

  // Continue monitoring
  animFrameId = requestAnimationFrame(monitorLoop);
}
