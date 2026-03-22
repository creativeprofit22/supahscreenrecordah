// Click sounds — subtle audio feedback on mouse clicks and key presses
// ---------------------------------------------------------------------------
// Generates short click/tick sounds programmatically using Web Audio API.
// Connected to the recording audio pipeline so sounds are captured in output.
// ---------------------------------------------------------------------------

type ClickSoundType = 'mouse-click' | 'mouse-right' | 'key-press';

let audioCtx: AudioContext | null = null;
let outputNode: AudioNode | null = null;

/**
 * Initialise the click sounds module.
 * @param ctx — The AudioContext used for recording audio mixing
 * @param destination — The node to connect sounds to (e.g. the MediaStreamDestination
 *   that feeds the MediaRecorder, so click sounds are captured in the recording)
 */
export function initClickSounds(ctx: AudioContext, destination: AudioNode): void {
  audioCtx = ctx;
  outputNode = destination;
}

/** Tear down — called when recording stops */
export function disposeClickSounds(): void {
  audioCtx = null;
  outputNode = null;
}

/**
 * Play a subtle click/tick sound.
 * - mouse-click: short sine wave burst (1200 Hz, 30 ms, quick decay)
 * - mouse-right: slightly lower pitch (900 Hz, 30 ms)
 * - key-press: very short noise burst (20 ms) with bandpass filter for a "tick" sound
 */
export function playClickSound(type: ClickSoundType): void {
  if (!audioCtx || !outputNode) return;

  const now = audioCtx.currentTime;
  const gain = audioCtx.createGain();
  gain.connect(outputNode);

  if (type === 'key-press') {
    // Noise burst through a bandpass filter — produces a soft "tick"
    const duration = 0.02;
    const bufferSize = Math.ceil(audioCtx.sampleRate * duration);
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const bandpass = audioCtx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 3000;
    bandpass.Q.value = 1.5;

    noise.connect(bandpass);
    bandpass.connect(gain);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.start(now);
    noise.stop(now + duration);
  } else {
    // Sine wave burst — mouse click or right-click
    const freq = type === 'mouse-click' ? 1200 : 900;
    const duration = 0.03;

    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.start(now);
    osc.stop(now + duration);
  }
}
