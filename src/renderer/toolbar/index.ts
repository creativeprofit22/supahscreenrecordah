// Toolbar renderer — device enumeration, UI control, recording commands

import { formatTime } from '../../shared/format';
import type { ScreenSource, BgStyle, RecordingState, AspectRatio } from '../../shared/types';

/** Strip USB vendor:product hex IDs like "(2ca3:0023)" from device labels */
function cleanDeviceLabel(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*/gi, '').trim();
}

// Normal controls
const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;
const screenSelect = document.getElementById('screen-select') as HTMLSelectElement;
const layoutToggle = document.getElementById('layout-toggle') as HTMLButtonElement;
const cameraSelect = document.getElementById('camera-select') as HTMLSelectElement;
const micSelect = document.getElementById('mic-select') as HTMLSelectElement;
const editBtn = document.getElementById('edit-btn') as HTMLButtonElement;
const updateBtn = document.getElementById('update-btn') as HTMLButtonElement;
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;

// Recording controls
const recPauseBtn = document.getElementById('rec-pause-btn') as HTMLButtonElement;
const recRetryBtn = document.getElementById('rec-retry-btn') as HTMLButtonElement;
const recStopBtn = document.getElementById('rec-stop-btn') as HTMLButtonElement;
const recTimer = document.getElementById('rec-timer') as HTMLElement;

const aspectRatioSelect = document.getElementById('aspect-ratio-select') as HTMLSelectElement;
const blurBtn = document.getElementById('blur-btn') as HTMLButtonElement;
const webcamBlurBtn = document.getElementById('webcam-blur-btn') as HTMLButtonElement;

const toolbar = document.querySelector('.toolbar') as HTMLElement;

let recording = false;
let paused = false;
let blurModeActive = false;
let webcamBlurActive = false;

let screenSources: ScreenSource[] = [];
let currentLayout: BgStyle = 'camera-right';

// Timer state
let timerInterval: ReturnType<typeof setInterval> | null = null;
let timerSeconds = 0;

// ---------------------------------------------------------------------------
// Notify main window of current device selections
// ---------------------------------------------------------------------------

function sendPreviewUpdate(): void {
  // Look up the selected screen source to get its isBrowser flag
  const selectedSource = screenSources.find((s) => s.id === screenSelect.value);
  window.toolbarAPI.sendPreviewUpdate({
    screenSourceId: screenSelect.value,
    screenSourceName: selectedSource?.name,
    screenIsBrowser: selectedSource?.isBrowser ?? false,
    cameraDeviceId: cameraSelect.value || null,
    micDeviceId: micSelect.value || null,
    layout: currentLayout,
  });
}

// ---------------------------------------------------------------------------
// Persist current selections to config (by label, not ID)
// ---------------------------------------------------------------------------

function persistSelections(): void {
  const screenOpt = screenSelect.selectedOptions[0];
  const cameraOpt = cameraSelect.selectedOptions[0];
  const micOpt = micSelect.selectedOptions[0];
  window.toolbarAPI.saveConfig({
    screenName: screenOpt?.textContent ?? '',
    cameraLabel: cameraOpt?.textContent ?? '',
    micLabel: micOpt?.textContent ?? '',
    layout: currentLayout,
  });
}

// ---------------------------------------------------------------------------
// Device enumeration
// ---------------------------------------------------------------------------

async function populateDevices(): Promise<void> {
  // Load saved config first
  const config = await window.toolbarAPI.getConfig();
  currentLayout = config.layout;

  screenSources = await window.toolbarAPI.getScreens();
  screenSelect.innerHTML = '';
  for (const source of screenSources) {
    const opt = document.createElement('option');
    opt.value = source.id;
    opt.textContent = source.name;
    screenSelect.appendChild(opt);
  }

  // Restore saved screen by name
  if (config.screenName) {
    const match = screenSources.find((s) => s.name === config.screenName);
    if (match) {
      screenSelect.value = match.id;
    }
  }

  // Request a temporary audio-only stream to trigger permission prompts and
  // populate device labels.  We avoid requesting video here because opening
  // and immediately closing the camera can race with the main window's own
  // getUserMedia call, causing a "NotReadableError" on Windows.
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of tempStream.getTracks()) {
      track.stop();
    }
  } catch (err) {
    const msg = err instanceof DOMException ? `${err.name}: ${err.message}` : String(err);
    console.warn('getUserMedia (audio) failed:', msg);
  }

  // Trigger a video permission grant without opening the camera hardware.
  // On Electron the permission handler auto-approves "media", so a single
  // check is enough for enumerateDevices to return labelled video devices.
  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
    for (const track of videoStream.getTracks()) {
      track.stop();
    }
    // Give the camera hardware time to fully release before the main window
    // tries to open the same device.
    await new Promise((resolve) => setTimeout(resolve, 300));
  } catch {
    // Video permission or hardware unavailable — enumerateDevices will still
    // list devices, just potentially without labels.
  }

  const devices = await navigator.mediaDevices.enumerateDevices();

  const cameras = devices.filter((d) => d.kind === 'videoinput');
  cameraSelect.innerHTML = '';
  const noCamOpt = document.createElement('option');
  noCamOpt.value = '';
  noCamOpt.textContent = 'No camera';
  cameraSelect.appendChild(noCamOpt);
  for (const cam of cameras) {
    const opt = document.createElement('option');
    opt.value = cam.deviceId;
    opt.textContent = cleanDeviceLabel(cam.label) || `Camera ${cam.deviceId.slice(0, 8)}`;
    cameraSelect.appendChild(opt);
  }

  // Restore saved camera by label
  if (config.cameraLabel) {
    const camOpts = Array.from(cameraSelect.options);
    const match = camOpts.find((o) => o.textContent === config.cameraLabel);
    if (match) {
      cameraSelect.value = match.value;
    }
  }

  const mics = devices.filter((d) => d.kind === 'audioinput');
  micSelect.innerHTML = '';
  const noMicOpt = document.createElement('option');
  noMicOpt.value = '';
  noMicOpt.textContent = 'No microphone';
  micSelect.appendChild(noMicOpt);
  for (const mic of mics) {
    const opt = document.createElement('option');
    opt.value = mic.deviceId;
    opt.textContent = cleanDeviceLabel(mic.label) || `Microphone ${mic.deviceId.slice(0, 8)}`;
    micSelect.appendChild(opt);
  }

  // Restore saved mic by label
  if (config.micLabel) {
    const micOpts = Array.from(micSelect.options);
    const match = micOpts.find((o) => o.textContent === config.micLabel);
    if (match) {
      micSelect.value = match.value;
    }
  }

  // Restore saved aspect ratio
  if (config.overlay?.aspectRatio) {
    aspectRatioSelect.value = config.overlay.aspectRatio;
    window.toolbarAPI.sendAspectRatioUpdate(config.overlay.aspectRatio);
  }

  // Restore saved webcam blur state
  if (config.overlay?.webcamBlur) {
    webcamBlurActive = true;
    webcamBlurBtn.classList.add('active');
  }

  requestAnimationFrame(() => {
    toolbar.classList.add('visible');
  });

  sendPreviewUpdate();
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

function startTimer(): void {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
  }
  timerSeconds = 0;
  recTimer.textContent = '00:00';
  timerInterval = setInterval(() => {
    if (!paused) {
      timerSeconds++;
      recTimer.textContent = formatTime(timerSeconds);
    }
  }, 1000);
}

function stopTimer(): void {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerSeconds = 0;
}

// ---------------------------------------------------------------------------
// Countdown UI
// ---------------------------------------------------------------------------

function setCountdownUI(value: number): void {
  toolbar.classList.add('countdown');
  toolbar.classList.remove('recording');
  recTimer.textContent = `${value}...`;
}

function clearCountdownUI(): void {
  toolbar.classList.remove('countdown');
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

function setRecordingUI(isRecording: boolean, isPaused = false): void {
  recording = isRecording;
  paused = isPaused;

  if (isRecording) {
    toolbar.classList.add('recording');
  } else {
    toolbar.classList.remove('recording');
    toolbar.classList.remove('paused');
  }

  if (isPaused) {
    toolbar.classList.add('paused');
    recPauseBtn.classList.add('active');
    recPauseBtn.title = 'Resume';
  } else {
    toolbar.classList.remove('paused');
    recPauseBtn.classList.remove('active');
    recPauseBtn.title = 'Pause';
  }
}

// ---------------------------------------------------------------------------
// Recording controls — sends commands via IPC; main window handles recording
// ---------------------------------------------------------------------------

async function handleStartRecording(): Promise<void> {
  const screenSourceId = screenSelect.value;
  const cameraDeviceId = cameraSelect.value || null;
  const micDeviceId = micSelect.value || null;

  const options = {
    screenSourceId,
    cameraDeviceId,
    micDeviceId,
  };

  try {
    await window.toolbarAPI.startRecording(options);
  } catch (err) {
    console.error('Failed to start recording:', err);
  }
}

async function handleStopRecording(): Promise<void> {
  try {
    await window.toolbarAPI.stopRecording();
  } catch (err) {
    console.error('Failed to stop recording:', err);
  }
}

async function handlePauseResume(): Promise<void> {
  if (paused) {
    await window.toolbarAPI.resumeRecording();
  } else {
    await window.toolbarAPI.pauseRecording();
  }
}

async function handleRetry(): Promise<void> {
  const confirmed = window.confirm(
    'Restart recording? The current recording will be discarded.',
  );
  if (!confirmed) {
    return;
  }

  // Stop current recording (discard — don't save)
  try {
    await window.toolbarAPI.stopRecording();
  } catch (err) {
    console.error('Failed to stop recording for retry:', err);
  }

  // Wait for the toolbar state to reflect that recording has stopped.
  // The stop is async across multiple IPC hops (toolbar → main → renderer →
  // MediaRecorder.onstop → cleanup). A fixed delay is unreliable under load,
  // so we poll the actual recording state instead.
  const maxWaitMs = 3000;
  const pollMs = 50;
  let waited = 0;
  while (recording && waited < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    waited += pollMs;
  }

  // Start a new recording with the same settings
  try {
    await handleStartRecording();
  } catch (err) {
    console.error('Failed to restart recording after retry:', err);
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

recordBtn.addEventListener('click', () => {
  void handleStartRecording();
});

recStopBtn.addEventListener('click', () => {
  void handleStopRecording();
});

recPauseBtn.addEventListener('click', () => {
  void handlePauseResume();
});

recRetryBtn.addEventListener('click', () => {
  void handleRetry();
});

screenSelect.addEventListener('change', () => {
  sendPreviewUpdate();
  persistSelections();
});

cameraSelect.addEventListener('change', () => {
  sendPreviewUpdate();
  persistSelections();
});

micSelect.addEventListener('change', () => {
  sendPreviewUpdate();
  persistSelections();
});

layoutToggle.addEventListener('click', () => {
  currentLayout = currentLayout === 'camera-right' ? 'camera-left' : 'camera-right';
  sendPreviewUpdate();
  persistSelections();
});

aspectRatioSelect.addEventListener('change', () => {
  const ratio = aspectRatioSelect.value as AspectRatio;
  window.toolbarAPI.sendAspectRatioUpdate(ratio);
  // Persist into overlay config
  window.toolbarAPI.saveConfig({ overlay: { aspectRatio: ratio } } as any);
});

window.toolbarAPI.onStateUpdate((state: RecordingState) => {
  // Handle countdown state
  if (state.countdownValue != null) {
    setCountdownUI(state.countdownValue);
    return;
  }

  // Countdown just finished and recording started
  if (state.isRecording && !recording) {
    clearCountdownUI();
    startTimer();
  } else if (!state.isRecording && recording) {
    stopTimer();
  }
  setRecordingUI(state.isRecording, state.isPaused);
});

// ---------------------------------------------------------------------------
// Blur regions toggle
// ---------------------------------------------------------------------------

blurBtn.addEventListener('click', () => {
  blurModeActive = !blurModeActive;
  if (blurModeActive) {
    blurBtn.classList.add('active');
  } else {
    blurBtn.classList.remove('active');
  }
  window.toolbarAPI.toggleBlurMode();
});

// ---------------------------------------------------------------------------
// Webcam background blur toggle
// ---------------------------------------------------------------------------

webcamBlurBtn.addEventListener('click', () => {
  webcamBlurActive = !webcamBlurActive;
  if (webcamBlurActive) {
    webcamBlurBtn.classList.add('active');
  } else {
    webcamBlurBtn.classList.remove('active');
  }
  window.toolbarAPI.toggleWebcamBlur();
});

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------

editBtn.addEventListener('click', () => {
  void window.toolbarAPI.openEditModal();
});

// ---------------------------------------------------------------------------
// Close button
// ---------------------------------------------------------------------------

closeBtn.addEventListener('click', () => {
  window.toolbarAPI.quitApp();
});

// ---------------------------------------------------------------------------
// Live device refresh — update dropdowns when devices are added / removed
// ---------------------------------------------------------------------------

async function refreshMediaDevices(): Promise<void> {
  const devices = await navigator.mediaDevices.enumerateDevices();

  // Preserve current selections
  const prevCamera = cameraSelect.value;
  const prevMic = micSelect.value;

  // Cameras
  const cameras = devices.filter((d) => d.kind === 'videoinput');
  cameraSelect.innerHTML = '';
  const noCamOpt = document.createElement('option');
  noCamOpt.value = '';
  noCamOpt.textContent = 'No camera';
  cameraSelect.appendChild(noCamOpt);
  for (const cam of cameras) {
    const opt = document.createElement('option');
    opt.value = cam.deviceId;
    opt.textContent = cleanDeviceLabel(cam.label) || `Camera ${cam.deviceId.slice(0, 8)}`;
    cameraSelect.appendChild(opt);
  }

  // Restore previous camera if still available
  const camStillExists = Array.from(cameraSelect.options).some((o) => o.value === prevCamera);
  cameraSelect.value = camStillExists ? prevCamera : '';

  // Mics
  const mics = devices.filter((d) => d.kind === 'audioinput');
  micSelect.innerHTML = '';
  const noMicOpt = document.createElement('option');
  noMicOpt.value = '';
  noMicOpt.textContent = 'No microphone';
  micSelect.appendChild(noMicOpt);
  for (const mic of mics) {
    const opt = document.createElement('option');
    opt.value = mic.deviceId;
    opt.textContent = cleanDeviceLabel(mic.label) || `Microphone ${mic.deviceId.slice(0, 8)}`;
    micSelect.appendChild(opt);
  }

  // Restore previous mic if still available
  const micStillExists = Array.from(micSelect.options).some((o) => o.value === prevMic);
  micSelect.value = micStillExists ? prevMic : '';

  // If selections changed (device removed), notify main window
  if (cameraSelect.value !== prevCamera || micSelect.value !== prevMic) {
    sendPreviewUpdate();
    persistSelections();
  }
}

navigator.mediaDevices.addEventListener('devicechange', () => {
  void refreshMediaDevices();
});

// ---------------------------------------------------------------------------
// Update checker
// ---------------------------------------------------------------------------

let updateUrl = '';

async function checkForUpdate(): Promise<void> {
  try {
    const result = await window.toolbarAPI.checkForUpdate();
    if (result.available) {
      updateUrl = result.url;
      updateBtn.style.display = 'flex';
      updateBtn.title = `Update available: v${result.version}`;
    }
  } catch (err) {
    console.warn('Update check failed:', err);
  }
}

updateBtn.addEventListener('click', () => {
  if (updateUrl) {
    void window.toolbarAPI.openUrl(updateUrl);
  }
});

// ---------------------------------------------------------------------------
// Chapters ready
// ---------------------------------------------------------------------------

window.toolbarAPI.onChaptersReady((chapters) => {
  console.log(`[toolbar] ${chapters.length} chapters ready (copied to clipboard)`);
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  void populateDevices().then(() => {
    void checkForUpdate();
  });
});
