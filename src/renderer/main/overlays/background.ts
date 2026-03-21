// Background effects — ambient particles + mesh blob gradient

import { bgCanvas, bgCtx, previewContainer } from '../dom';
import {
  ambientParticlesEnabled, activeBgStyle, bgColor,
  setAmbientParticlesEnabled, setActiveBgStyle, setBgColor,
} from '../state';

// Re-export setters so consumers can reach them via this module
export { setAmbientParticlesEnabled, setActiveBgStyle, setBgColor };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Particle {
  x: number; y: number; life: number; ttl: number;
  speed: number; size: number; hue: number; vx: number; vy: number;
}

interface MeshBlob {
  phase: number; speed: number; hueShift: number; size: number;
  orbitRx: number; orbitRy: number; cx: number; cy: number;
  satAdj: number; litAdj: number;
}

// ---------------------------------------------------------------------------
// Ambient particle constants
// ---------------------------------------------------------------------------
const PARTICLE_COUNT = 60;
const PARTICLE_BASE_TTL = 200;
const PARTICLE_RANGE_TTL = 400;
const PARTICLE_BASE_SPEED = 0.004;
const PARTICLE_RANGE_SPEED = 0.008;
const PARTICLE_BASE_SIZE = 1.5;
const PARTICLE_RANGE_SIZE = 4;
const PARTICLE_BASE_HUE = 200;   // cool blue-ish centre
const PARTICLE_RANGE_HUE = 60;   // spread toward warm/cool

// ---------------------------------------------------------------------------
// Ambient particle state
// ---------------------------------------------------------------------------
let ambientParticles: Particle[] = [];
let particleOffscreen: OffscreenCanvas | null = null;
let particleOffCtx: OffscreenCanvasRenderingContext2D | null = null;

// ---------------------------------------------------------------------------
// Mesh blob constants & state
// ---------------------------------------------------------------------------
const MESH_DOWNSCALE = 4;

let meshBlobs: MeshBlob[] = [];
let meshBlobsColor = '';  // tracks which bgColor the blobs were generated for
let meshOffscreen: OffscreenCanvas | null = null;
let meshOffCtx: OffscreenCanvasRenderingContext2D | null = null;
let meshStartTime = 0;

// ---------------------------------------------------------------------------
// Background animation loop state
// ---------------------------------------------------------------------------
let lastBgParticleTime = performance.now();
let particleLoopFrame = 0;

// We need a reference to zoomAnimFrame to avoid duplicate loops. The zoom
// module should call `setZoomAnimFrameRef` to hand us a getter.
let getZoomAnimFrame: () => number = () => 0;

/** Allow the zoom module to provide its animation-frame reference. */
export function setZoomAnimFrameRef(getter: () => number): void {
  getZoomAnimFrame = getter;
}

// ---------------------------------------------------------------------------
// Ambient particles
// ---------------------------------------------------------------------------

/** Fade-in then fade-out based on life/ttl (0→1→0) */
function fadeInOut(life: number, ttl: number): number {
  const half = ttl * 0.5;
  return life < half ? life / half : (ttl - life) / half;
}

function initParticle(p: Particle): void {
  p.x = Math.random();
  p.y = Math.random();
  p.life = 0;
  p.ttl = PARTICLE_BASE_TTL + Math.random() * PARTICLE_RANGE_TTL;
  p.speed = PARTICLE_BASE_SPEED + Math.random() * PARTICLE_RANGE_SPEED;
  p.size = PARTICLE_BASE_SIZE + Math.random() * PARTICLE_RANGE_SIZE;
  p.hue = PARTICLE_BASE_HUE + (Math.random() - 0.5) * PARTICLE_RANGE_HUE;
  const angle = Math.random() * Math.PI * 2;
  p.vx = Math.cos(angle) * p.speed;
  p.vy = Math.sin(angle) * p.speed - 0.003; // gentle upward bias
}

export function initAmbientParticles(): void {
  ambientParticles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const p: Particle = {
      x: 0, y: 0, life: 0, ttl: 0,
      speed: 0, size: 0, hue: 0, vx: 0, vy: 0,
    };
    initParticle(p);
    // Scatter initial life so they don't all fade in at once
    p.life = Math.random() * p.ttl;
    ambientParticles.push(p);
  }
}

export function updateAmbientParticles(dt: number): void {
  for (const p of ambientParticles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life++;
    // Respawn when TTL expires or particle drifts off-screen
    if (p.life > p.ttl || p.x < -0.1 || p.x > 1.1 || p.y < -0.1 || p.y > 1.1) {
      initParticle(p);
    }
  }
}

/**
 * Draw ambient particles using the dual-canvas glow technique.
 * Draws tiny bright dots to an offscreen canvas, then composites with
 * additive blending + blur for a natural soft bokeh glow.
 */
export function drawAmbientParticles(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number): void {
  if (!ambientParticlesEnabled || ambientParticles.length === 0) {
    return;
  }
  if (w <= 0 || h <= 0) {
    return;
  }
  // Lazily create or resize offscreen canvas
  if (!particleOffscreen || particleOffscreen.width !== w || particleOffscreen.height !== h) {
    particleOffscreen = new OffscreenCanvas(w, h);
    particleOffCtx = particleOffscreen.getContext('2d');
  }
  if (!particleOffCtx) {
    return;
  }
  // Clear offscreen
  particleOffCtx.clearRect(0, 0, w, h);
  // Draw raw particle dots on offscreen canvas
  for (const p of ambientParticles) {
    const alpha = fadeInOut(p.life, p.ttl) * 0.6;
    if (alpha <= 0) {
      continue;
    }
    const px = p.x * w;
    const py = p.y * h;
    const r = p.size * (h / 1080);
    particleOffCtx.beginPath();
    particleOffCtx.arc(px, py, r, 0, Math.PI * 2);
    particleOffCtx.fillStyle = `hsla(${p.hue}, 60%, 80%, ${alpha})`;
    particleOffCtx.fill();
  }
  // Composite: glow pass (blur + additive blend)
  ctx.save();
  ctx.filter = 'blur(12px) brightness(180%)';
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(particleOffscreen, 0, 0);
  ctx.restore();
  // Composite: sharp pass (additive blend, no blur — keeps dot cores visible)
  ctx.save();
  ctx.filter = 'blur(4px) brightness(140%)';
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(particleOffscreen, 0, 0);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Mesh gradient background
// ---------------------------------------------------------------------------

/** Parse hex color to HSL. Returns [h, s, l] with h in degrees, s/l in 0–100. */
export function hexToHSL(hex: string): [number, number, number] {
  const h6 = hex.replace('#', '');
  let r: number;
  let g: number;
  let b: number;
  if (h6.length === 3) {
    r = parseInt(h6[0] + h6[0], 16);
    g = parseInt(h6[1] + h6[1], 16);
    b = parseInt(h6[2] + h6[2], 16);
  } else {
    r = parseInt(h6.substring(0, 2), 16);
    g = parseInt(h6.substring(2, 4), 16);
    b = parseInt(h6.substring(4, 6), 16);
  }
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hue = 0;
  let sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) {
      hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    } else if (max === g) {
      hue = ((b - r) / d + 2) / 6;
    } else {
      hue = ((r - g) / d + 4) / 6;
    }
  }
  return [Math.round(hue * 360), Math.round(sat * 100), Math.round(l * 100)];
}

export function initMeshBlobs(baseHex: string): void {
  meshBlobsColor = baseHex;
  const blobDefs = [
    { hShift: 0, sAdj: 0, lAdj: 0 },
    { hShift: 40, sAdj: 5, lAdj: -5 },
    { hShift: -40, sAdj: -5, lAdj: 5 },
    { hShift: 80, sAdj: 10, lAdj: -8 },
    { hShift: -80, sAdj: -10, lAdj: 8 },
  ];
  meshBlobs = blobDefs.map((def, i) => ({
    phase: (i * Math.PI * 2) / blobDefs.length + Math.random() * 0.5,
    speed: 0.15 + Math.random() * 0.1,  // radians/sec
    hueShift: def.hShift,
    size: 0.5 + Math.random() * 0.3,     // 50–80% of canvas
    orbitRx: 0.15 + Math.random() * 0.15,
    orbitRy: 0.1 + Math.random() * 0.15,
    cx: 0.3 + Math.random() * 0.4,
    cy: 0.3 + Math.random() * 0.4,
    satAdj: def.sAdj,
    litAdj: def.lAdj,
  }));
}

/** Draw the animated mesh gradient onto the given canvas context. */
function drawMeshGradient(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number, h: number, time: number,
): void {
  if (meshBlobs.length === 0 || w <= 0 || h <= 0) {
    return;
  }
  // Use a downscaled offscreen canvas for performance
  const dw = Math.max(1, Math.round(w / MESH_DOWNSCALE));
  const dh = Math.max(1, Math.round(h / MESH_DOWNSCALE));
  if (!meshOffscreen || meshOffscreen.width !== dw || meshOffscreen.height !== dh) {
    meshOffscreen = new OffscreenCanvas(dw, dh);
    meshOffCtx = meshOffscreen.getContext('2d');
  }
  if (!meshOffCtx) {
    return;
  }
  const [baseH, baseS, baseL] = hexToHSL(meshBlobsColor);
  // Fill with a darkened base color
  meshOffCtx.fillStyle = `hsl(${baseH}, ${Math.min(100, baseS + 10)}%, ${Math.max(10, baseL - 25)}%)`;
  meshOffCtx.fillRect(0, 0, dw, dh);
  // Draw each blob as a large, vivid radial gradient circle
  for (const blob of meshBlobs) {
    const blobH = (baseH + blob.hueShift + 360) % 360;
    const blobS = Math.max(30, Math.min(100, baseS + blob.satAdj + 15));
    const blobL = Math.max(25, Math.min(85, baseL + blob.litAdj + 5));
    // Compute position using circular/elliptical motion
    const px = blob.cx + Math.cos(time * blob.speed + blob.phase) * blob.orbitRx;
    const py = blob.cy + Math.sin(time * blob.speed * 0.7 + blob.phase) * blob.orbitRy;
    const cx = px * dw;
    const cy = py * dh;
    const radius = blob.size * Math.max(dw, dh) * 0.6;
    const grad = meshOffCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `hsla(${blobH}, ${blobS}%, ${blobL}%, 1)`);
    grad.addColorStop(0.4, `hsla(${blobH}, ${blobS}%, ${blobL}%, 0.7)`);
    grad.addColorStop(0.7, `hsla(${blobH}, ${blobS}%, ${blobL}%, 0.3)`);
    grad.addColorStop(1, `hsla(${blobH}, ${blobS}%, ${blobL}%, 0)`);
    meshOffCtx.fillStyle = grad;
    meshOffCtx.fillRect(0, 0, dw, dh);
  }
  // Composite: blur pass for the soft mesh look
  ctx.save();
  ctx.filter = `blur(${Math.round(w / 16)}px)`;
  ctx.drawImage(meshOffscreen, 0, 0, w, h);
  ctx.restore();
  // Composite: sharp pass for color vibrancy
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.drawImage(meshOffscreen, 0, 0, w, h);
  ctx.restore();
}

/** Return current meshBlobsColor (used by applyOverlay to detect color changes). */
export function getMeshBlobsColor(): string {
  return meshBlobsColor;
}

/** Return whether mesh blobs have been initialised. */
export function hasMeshBlobs(): boolean {
  return meshBlobs.length > 0;
}

/** Kick off the mesh start-time clock if not started. */
export function ensureMeshStartTime(): void {
  if (meshStartTime === 0) {
    meshStartTime = performance.now() / 1000;
  }
}

// ---------------------------------------------------------------------------
// Background canvas sizing
// ---------------------------------------------------------------------------

/** Size the background canvas to match the container (DPR-aware). */
export function sizeBgCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = previewContainer.clientWidth;
  const h = previewContainer.clientHeight;
  bgCanvas.width = Math.round(w * dpr);
  bgCanvas.height = Math.round(h * dpr);
}

// ---------------------------------------------------------------------------
// Composite background render (mesh + particles)
// ---------------------------------------------------------------------------

/** Render all background effects (mesh gradient + particles) on the preview bg canvas.
 *  Clears once, then layers mesh and particles so they don't overwrite each other. */
export function drawPreviewBackground(): void {
  const hasMesh = activeBgStyle === 'mesh' && meshBlobs.length > 0;
  const hasParticles = ambientParticlesEnabled && ambientParticles.length > 0;
  if (!hasMesh && !hasParticles) {
    return;
  }
  const cw = bgCanvas.width;
  const ch = bgCanvas.height;
  bgCtx.clearRect(0, 0, cw, ch);
  // Layer 1: mesh gradient
  if (hasMesh) {
    const time = performance.now() / 1000 - meshStartTime;
    drawMeshGradient(bgCtx, cw, ch, time);
  }
  // Layer 2: ambient particles on top
  if (hasParticles) {
    const now = performance.now();
    const dt = (now - lastBgParticleTime) / 1000;
    lastBgParticleTime = now;
    updateAmbientParticles(dt);
    drawAmbientParticles(bgCtx, cw, ch);
  }
}

// ---------------------------------------------------------------------------
// Animation loops
// ---------------------------------------------------------------------------

function particleLoop(): void {
  const needsBg = ambientParticlesEnabled || (activeBgStyle === 'mesh' && meshBlobs.length > 0);
  if (!needsBg) {
    particleLoopFrame = 0;
    return;
  }
  // If zoomRenderLoop is running, it handles background — skip standalone loop
  if (getZoomAnimFrame()) {
    particleLoopFrame = 0;
    return;
  }
  drawPreviewBackground();
  particleLoopFrame = requestAnimationFrame(particleLoop);
}

export function startParticleLoop(): void {
  if (particleLoopFrame || getZoomAnimFrame()) {
    return;
  }
  particleLoopFrame = requestAnimationFrame(particleLoop);
}

export function startMeshLoop(): void {
  ensureMeshStartTime();
  startParticleLoop();
}

/** Draw the mesh gradient onto an arbitrary context (used by recording pipeline). */
export function drawMeshBackground(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number, h: number,
): void {
  if (meshBlobs.length === 0 || w <= 0 || h <= 0) {
    return;
  }
  const time = performance.now() / 1000 - meshStartTime;
  drawMeshGradient(ctx, w, h, time);
}
