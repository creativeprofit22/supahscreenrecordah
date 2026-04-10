// Webcam background blur using MediaPipe ImageSegmenter
// Uses "selfie_segmenter" (general, 256×256) for vertical layouts and
// "selfie_segmenter_landscape" (144×256) for landscape — the general model
// provides better mask quality when the webcam is cropped to a portrait zone.
// ---------------------------------------------------------------------------

import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';

const MODEL_LANDSCAPE =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite';
const MODEL_GENERAL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

let segmenter: ImageSegmenter | null = null;
let currentModelPortrait = false; // tracks which model is loaded
let blurCanvas: OffscreenCanvas | null = null;
let blurCtx: OffscreenCanvasRenderingContext2D | null = null;
let compCanvas: OffscreenCanvas | null = null;
let compCtx: OffscreenCanvasRenderingContext2D | null = null;
let maskCanvas: OffscreenCanvas | null = null;
let maskCtx: OffscreenCanvasRenderingContext2D | null = null;
let lastMask: Float32Array | null = null;
let frameCounter = 0;
let initPromise: Promise<void> | null = null;

/** Whether the segmenter loaded successfully and is ready to process frames. */
export function isSegmenterReady(): boolean {
  return segmenter !== null;
}

// ---------------------------------------------------------------------------
// Initialise MediaPipe ImageSegmenter
// ---------------------------------------------------------------------------

/**
 * Initialise the segmenter. Pass `portrait = true` for vertical/shorts
 * layouts — this uses the general model (256×256) which gives better mask
 * edges when the webcam feed is cropped to a tall region.
 */
export function initWebcamBlur(portrait = false): Promise<void> {
  // Already loaded with the correct model — nothing to do
  if (segmenter && currentModelPortrait === portrait) return Promise.resolve();

  // Model mismatch — dispose the old one so we reload with the right model
  if (segmenter && currentModelPortrait !== portrait) {
    segmenter.close();
    segmenter = null;
    lastMask = null;
  }

  // If already initializing, return the shared promise so all callers wait
  if (initPromise) return initPromise;

  const modelPath = portrait ? MODEL_GENERAL : MODEL_LANDSCAPE;

  initPromise = (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.33/wasm',
      );

      segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });

      currentModelPortrait = portrait;
      const modelName = portrait ? 'selfie_segmenter (general)' : 'selfie_segmenter_landscape';
      console.log(`[webcam-blur] MediaPipe ImageSegmenter initialised — model: ${modelName}`);
    } catch (err) {
      console.error('[webcam-blur] Failed to init segmenter:', err);
      segmenter = null;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

// ---------------------------------------------------------------------------
// Ensure offscreen canvases match the video dimensions
// ---------------------------------------------------------------------------

function ensureCanvases(w: number, h: number): void {
  if (!blurCanvas || blurCanvas.width !== w || blurCanvas.height !== h) {
    blurCanvas = new OffscreenCanvas(w, h);
    blurCtx = blurCanvas.getContext('2d', { willReadFrequently: false }) as OffscreenCanvasRenderingContext2D;
    compCanvas = new OffscreenCanvas(w, h);
    compCtx = compCanvas.getContext('2d', { willReadFrequently: false }) as OffscreenCanvasRenderingContext2D;
    maskCanvas = new OffscreenCanvas(w, h);
    maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  }
}

// ---------------------------------------------------------------------------
// Process a single video frame → returns composited canvas (or null)
// ---------------------------------------------------------------------------

export function processBlurFrame(
  cameraVideo: HTMLVideoElement,
  blurIntensity: number = 30,
): OffscreenCanvas | null {
  if (!segmenter) return null;

  const w = cameraVideo.videoWidth;
  const h = cameraVideo.videoHeight;
  if (!w || !h) return null;

  ensureCanvases(w, h);
  if (!blurCtx || !compCtx || !maskCtx || !blurCanvas || !compCanvas || !maskCanvas) return null;

  // Run segmentation every other frame for performance (15fps mask, 30fps draw)
  frameCounter++;
  const shouldSegment = frameCounter % 2 === 0 || !lastMask;

  if (shouldSegment) {
    try {
      const results = segmenter.segmentForVideo(cameraVideo, performance.now());
      if (results.confidenceMasks && results.confidenceMasks.length > 0) {
        const mask = results.confidenceMasks[0];
        const maskData = mask.getAsFloat32Array();
        // Copy mask data — it's invalidated after close()
        if (!lastMask || lastMask.length !== maskData.length) {
          lastMask = new Float32Array(maskData.length);
        }
        lastMask.set(maskData);
        mask.close();
      }
      if (results.confidenceMasks) {
        for (let i = 1; i < results.confidenceMasks.length; i++) {
          results.confidenceMasks[i].close();
        }
      }
    } catch {
      // Segmentation failed this frame — use previous mask
    }
  }

  if (!lastMask) return null;

  // 1. Draw blurred background on blurCanvas
  blurCtx.filter = `blur(${blurIntensity}px)`;
  blurCtx.drawImage(cameraVideo, 0, 0, w, h);
  blurCtx.filter = 'none';

  // 2. Build a mask image from the segmentation confidence values
  const maskImgData = maskCtx.createImageData(w, h);
  const pixels = maskImgData.data;
  // The mask has the same dimensions as the model input, which may differ from
  // the video. We need to map mask pixels to video pixels.
  const maskW = Math.round(Math.sqrt(lastMask.length * (w / h)));
  const maskH = Math.round(lastMask.length / maskW);

  for (let y = 0; y < h; y++) {
    const my = Math.min(Math.floor(y * maskH / h), maskH - 1);
    for (let x = 0; x < w; x++) {
      const mx = Math.min(Math.floor(x * maskW / w), maskW - 1);
      const confidence = lastMask[my * maskW + mx];
      const idx = (y * w + x) * 4;
      // confidence = 1 means person, 0 means background
      const alpha = Math.round(confidence * 255);
      pixels[idx] = 255;
      pixels[idx + 1] = 255;
      pixels[idx + 2] = 255;
      pixels[idx + 3] = alpha;
    }
  }
  maskCtx.putImageData(maskImgData, 0, 0);

  // 3. Composite: sharp person (masked by segmentation) over blurred background
  compCtx.clearRect(0, 0, w, h);

  // Step A: Draw sharp camera frame
  compCtx.globalCompositeOperation = 'source-over';
  compCtx.drawImage(cameraVideo, 0, 0, w, h);

  // Step B: Clip to person only using destination-in
  compCtx.globalCompositeOperation = 'destination-in';
  compCtx.drawImage(maskCanvas, 0, 0);

  // Step C: Draw blurred background behind the sharp person
  compCtx.globalCompositeOperation = 'destination-over';
  compCtx.drawImage(blurCanvas, 0, 0);

  compCtx.globalCompositeOperation = 'source-over';

  return compCanvas;
}

// ---------------------------------------------------------------------------
// Preview blur — renders blurred frames onto a visible <canvas> overlay
// ---------------------------------------------------------------------------

let previewCanvas: HTMLCanvasElement | null = null;
let previewCtx: CanvasRenderingContext2D | null = null;
let previewRafId: number | null = null;
let previewVideo: HTMLVideoElement | null = null;
let previewIntensity = 30;

export function startPreviewBlur(
  cameraVideo: HTMLVideoElement,
  container: HTMLElement,
  intensity: number = 30,
): void {
  previewVideo = cameraVideo;
  previewIntensity = intensity;

  if (!previewCanvas) {
    previewCanvas = document.createElement('canvas');
    previewCanvas.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;border-radius:inherit;pointer-events:none;z-index:1;';
    container.style.position = 'relative';
    container.appendChild(previewCanvas);
  }

  // Size canvas to match container
  const rect = container.getBoundingClientRect();
  previewCanvas.width = Math.round(rect.width * devicePixelRatio);
  previewCanvas.height = Math.round(rect.height * devicePixelRatio);
  previewCtx = previewCanvas.getContext('2d')!;

  // Hide the raw video — the canvas replaces it visually
  cameraVideo.style.opacity = '0';

  if (!previewRafId) {
    renderPreviewLoop();
  }
}

function renderPreviewLoop(): void {
  previewRafId = requestAnimationFrame(() => {
    if (!previewVideo || !previewCtx || !previewCanvas) {
      previewRafId = null;
      return;
    }

    const result = processBlurFrame(previewVideo, previewIntensity);
    if (result) {
      const cw = previewCanvas.width;
      const ch = previewCanvas.height;
      previewCtx.clearRect(0, 0, cw, ch);

      // Mirror + object-fit: cover crop
      const natW = previewVideo.videoWidth;
      const natH = previewVideo.videoHeight;
      const drawAspect = cw / ch;
      const vidAspect = natW / natH;
      let sx: number, sy: number, sw: number, sh: number;
      if (vidAspect > drawAspect) {
        sh = natH;
        sw = sh * drawAspect;
        sx = (natW - sw) / 2;
        sy = 0;
      } else {
        sw = natW;
        sh = sw / drawAspect;
        sx = 0;
        sy = (natH - sh) / 2;
      }

      previewCtx.save();
      previewCtx.translate(cw, 0);
      previewCtx.scale(-1, 1);
      previewCtx.drawImage(result, sx, sy, sw, sh, 0, 0, cw, ch);
      previewCtx.restore();
    }

    renderPreviewLoop();
  });
}

export function stopPreviewBlur(): void {
  if (previewRafId) {
    cancelAnimationFrame(previewRafId);
    previewRafId = null;
  }
  if (previewCanvas && previewCanvas.parentNode) {
    previewCanvas.parentNode.removeChild(previewCanvas);
  }
  previewCanvas = null;
  previewCtx = null;
  if (previewVideo) {
    previewVideo.style.opacity = '';
    previewVideo = null;
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function disposeWebcamBlur(): void {
  stopPreviewBlur();

  if (segmenter) {
    segmenter.close();
    segmenter = null;
  }
  currentModelPortrait = false;
  blurCanvas = null;
  blurCtx = null;
  compCanvas = null;
  compCtx = null;
  maskCanvas = null;
  maskCtx = null;
  lastMask = null;
  frameCounter = 0;
}
