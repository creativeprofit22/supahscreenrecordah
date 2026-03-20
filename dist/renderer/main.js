"use strict";
// Main window renderer — live preview of screen capture and camera
Object.defineProperty(exports, "__esModule", { value: true });
const perf_monitor_1 = require("./perf-monitor");
const screenVideo = document.getElementById('screen-video');
const cameraContainer = document.getElementById('camera-container');
const cameraVideo = document.getElementById('camera-video');
const cameraName = document.getElementById('camera-name');
const cameraSocials = document.getElementById('camera-socials');
const waveformCanvas = document.getElementById('waveform-canvas');
const waveformCtx = waveformCanvas.getContext('2d');
const actionFeedCanvas = document.getElementById('action-feed-canvas');
const actionFeedCtx = actionFeedCanvas.getContext('2d');
const bgCanvas = document.getElementById('bg-canvas');
const bgCtx = bgCanvas.getContext('2d');
const idleState = document.getElementById('idle-state');
const previewContainer = document.querySelector('.preview-container');
const playbackContainer = document.getElementById('playback-container');
const playbackVideo = document.getElementById('playback-video');
const playbackExportBtn = document.getElementById('playback-export-btn');
const playbackExitBtn = document.getElementById('playback-exit-btn');
const processingOverlay = document.getElementById('processing-overlay');
const processingSub = document.getElementById('processing-sub');
let overlayName = '';
let bgColor = '#6b8cce';
let activeSocials = [];
// ---------------------------------------------------------------------------
// CTA Popup — periodic call-to-action that slides in during recording
// ---------------------------------------------------------------------------
const ctaPopup = document.getElementById('cta-popup');
let ctaText = '';
let ctaIcon = '';
let ctaFont = 'Datatype';
let ctaIntervalMs = 180_000; // configurable: 45s–3min, default 3 minutes
const ctaNotifAudio = new Audio('assets/notif.mp3');
ctaNotifAudio.volume = 0.6;
const CTA_DISPLAY_MS = 8_000; // show for 8 seconds
const CTA_SLIDE_DURATION_MS = 600; // matches CSS transition
let ctaTimer = null;
let ctaHideTimeout = null;
let ctaIsVisible = false;
let ctaAnimStartTime = 0;
let ctaAnimState = 'idle';
function showCtaPopup() {
    if (!ctaText) {
        return;
    }
    ctaPopup.textContent = ctaIcon ? `${ctaIcon} ${ctaText}` : ctaText;
    ctaPopup.style.fontFamily = `"${ctaFont}", sans-serif`;
    ctaPopup.classList.remove('slide-out');
    ctaPopup.classList.add('active');
    // Play notification sound — clone so overlapping plays don't cut each other off
    const notifClone = ctaNotifAudio.cloneNode();
    notifClone.volume = ctaNotifAudio.volume;
    notifClone.play().catch(() => { });
    ctaIsVisible = true;
    ctaAnimState = 'sliding-in';
    ctaAnimStartTime = performance.now();
    if (ctaHideTimeout) {
        clearTimeout(ctaHideTimeout);
    }
    ctaHideTimeout = setTimeout(() => {
        hideCtaPopup();
    }, CTA_DISPLAY_MS);
}
function hideCtaPopup() {
    if (!ctaIsVisible) {
        return;
    }
    ctaPopup.classList.add('slide-out');
    ctaPopup.classList.remove('active');
    ctaAnimState = 'sliding-out';
    ctaAnimStartTime = performance.now();
    // After slide-out animation completes, mark as idle
    setTimeout(() => {
        if (ctaAnimState === 'sliding-out') {
            ctaAnimState = 'idle';
            ctaIsVisible = false;
        }
    }, CTA_SLIDE_DURATION_MS);
    if (ctaHideTimeout) {
        clearTimeout(ctaHideTimeout);
        ctaHideTimeout = null;
    }
}
function startCtaLoop() {
    stopCtaLoop();
    if (!ctaText) {
        return;
    }
    // Fire first CTA after one full interval, then repeat
    ctaTimer = setInterval(() => {
        showCtaPopup();
    }, ctaIntervalMs);
}
function stopCtaLoop() {
    if (ctaTimer) {
        clearInterval(ctaTimer);
        ctaTimer = null;
    }
    hideCtaPopup();
    ctaAnimState = 'idle';
    ctaIsVisible = false;
}
/** Draw the CTA popup on the recording canvas with slide animation */
function drawCtaOnCanvas(ctx, canvasW, canvasH, scale) {
    if (!ctaText || ctaAnimState === 'idle') {
        return;
    }
    const now = performance.now();
    const elapsed = now - ctaAnimStartTime;
    // Compute Y offset based on animation state
    let progress;
    let yOffset; // 0 = fully visible, 1 = fully below
    if (ctaAnimState === 'sliding-in') {
        progress = Math.min(1, elapsed / CTA_SLIDE_DURATION_MS);
        // Ease-out cubic for smooth deceleration
        const eased = 1 - Math.pow(1 - progress, 3);
        yOffset = 1 - eased;
        if (progress >= 1) {
            ctaAnimState = 'visible';
        }
    }
    else if (ctaAnimState === 'sliding-out') {
        progress = Math.min(1, elapsed / CTA_SLIDE_DURATION_MS);
        // Ease-in cubic for acceleration
        const eased = Math.pow(progress, 3);
        yOffset = eased;
    }
    else {
        // visible
        yOffset = 0;
    }
    // Text measurement
    const fontSize = 16 * scale;
    const fontFamily = `"${ctaFont}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.font = `600 ${fontSize}px ${fontFamily}`;
    const displayText = ctaIcon ? `${ctaIcon} ${ctaText}` : ctaText;
    const textMetrics = ctx.measureText(displayText);
    const textW = textMetrics.width;
    // Pill dimensions
    const padH = 24 * scale;
    const padV = 12 * scale;
    const pillW = textW + padH * 2;
    const pillH = fontSize + padV * 2;
    const cornerRadius = 12 * scale;
    // Position: bottom-center with slide offset
    const pillX = (canvasW - pillW) / 2;
    const bottomMargin = 24 * scale;
    const pillYBase = canvasH - pillH - bottomMargin;
    const pillYHidden = canvasH + pillH; // fully below canvas
    const pillY = pillYBase + (pillYHidden - pillYBase) * yOffset;
    const borderW = 2 * scale;
    ctx.save();
    // Shadow effect (drawn first, behind everything)
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 32 * scale;
    ctx.shadowOffsetY = 8 * scale;
    ctx.fillStyle = 'rgba(30, 30, 46, 0.85)';
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, cornerRadius);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    // Rotating shimmer border — conic gradient matching the screen/camera borders
    // Use a time-based angle so it spins even in the DOM preview (no recBorderAngle)
    const ctaBorderAngle = ((now % 4000) / 4000) * 360;
    const cx = pillX + pillW / 2;
    const cy = pillY + pillH / 2;
    const angleRad = (ctaBorderAngle * Math.PI) / 180;
    const gradient = ctx.createConicGradient(angleRad, cx, cy);
    gradient.addColorStop(0, '#d600ff');
    gradient.addColorStop(0.25, '#00ff9f');
    gradient.addColorStop(0.5, '#00b8ff');
    gradient.addColorStop(0.75, '#001eff');
    gradient.addColorStop(1, '#d600ff');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(pillX - borderW, pillY - borderW, pillW + borderW * 2, pillH + borderW * 2, cornerRadius + borderW);
    ctx.fill();
    // Inner fill — covers the gradient, leaving the border edge visible
    ctx.fillStyle = 'rgba(30, 30, 46, 0.92)';
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, cornerRadius);
    ctx.fill();
    // Text
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${fontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayText, canvasW / 2, pillY + pillH / 2);
    ctx.restore();
}
let activeCinemaFilter = 'none';
let activeCameraEnhancement = {
    brightness: 105,
    contrast: 112,
    saturation: 130,
    warmth: 5,
    sharpness: 0,
    softness: 0,
};
// ---------------------------------------------------------------------------
// Camera enhancement — builds CSS/canvas filter strings from slider values
// ---------------------------------------------------------------------------
/** Build a CSS/canvas filter string from camera enhancement values */
function buildEnhancementFilter(enh) {
    const parts = [];
    if (enh.brightness !== 100) {
        parts.push(`brightness(${enh.brightness / 100})`);
    }
    if (enh.contrast !== 100) {
        parts.push(`contrast(${enh.contrast / 100})`);
    }
    if (enh.saturation !== 100) {
        parts.push(`saturate(${enh.saturation / 100})`);
    }
    if (enh.warmth !== 0) {
        // Warmth: positive = warm (amber tint via sepia + slight hue rotate back)
        //         negative = cool (slight blue push via hue-rotate)
        if (enh.warmth > 0) {
            const sepia = (enh.warmth / 50) * 0.2; // max 0.2 sepia at warmth=50
            parts.push(`sepia(${sepia})`);
        }
        else {
            const hueShift = (enh.warmth / 50) * 30; // max -30deg at warmth=-50
            parts.push(`hue-rotate(${hueShift}deg)`);
        }
    }
    if (enh.sharpness > 0) {
        // Sharpness via small contrast boost — subtle but effective
        const extra = 1 + (enh.sharpness / 100) * 0.15; // up to 15% extra contrast
        parts.push(`contrast(${extra})`);
    }
    if (enh.softness > 0) {
        const blur = (enh.softness / 100) * 1.5; // max 1.5px blur
        parts.push(`blur(${blur}px)`);
    }
    return parts.join(' ');
}
const CINEMA_FILTERS = {
    // ── Matrix ──────────────────────────────────────────────────────────────
    // Green-tinted desaturated look. Sepia base rotated toward green,
    // crushed saturation, high contrast, dim brightness. Green shadow wash
    // pushes dark areas further into the iconic green-on-black palette.
    matrix: {
        cssFilter: 'sepia(0.4) hue-rotate(70deg) saturate(0.65) contrast(1.4) brightness(0.82)',
        canvasFilter: 'sepia(0.4) hue-rotate(70deg) saturate(0.65) contrast(1.4) brightness(0.82)',
        shadowTint: '#88cc77',
        shadowAlpha: 0.12,
        highlightTint: null,
        highlightAlpha: 0,
    },
    // ── Teal & Orange ──────────────────────────────────────────────────────
    // The most iconic Hollywood blockbuster grade. Complementary color split:
    // teal pushed into shadows/backgrounds, orange enhanced in highlights/skin.
    // Moderate contrast boost, slightly elevated saturation for punch.
    // Used in: Mad Max, Transformers, John Wick, most modern action films.
    'teal-orange': {
        cssFilter: 'contrast(1.15) saturate(1.2) brightness(0.95)',
        canvasFilter: 'contrast(1.15) saturate(1.2) brightness(0.95)',
        shadowTint: '#1a6b7a', // deep teal — cold shadows
        shadowAlpha: 0.14,
        highlightTint: '#cc8844', // warm amber — pushes highlights toward orange
        highlightAlpha: 0.08,
    },
    // ── Noir ────────────────────────────────────────────────────────────────
    // Classic film noir. Near-monochrome with heavy contrast — crushed blacks,
    // blown highlights. A subtle cold blue tint in the shadows preserves
    // cinematic depth rather than going pure greyscale. Heavy vignette pulls
    // focus inward. Dense grain emulates high-ISO B&W film stock.
    noir: {
        cssFilter: 'grayscale(0.85) contrast(1.5) brightness(0.88) saturate(0.3)',
        canvasFilter: 'grayscale(0.85) contrast(1.5) brightness(0.88) saturate(0.3)',
        shadowTint: '#1a2a44', // cold navy — gives depth to crushed blacks
        shadowAlpha: 0.15,
        highlightTint: '#ccccdd', // very faint cool highlight — keeps it from feeling flat
        highlightAlpha: 0.04,
    },
    // ── Vintage Film ────────────────────────────────────────────────────────
    // Faded film stock look — lifted blacks (nothing truly black), warm amber
    // tint, reduced contrast, slight desaturation. The "screen" highlight
    // wash lifts the black point, giving the signature hazy/faded quality.
    // Heavy grain with warm tone emulates aged Kodak/Fuji film stocks.
    // Used in: Moonrise Kingdom, O Brother Where Art Thou, Instagram "vintage".
    vintage: {
        cssFilter: 'sepia(0.25) contrast(0.9) saturate(0.8) brightness(1.05)',
        canvasFilter: 'sepia(0.25) contrast(0.9) saturate(0.8) brightness(1.05)',
        shadowTint: '#554422', // warm brown — aged film base color
        shadowAlpha: 0.1,
        highlightTint: '#ddcc99', // warm cream — lifts blacks, hazy faded look
        highlightAlpha: 0.1,
    },
    // ── Blade Runner ────────────────────────────────────────────────────────
    // Cyberpunk neon aesthetic. High contrast with cyan-tinted shadows and
    // amber/gold highlights. The split creates the electric, rain-soaked
    // atmosphere of neo-noir sci-fi. Moderate grain, strong vignette.
    // Used in: Blade Runner 2049, Ghost in the Shell, Altered Carbon.
    'blade-runner': {
        cssFilter: 'contrast(1.3) saturate(0.85) brightness(0.88) sepia(0.08)',
        canvasFilter: 'contrast(1.3) saturate(0.85) brightness(0.88) sepia(0.08)',
        shadowTint: '#0a4466', // electric cyan-blue — neon-lit shadows
        shadowAlpha: 0.16,
        highlightTint: '#cc9944', // amber gold — warm neon bounce light
        highlightAlpha: 0.09,
    },
    // ── Moonlight ───────────────────────────────────────────────────────────
    // Cool, understated drama grade. Blue-tinted shadows create emotional
    // distance, slight desaturation keeps it sombre. Soft contrast (not
    // crushed) preserves detail in dark scenes. Minimal grain, gentle vignette.
    // Used in: Moonlight, The Revenant, Dunkirk, Ozark.
    moonlight: {
        cssFilter: 'saturate(0.75) contrast(1.1) brightness(0.92) hue-rotate(-8deg)',
        canvasFilter: 'saturate(0.75) contrast(1.1) brightness(0.92) hue-rotate(-8deg)',
        shadowTint: '#1a2844', // deep cool blue — emotional, melancholic shadows
        shadowAlpha: 0.18,
        highlightTint: '#aabbcc', // pale steel blue — keeps highlights cool
        highlightAlpha: 0.05,
    },
};
/** Get the CSS filter string for a cinema filter (for live preview) */
function getCinemaCSS(filter) {
    if (filter === 'none') {
        return '';
    }
    return CINEMA_FILTERS[filter].cssFilter;
}
/** Get the canvas filter string for a cinema filter (for recording) */
function getCinemaCanvas(filter) {
    if (filter === 'none') {
        return '';
    }
    return CINEMA_FILTERS[filter].canvasFilter;
}
/**
 * Draw a colored shadow tint — pushes a color into the darker regions of the image.
 * Uses 'multiply' so it only tints dark areas; bright areas stay mostly clean.
 */
function drawShadowTint(ctx, bounds, color, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.restore();
}
/**
 * Draw a colored highlight wash — lifts bright areas toward a hue.
 * Uses 'screen' so it only affects bright areas; dark areas stay clean.
 */
function drawHighlightWash(ctx, bounds, color, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.restore();
}
/** Apply combined CSS filter (enhancement + cinema) to live preview — camera only */
function applyCameraFiltersToPreview() {
    const enhFilter = buildEnhancementFilter(activeCameraEnhancement);
    const cinemaFilter = getCinemaCSS(activeCinemaFilter);
    const combined = [enhFilter, cinemaFilter].filter(Boolean).join(' ');
    cameraVideo.style.filter = combined || '';
}
/** Apply cinematic post-processing to the recording canvas — camera area only */
function applyRecordingCinemaFilter(ctx, bounds, filter) {
    if (filter === 'none') {
        return;
    }
    const def = CINEMA_FILTERS[filter];
    // Clip all effects to camera bounds
    ctx.save();
    ctx.beginPath();
    ctx.rect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.clip();
    // Shadow tint — pushes a color into dark areas via multiply blend
    if (def.shadowTint && def.shadowAlpha > 0) {
        drawShadowTint(ctx, bounds, def.shadowTint, def.shadowAlpha);
    }
    // Highlight wash — lifts bright areas toward a hue via screen blend
    if (def.highlightTint && def.highlightAlpha > 0) {
        drawHighlightWash(ctx, bounds, def.highlightTint, def.highlightAlpha);
    }
    ctx.restore();
}
const PARTICLE_COUNT = 60;
const PARTICLE_BASE_TTL = 200;
const PARTICLE_RANGE_TTL = 400;
const PARTICLE_BASE_SPEED = 0.004;
const PARTICLE_RANGE_SPEED = 0.008;
const PARTICLE_BASE_SIZE = 1.5;
const PARTICLE_RANGE_SIZE = 4;
const PARTICLE_BASE_HUE = 200; // cool blue-ish centre
const PARTICLE_RANGE_HUE = 60; // spread toward warm/cool
let ambientParticles = [];
let ambientParticlesEnabled = false;
// Offscreen canvas for raw particle dots (before blur)
let particleOffscreen = null;
let particleOffCtx = null;
/** Fade-in then fade-out based on life/ttl (0→1→0) */
function fadeInOut(life, ttl) {
    const half = ttl * 0.5;
    return life < half ? life / half : (ttl - life) / half;
}
function initParticle(p) {
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
function initAmbientParticles() {
    ambientParticles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = {
            x: 0,
            y: 0,
            life: 0,
            ttl: 0,
            speed: 0,
            size: 0,
            hue: 0,
            vx: 0,
            vy: 0,
        };
        initParticle(p);
        // Scatter initial life so they don't all fade in at once
        p.life = Math.random() * p.ttl;
        ambientParticles.push(p);
    }
}
function updateAmbientParticles(dt) {
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
function drawAmbientParticles(ctx, w, h) {
    if (!ambientParticlesEnabled || ambientParticles.length === 0) {
        return;
    }
    // Lazily create or resize offscreen canvas
    if (w <= 0 || h <= 0) {
        return;
    }
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
let activeBgStyle = 'solid';
let meshBlobs = [];
let meshBlobsColor = ''; // tracks which bgColor the blobs were generated for
let meshOffscreen = null;
let meshOffCtx = null;
// Downscale factor for mesh offscreen canvas — balances blur quality vs perf
const MESH_DOWNSCALE = 4;
/** Parse hex color to HSL. Returns [h, s, l] with h in degrees, s/l in 0–100. */
function hexToHSL(hex) {
    const h6 = hex.replace('#', '');
    let r;
    let g;
    let b;
    if (h6.length === 3) {
        r = parseInt(h6[0] + h6[0], 16);
        g = parseInt(h6[1] + h6[1], 16);
        b = parseInt(h6[2] + h6[2], 16);
    }
    else {
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
        }
        else if (max === g) {
            hue = ((b - r) / d + 2) / 6;
        }
        else {
            hue = ((r - g) / d + 4) / 6;
        }
    }
    return [Math.round(hue * 360), Math.round(sat * 100), Math.round(l * 100)];
}
function initMeshBlobs(baseHex) {
    const [h, s, l] = hexToHSL(baseHex);
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
        speed: 0.15 + Math.random() * 0.1, // radians/sec
        hueShift: def.hShift,
        size: 0.5 + Math.random() * 0.3, // 50–80% of canvas
        orbitRx: 0.15 + Math.random() * 0.15,
        orbitRy: 0.1 + Math.random() * 0.15,
        cx: 0.3 + Math.random() * 0.4,
        cy: 0.3 + Math.random() * 0.4,
        satAdj: def.sAdj,
        litAdj: def.lAdj,
    }));
    // Force unused vars to be referenced in the type system
    void s;
    void l;
    void h;
}
/** Draw the animated mesh gradient onto the given canvas context. */
function drawMeshGradient(ctx, w, h, time) {
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
let meshStartTime = 0;
function startMeshLoop() {
    if (meshStartTime === 0) {
        meshStartTime = performance.now() / 1000;
    }
    // Mesh rendering is handled by particleLoop (now drawPreviewBackground)
    // or zoomRenderLoop — just start the standalone loop if needed
    startParticleLoop();
}
// ---------------------------------------------------------------------------
// Name magnify wave — scales each letter up left-to-right every 10s
// ---------------------------------------------------------------------------
const MAGNIFY_INTERVAL_MS = 10_000;
const MAGNIFY_STEP_MS = 80; // delay between each letter
let magnifyTimer = null;
function wrapNameInCharSpans(text) {
    cameraName.innerHTML = '';
    for (const ch of text) {
        const span = document.createElement('span');
        span.className = 'char';
        span.textContent = ch === ' ' ? '\u00A0' : ch;
        cameraName.appendChild(span);
    }
}
function runMagnifyWave() {
    const chars = cameraName.querySelectorAll('.char');
    if (chars.length === 0) {
        return;
    }
    chars.forEach((span, i) => {
        setTimeout(() => {
            span.classList.add('magnified');
            setTimeout(() => {
                span.classList.remove('magnified');
            }, MAGNIFY_STEP_MS * 2);
        }, i * MAGNIFY_STEP_MS);
    });
}
function startMagnifyLoop() {
    stopMagnifyLoop();
    runMagnifyWave();
    magnifyTimer = setInterval(runMagnifyWave, MAGNIFY_INTERVAL_MS);
}
function stopMagnifyLoop() {
    if (magnifyTimer) {
        clearInterval(magnifyTimer);
        magnifyTimer = null;
    }
}
// SVG paths for social icons (24x24 viewBox)
const SOCIAL_SVG_PATHS = {
    x: 'M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z',
    youtube: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12z',
    tiktok: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
    instagram: 'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.668 1.0745-1.3367 1.3802-2.1272.2957-.7637.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6794-.8186-.8964-1.3794-.1636-.4233-.3586-1.0584-.4114-2.2293-.0567-1.2671-.0689-1.6479-.0726-4.8566-.0036-3.2079.008-3.5882.0608-4.8568.0503-1.1707.2456-1.8057.408-2.2282.2166-.5613.4772-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.8988.4224-.1635 1.0576-.3588 2.2288-.4116 1.2672-.0567 1.6479-.0689 4.8564-.0726 3.2085-.0036 3.5884.0084 4.8574.0612 1.1703.0508 1.8053.2463 2.2282.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.8962 1.3783.1634.4232.3584 1.0578.4114 2.2296.0568 1.2673.069 1.6477.0726 4.8565.0037 3.2088-.0083 3.5882-.0612 4.8576-.0507 1.1706-.2455 1.8057-.4076 2.2282-.2164.5606-.4772.96-.8948 1.3818-.4194.4218-.8176.6812-1.3788.8968-.4228.1633-1.058.3588-2.229.4114-1.2676.0567-1.6477.069-4.857.0726-3.2093.0037-3.5882-.0083-4.8572-.0607M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077',
};
// Cache parsed Path2D objects for social icons — avoids re-parsing SVG paths every frame
const socialPath2DCache = new Map();
function getSocialPath2D(platform) {
    let p = socialPath2DCache.get(platform);
    if (!p) {
        p = new Path2D(SOCIAL_SVG_PATHS[platform]);
        socialPath2DCache.set(platform, p);
    }
    return p;
}
let screenStream = null;
let cameraStream = null;
// Current horizontal position of the screen video (left edge, in px)
let screenX = 24; // default = container padding
let currentLayout = 'camera-right';
let currentScreenSourceId = '';
let currentCameraDeviceId = '';
const TRANSITION_MS = 400; // matches CSS --transition-speed
// ---------------------------------------------------------------------------
// Mouse tracking state (adapted from shortformed for long-form recording)
// ---------------------------------------------------------------------------
let currentMouseX = 0;
let currentMouseY = 0;
let smoothMouseX = 0;
let smoothMouseY = 0;
let displayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
// Captured content bounds - for window captures, this differs from displayBounds
// We track the actual captured region to properly map mouse coordinates
let capturedBounds = { x: 0, y: 0, width: 1920, height: 1080 };
let isCapturingWindow = false;
// Smooth easing — time-based for consistent results regardless of frame rate
const CAMERA_SMOOTH_TIME = 300; // ms to reach ~63% of target
let lastUpdateTime = performance.now();
// Wiggle room — circular dead zone radius around camera centre (in screen pixels)
const WIGGLE_ROOM_RADIUS = 20;
// Velocity capping — max pixels the camera can move per second
const MAX_CAMERA_VELOCITY = 2500;
// ---------------------------------------------------------------------------
// Click-to-zoom state — spring-based for smooth, interruptible transitions
// ---------------------------------------------------------------------------
const zoom_1 = require("../shared/zoom");
/** Derive dynamic min/max click-zoom from the user's mouseZoom setting (1.2–2.5). */
function clickZoomRange(mouseZoom) {
    const clamped = Math.max(1.2, Math.min(2.5, mouseZoom));
    const min = Math.max(1.05, clamped - 0.3);
    const max = Math.min(3.0, clamped + 0.5);
    return { min, max };
}
const MOUSE_ZOOM_DEFAULT = 1.5;
const BASE_ZOOM = 1.0; // Long-form default: show full screen
let currentZoom = BASE_ZOOM;
// User-configurable click-zoom range — set by applyOverlay(), safe defaults here
let activeClickZoomMin = 1.2;
let activeClickZoomMax = 2.0;
let zoomOutTimeout = null;
let zoomLingerTime = 2500; // How long zoom stays after mouse release (ms) — user-configurable
// Click debouncing — coalesce rapid clicks (double/triple-click, etc.)
const CLICK_DEBOUNCE_MS = 400; // Clicks within this window are coalesced
let lastClickDownTime = 0;
let isMouseHeld = false; // Track whether mouse button is currently down
// Spring-based zoom animation — preserves velocity across target changes
const zoomSpring = (0, zoom_1.createSpringState)(BASE_ZOOM);
// Separate spring configs for zoom-in (snappy) vs zoom-out (gentle)
const ZOOM_IN_SPRING = {
    stiffness: 200, // Snappy response
    damping: 26, // Critically damped
    mass: 1,
};
const ZOOM_OUT_SPRING = {
    stiffness: 120, // Gentler, slower
    damping: 22, // Slightly underdamped for organic feel
    mass: 1,
};
// Track which spring config is active (changes based on zoom direction)
let activeSpringConfig = zoom_1.DEFAULT_SPRING_CONFIG;
/**
 * Convert mouse position from screen coordinates to captured content coordinates.
 * For window captures, this maps the mouse to the captured window's coordinate space.
 *
 * @returns Relative position (0-1) within captured content, or null if mouse is outside
 */
function getMouseRelativeToCaptured() {
    // Check if mouse is within the captured bounds
    const inCapturedX = smoothMouseX >= capturedBounds.x && smoothMouseX <= capturedBounds.x + capturedBounds.width;
    const inCapturedY = smoothMouseY >= capturedBounds.y && smoothMouseY <= capturedBounds.y + capturedBounds.height;
    // For window captures, if mouse is outside the window, clamp to edges
    // For screen captures, mouse should always be within bounds
    let clampedX = smoothMouseX;
    let clampedY = smoothMouseY;
    if (!inCapturedX || !inCapturedY) {
        // Mouse is outside captured region - clamp to bounds
        clampedX = Math.max(capturedBounds.x, Math.min(capturedBounds.x + capturedBounds.width, smoothMouseX));
        clampedY = Math.max(capturedBounds.y, Math.min(capturedBounds.y + capturedBounds.height, smoothMouseY));
    }
    const relX = (clampedX - capturedBounds.x) / capturedBounds.width;
    const relY = (clampedY - capturedBounds.y) / capturedBounds.height;
    return { relX, relY };
}
/**
 * Calculate dynamic zoom that keeps the mouse visible and reasonably centered.
 *
 * Key insight: When mouse is at the edge of content, we need HIGHER zoom
 * so the viewport is smaller, which pushes the mouse toward the viewport center
 * (due to clamping at content boundaries).
 *
 * @param relX - Mouse X position relative to captured content (0-1)
 * @param relY - Mouse Y position relative to captured content (0-1)
 * @returns Zoom level that keeps mouse visible with good margin
 */
function calculateDynamicZoom(relX, relY) {
    // Distance from mouse to each edge (0 to 1 scale)
    const distLeft = relX;
    const distRight = 1 - relX;
    const distTop = relY;
    const distBottom = 1 - relY;
    // Minimum distance to any edge
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);
    // Calculate zoom needed to keep mouse at least VIEWPORT_MARGIN from viewport edge
    // With zoom Z, viewport shows 1/Z of content
    // To have mouse at position M (0-1) in viewport: we need zoom such that
    // the smaller of M and (1-M) is >= VIEWPORT_MARGIN
    //
    // For edge case: if mouse is at 0% and we want it at 15% in viewport,
    // the viewport must start before the content edge - but that's clamped.
    // With clamping, higher zoom = mouse appears further from viewport edge.
    //
    // Formula: zoom needed = 1 / (2 * minDist + 2 * VIEWPORT_MARGIN)
    // This ensures that after clamping, mouse has adequate margin
    // Scale minDist to account for desired margin
    // At edge (minDist=0): we need max zoom to push mouse toward center
    // At center (minDist=0.5): min zoom is fine, mouse is naturally centered
    // Inverse relationship: closer to edge = higher zoom needed
    const edgeProximity = 1 - Math.min(1, minDist * 2); // 1 at edge, 0 at center
    // Interpolate: edge = max zoom, center = min zoom (user-configurable)
    const dynamicZoom = activeClickZoomMin + (activeClickZoomMax - activeClickZoomMin) * edgeProximity;
    // Hard cap — even the highest user setting can't exceed 3.0x
    return Math.min(dynamicZoom, 3.0);
}
// ---------------------------------------------------------------------------
// Smooth mouse interpolation (time-based, with wiggle room + velocity cap)
// ---------------------------------------------------------------------------
function updateSmoothMouse() {
    const now = performance.now();
    const deltaTime = now - lastUpdateTime;
    lastUpdateTime = now;
    const cameraFactor = 1 - Math.exp(-deltaTime / CAMERA_SMOOTH_TIME);
    const offsetX = currentMouseX - smoothMouseX;
    const offsetY = currentMouseY - smoothMouseY;
    const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
    let targetX = smoothMouseX;
    let targetY = smoothMouseY;
    if (distance > WIGGLE_ROOM_RADIUS) {
        const angle = Math.atan2(offsetY, offsetX);
        targetX = currentMouseX - Math.cos(angle) * WIGGLE_ROOM_RADIUS;
        targetY = currentMouseY - Math.sin(angle) * WIGGLE_ROOM_RADIUS;
    }
    let moveX = (targetX - smoothMouseX) * cameraFactor;
    let moveY = (targetY - smoothMouseY) * cameraFactor;
    const maxMove = MAX_CAMERA_VELOCITY * (deltaTime / 1000);
    const moveDistance = Math.sqrt(moveX * moveX + moveY * moveY);
    if (moveDistance > maxMove && moveDistance > 0) {
        const scale = maxMove / moveDistance;
        moveX *= scale;
        moveY *= scale;
    }
    smoothMouseX += moveX;
    smoothMouseY += moveY;
    // Smooth zoom interpolation via spring physics — frame-rate independent,
    // preserves velocity across target changes for smooth mid-flight interruptions.
    (0, zoom_1.stepSpring)(zoomSpring, activeSpringConfig, deltaTime / 1000);
    currentZoom = zoomSpring.position;
}
// ---------------------------------------------------------------------------
// Click-to-zoom handlers — with debouncing and asymmetric spring configs
// ---------------------------------------------------------------------------
function onMouseDown() {
    const now = performance.now();
    // Cancel any pending zoom-out
    if (zoomOutTimeout) {
        clearTimeout(zoomOutTimeout);
        zoomOutTimeout = null;
    }
    isMouseHeld = true;
    // Debounce rapid clicks: if this click arrives within CLICK_DEBOUNCE_MS of the
    // last one, treat it as a continuation (e.g. double/triple-click to select text).
    // The zoom stays in — we just update the target position smoothly.
    const isRapidClick = now - lastClickDownTime < CLICK_DEBOUNCE_MS;
    lastClickDownTime = now;
    // Calculate dynamic zoom based on mouse position relative to captured content
    const relPos = getMouseRelativeToCaptured();
    if (!relPos) {
        return;
    }
    const dynamicZoom = calculateDynamicZoom(relPos.relX, relPos.relY);
    // Use snappy spring for zoom-in
    activeSpringConfig = ZOOM_IN_SPRING;
    if (isRapidClick && currentZoom > BASE_ZOOM) {
        // Already zoomed — just smoothly update target (pan effect while zoomed)
        (0, zoom_1.setSpringTarget)(zoomSpring, dynamicZoom);
    }
    else {
        // Fresh zoom-in
        (0, zoom_1.setSpringTarget)(zoomSpring, dynamicZoom);
    }
}
function onMouseUp() {
    isMouseHeld = false;
    if (zoomOutTimeout) {
        clearTimeout(zoomOutTimeout);
    }
    zoomOutTimeout = setTimeout(() => {
        // Only zoom out if mouse is not being held (user may have clicked again)
        if (!isMouseHeld) {
            // Use gentle spring for zoom-out (slower, less jarring)
            activeSpringConfig = ZOOM_OUT_SPRING;
            (0, zoom_1.setSpringTarget)(zoomSpring, BASE_ZOOM);
        }
        zoomOutTimeout = null;
    }, zoomLingerTime);
}
// ---------------------------------------------------------------------------
// Apply zoom to the screen video preview via CSS transform
// ---------------------------------------------------------------------------
function applyScreenZoomTransform() {
    if (currentZoom <= 1.0 || !screenStream) {
        screenVideo.style.transformOrigin = '';
        screenVideo.style.transform = 'translateY(-50%)';
        screenVideo.style.clipPath = '';
        return;
    }
    // Get mouse position relative to captured content
    const relPos = getMouseRelativeToCaptured();
    if (!relPos) {
        return;
    }
    const { relX, relY } = relPos;
    // Clamp the desired viewport center so the zoomed region stays within bounds.
    // The viewport is (100/zoom)% wide, so center must be in [halfView, 100-halfView].
    const halfView = 50 / currentZoom;
    const centerX = Math.max(halfView, Math.min(100 - halfView, relX * 100));
    const centerY = Math.max(halfView, Math.min(100 - halfView, relY * 100));
    // Derive the CSS transform-origin that produces the desired visible center.
    // With scale(S) around origin ox, the visible center in content space is:
    //   visibleCenter = ox + (50 - ox) / S
    // Solving for ox: ox = (center * S - 50) / (S - 1)
    const originX = (centerX * currentZoom - 50) / (currentZoom - 1);
    const originY = (centerY * currentZoom - 50) / (currentZoom - 1);
    screenVideo.style.transformOrigin = `${originX}% ${originY}%`;
    screenVideo.style.transform = `translateY(-50%) scale(${currentZoom})`;
    // Clip the scaled element back to its original bounds so it doesn't overflow.
    // clip-path is applied in local coords before the transform, so we compute
    // insets that, after being scaled, produce the original element boundary.
    const factor = 1 - 1 / currentZoom;
    const clipTop = originY * factor;
    const clipRight = (100 - originX) * factor;
    const clipBottom = (100 - originY) * factor;
    const clipLeft = originX * factor;
    screenVideo.style.clipPath = `inset(${clipTop}% ${clipRight}% ${clipBottom}% ${clipLeft}%)`;
}
// ---------------------------------------------------------------------------
// Animation loop for zoom preview (runs continuously when screen is active)
// ---------------------------------------------------------------------------
let zoomAnimFrame = 0;
let lastBgParticleTime = performance.now();
/** Size the background canvas to match the container (DPR-aware) */
function sizeBgCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = previewContainer.clientWidth;
    const h = previewContainer.clientHeight;
    bgCanvas.width = Math.round(w * dpr);
    bgCanvas.height = Math.round(h * dpr);
}
/** Standalone background animation loop — runs when zoomRenderLoop is not active.
 *  Handles both particles-only and mesh+particles combinations. */
let particleLoopFrame = 0;
function particleLoop() {
    const needsBg = ambientParticlesEnabled || (activeBgStyle === 'mesh' && meshBlobs.length > 0);
    if (!needsBg) {
        particleLoopFrame = 0;
        return;
    }
    // If zoomRenderLoop is running, it handles background — skip standalone loop
    if (zoomAnimFrame) {
        particleLoopFrame = 0;
        return;
    }
    drawPreviewBackground();
    particleLoopFrame = requestAnimationFrame(particleLoop);
}
function startParticleLoop() {
    if (particleLoopFrame || zoomAnimFrame) {
        return;
    }
    particleLoopFrame = requestAnimationFrame(particleLoop);
}
/** Render all background effects (mesh gradient + particles) on the preview bg canvas.
 *  Clears once, then layers mesh and particles so they don't overwrite each other. */
function drawPreviewBackground() {
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
function zoomRenderLoop() {
    updateSmoothMouse();
    applyScreenZoomTransform();
    drawPreviewBackground();
    zoomAnimFrame = requestAnimationFrame(zoomRenderLoop);
}
function startZoomRenderLoop() {
    if (zoomAnimFrame) {
        return;
    }
    zoomAnimFrame = requestAnimationFrame(zoomRenderLoop);
}
function stopZoomRenderLoop() {
    if (zoomAnimFrame) {
        cancelAnimationFrame(zoomAnimFrame);
        zoomAnimFrame = 0;
    }
}
// ---------------------------------------------------------------------------
// Listen for mouse tracking data from main process
// ---------------------------------------------------------------------------
window.mainAPI.onMousePosition((position) => {
    currentMouseX = position.x;
    currentMouseY = position.y;
    displayBounds = position.displayBounds;
});
window.mainAPI.onMouseClick((event) => {
    if (event.type === 'down') {
        onMouseDown();
    }
    else if (event.type === 'up') {
        onMouseUp();
    }
});
// ---------------------------------------------------------------------------
// Fit screen video to native aspect ratio & position it
// ---------------------------------------------------------------------------
function fitScreenVideo() {
    const natW = screenVideo.videoWidth;
    const natH = screenVideo.videoHeight;
    if (!natW || !natH) {
        return;
    }
    const padding = 24;
    const hasCam = cameraContainer.classList.contains('active');
    const clientW = previewContainer.clientWidth;
    const clientH = previewContainer.clientHeight;
    // Camera CSS width = 22% of container; use same padding (24px) for gap
    const camW = hasCam ? clientW * 0.22 + padding : 0;
    const maxW = clientW - padding * 2 - camW;
    const maxH = clientH - padding * 2;
    const ratio = natW / natH;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
        h = maxH;
        w = h * ratio;
    }
    screenVideo.style.width = `${Math.round(w)}px`;
    screenVideo.style.height = `${Math.round(h)}px`;
    // Centre the screen when no camera is active
    if (!hasCam) {
        screenX = Math.round((clientW - w) / 2);
    }
    // Clamp screenX within allowed bounds
    clampScreenX();
    screenVideo.style.left = `${Math.round(screenX)}px`;
}
function getScreenBounds() {
    const padding = 24;
    const hasCam = cameraContainer.classList.contains('active');
    const containerW = previewContainer.clientWidth;
    const videoW = screenVideo.offsetWidth;
    const camZoneW = hasCam ? containerW * 0.22 + padding + padding : 0;
    let minX;
    let maxX;
    if (currentLayout === 'camera-left') {
        minX = hasCam ? camZoneW : padding;
        maxX = containerW - padding - videoW;
    }
    else {
        minX = padding;
        maxX = containerW - (hasCam ? camZoneW : padding) - videoW;
    }
    return { minX, maxX: Math.max(minX, maxX) };
}
function clampScreenX() {
    const { minX, maxX } = getScreenBounds();
    screenX = Math.max(minX, Math.min(maxX, screenX));
}
function resetScreenPosition() {
    const padding = 24;
    const hasCam = cameraContainer.classList.contains('active');
    const clientW = previewContainer.clientWidth;
    const videoW = screenVideo.offsetWidth;
    if (!hasCam) {
        // No camera — centre the screen in the container
        screenX = Math.round((clientW - videoW) / 2);
    }
    else if (currentLayout === 'camera-left') {
        const camZoneW = clientW * 0.22 + padding + padding;
        screenX = camZoneW;
    }
    else {
        screenX = padding;
    }
}
// ---------------------------------------------------------------------------
// Apply layout — positions camera on the correct side
// ---------------------------------------------------------------------------
function applyLayout() {
    if (currentLayout === 'camera-left') {
        cameraContainer.style.right = '';
        cameraContainer.style.left = '24px';
    }
    else {
        cameraContainer.style.left = '';
        cameraContainer.style.right = '24px';
    }
    resetScreenPosition();
    fitScreenVideo();
    positionCameraName();
}
// ---------------------------------------------------------------------------
// Camera name overlay — centered above camera
// ---------------------------------------------------------------------------
function positionCameraName() {
    const hasCam = cameraContainer.classList.contains('active');
    if (!overlayName || !hasCam) {
        cameraName.classList.remove('active');
        return;
    }
    // Camera is 22% wide, vertically centred at 70% height, anchored at 24px from one side.
    const containerH = previewContainer.clientHeight;
    const camH = containerH * 0.7;
    const camTop = (containerH - camH) / 2;
    // Place the name above the camera
    const nameTop = camTop - 20;
    const camWidthPct = 22;
    if (currentLayout === 'camera-left') {
        cameraName.style.right = '';
        cameraName.style.left = `calc(24px + ${camWidthPct / 2}%)`;
        cameraName.style.transform = 'translateX(-50%) translateY(-50%)';
    }
    else {
        cameraName.style.left = '';
        cameraName.style.right = `calc(24px + ${camWidthPct / 2}%)`;
        cameraName.style.transform = 'translateX(50%) translateY(-50%)';
    }
    cameraName.style.top = `${Math.round(nameTop)}px`;
    cameraName.style.textAlign = 'center';
    cameraName.classList.add('active');
    positionSocials();
}
// ---------------------------------------------------------------------------
// Social links overlay — positioned centered below the camera name
// ---------------------------------------------------------------------------
function buildSocialsDOM(socials) {
    const platforms = Object.keys(socials);
    activeSocials = platforms
        .filter((p) => socials[p].length > 0)
        .map((p) => ({ platform: p, username: socials[p] }));
    cameraSocials.innerHTML = '';
    for (let i = 0; i < activeSocials.length; i++) {
        const social = activeSocials[i];
        if (!social) {
            continue;
        }
        const { platform, username } = social;
        // Add dot separator between items (but not before a new row)
        // Layout: 2 per row, so dot between index 0–1, 2–3, etc.
        if (i > 0 && i % 2 !== 0) {
            const dot = document.createElement('span');
            dot.className = 'social-dot';
            dot.textContent = '•';
            cameraSocials.appendChild(dot);
        }
        // Force new row after every 2 items by inserting a line break
        if (i > 0 && i % 2 === 0) {
            const br = document.createElement('div');
            br.style.width = '100%';
            cameraSocials.appendChild(br);
        }
        const item = document.createElement('span');
        item.className = 'social-item';
        // Build DOM safely to prevent XSS - never use innerHTML with user input
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', SOCIAL_SVG_PATHS[platform]);
        svg.appendChild(path);
        item.appendChild(svg);
        item.appendChild(document.createTextNode(username));
        cameraSocials.appendChild(item);
    }
}
function positionSocials() {
    const hasCam = cameraContainer.classList.contains('active');
    if (activeSocials.length === 0 || !hasCam) {
        cameraSocials.classList.remove('active');
        return;
    }
    // Position below the camera
    const containerH = previewContainer.clientHeight;
    const camH = containerH * 0.7;
    const camBottom = (containerH + camH) / 2;
    const socialsTop = camBottom + 8;
    const camWidthPct = 22;
    if (currentLayout === 'camera-left') {
        cameraSocials.style.right = '';
        cameraSocials.style.left = '24px';
        cameraSocials.style.transform = '';
    }
    else {
        cameraSocials.style.left = '';
        cameraSocials.style.right = `calc(24px + ${camWidthPct}%)`;
        cameraSocials.style.transform = 'translateX(100%)';
    }
    cameraSocials.style.top = `${Math.round(socialsTop)}px`;
    cameraSocials.classList.add('active');
}
// Re-fit on window resize
window.addEventListener('resize', () => {
    fitScreenVideo();
    positionCameraName();
    // Resize waveform canvas pixel dimensions to match new container size
    if (waveformCanvas.classList.contains('active')) {
        sizeWaveformCanvas();
    }
    // Resize background particle canvas
    if (ambientParticlesEnabled) {
        sizeBgCanvas();
    }
});
// ---------------------------------------------------------------------------
// Horizontal drag for screen video
// ---------------------------------------------------------------------------
let isDragging = false;
let dragStartMouseX = 0;
let dragStartScreenX = 0;
screenVideo.addEventListener('mousedown', (e) => {
    if (e.button !== 0) {
        return;
    }
    isDragging = true;
    dragStartMouseX = e.clientX;
    dragStartScreenX = screenX;
    screenVideo.classList.add('dragging');
    e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
    if (!isDragging) {
        return;
    }
    const dx = e.clientX - dragStartMouseX;
    screenX = dragStartScreenX + dx;
    clampScreenX();
    screenVideo.style.left = `${Math.round(screenX)}px`;
});
window.addEventListener('mouseup', () => {
    if (!isDragging) {
        return;
    }
    isDragging = false;
    screenVideo.classList.remove('dragging');
});
// ---------------------------------------------------------------------------
// Fade helpers
// ---------------------------------------------------------------------------
function fadeOut(el) {
    return new Promise((resolve) => {
        if (!el.classList.contains('active')) {
            resolve();
            return;
        }
        el.classList.remove('active');
        setTimeout(resolve, TRANSITION_MS);
    });
}
function fadeIn(el) {
    // Force a reflow so the browser registers the opacity:0 state before transitioning
    void el.offsetHeight;
    el.classList.add('active');
}
// ---------------------------------------------------------------------------
// Screen preview — uses getDisplayMedia via setDisplayMediaRequestHandler
// ---------------------------------------------------------------------------
async function startScreenPreview(sourceId, animate) {
    // If switching sources, fade out first
    if (animate && screenStream) {
        await fadeOut(screenVideo);
    }
    stopScreenPreviewImmediate();
    try {
        // Tell the main process which source to use, then request display media.
        // The main process setDisplayMediaRequestHandler will match this source ID.
        await window.mainAPI.selectScreenSource(sourceId);
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            audio: false,
            video: true,
        });
        screenVideo.srcObject = screenStream;
        screenVideo.onloadedmetadata = () => {
            resetScreenPosition();
            fitScreenVideo();
            fadeIn(screenVideo);
            // Set capturedBounds based on capture type
            if (isCapturingWindow) {
                // Window capture: fetch actual window bounds from macOS via CGWindowListCopyWindowInfo
                // Use display bounds as fallback until the native query resolves
                capturedBounds = { ...displayBounds };
                void window.mainAPI.getWindowBounds(sourceId).then((bounds) => {
                    if (bounds) {
                        capturedBounds = bounds;
                    }
                });
            }
            else {
                // Screen capture: video shows the full display
                capturedBounds = { ...displayBounds };
            }
        };
        // Start mouse tracking for click-to-zoom
        await window.mainAPI.startMouseTracking();
        startZoomRenderLoop();
        idleState.classList.add('hidden');
    }
    catch (err) {
        console.warn('Screen preview failed:', err);
    }
}
function stopScreenPreviewImmediate() {
    stopZoomRenderLoop();
    void window.mainAPI.stopMouseTracking();
    if (screenStream) {
        for (const track of screenStream.getTracks()) {
            track.stop();
        }
        screenStream = null;
    }
    screenVideo.srcObject = null;
    screenVideo.classList.remove('active');
}
async function stopScreenPreview() {
    stopZoomRenderLoop();
    void window.mainAPI.stopMouseTracking();
    if (screenStream) {
        await fadeOut(screenVideo);
        for (const track of screenStream.getTracks()) {
            track.stop();
        }
        screenStream = null;
    }
    screenVideo.srcObject = null;
    screenVideo.classList.remove('active');
}
// ---------------------------------------------------------------------------
// Camera preview
// ---------------------------------------------------------------------------
async function startCameraPreview(deviceId) {
    stopCameraPreviewImmediate();
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
        });
        cameraVideo.srcObject = cameraStream;
        fadeIn(cameraContainer);
        positionCameraName();
    }
    catch (err) {
        console.warn('Camera preview failed:', err);
    }
}
function stopCameraPreviewImmediate() {
    if (cameraStream) {
        for (const track of cameraStream.getTracks()) {
            track.stop();
        }
        cameraStream = null;
    }
    cameraVideo.srcObject = null;
    cameraContainer.classList.remove('active');
}
async function stopCameraPreview() {
    if (cameraStream) {
        await fadeOut(cameraContainer);
        for (const track of cameraStream.getTracks()) {
            track.stop();
        }
        cameraStream = null;
    }
    cameraVideo.srcObject = null;
    cameraContainer.classList.remove('active');
    cameraName.classList.remove('active');
}
// ---------------------------------------------------------------------------
// Handle preview updates from toolbar
// ---------------------------------------------------------------------------
function updateIdleState() {
    const hasScreen = screenVideo.classList.contains('active') || screenStream !== null;
    const hasCamera = cameraContainer.classList.contains('active') || cameraStream !== null;
    if (hasScreen || hasCamera) {
        idleState.classList.add('hidden');
    }
    else {
        idleState.classList.remove('hidden');
    }
}
window.mainAPI.onPreviewUpdate(async (selection) => {
    const layoutChanged = selection.layout !== currentLayout;
    const screenChanged = selection.screenSourceId !== currentScreenSourceId;
    const cameraChanged = selection.cameraDeviceId !== currentCameraDeviceId;
    currentLayout = selection.layout;
    currentScreenSourceId = selection.screenSourceId;
    currentCameraDeviceId = selection.cameraDeviceId ?? '';
    // Track whether we're capturing a window vs full screen
    isCapturingWindow = selection.screenIsBrowser;
    // Handle camera first so screen sizing accounts for it
    if (cameraChanged) {
        if (selection.cameraDeviceId) {
            await startCameraPreview(selection.cameraDeviceId);
        }
        else {
            await stopCameraPreview();
        }
    }
    // Handle screen
    if (screenChanged) {
        if (selection.screenSourceId) {
            await startScreenPreview(selection.screenSourceId, true);
        }
        else {
            await stopScreenPreview();
        }
    }
    // Handle layout swap (camera side change) — animate positions
    if (layoutChanged) {
        applyLayout();
    }
    else if (!screenChanged) {
        // Camera toggled but screen didn't change — re-fit with animation
        fitScreenVideo();
    }
    // Handle mic for waveform visualization
    const micChanged = selection.micDeviceId !== currentMicDeviceId;
    if (micChanged) {
        if (selection.micDeviceId) {
            await startWaveformCapture(selection.micDeviceId);
        }
        else {
            stopWaveformCapture();
        }
    }
    updateIdleState();
});
// ---------------------------------------------------------------------------
// Canvas-based recording — composites the full preview into a video file
// ---------------------------------------------------------------------------
let recCanvas = null;
let recCtx = null;
let recAnimFrame = null;
let recBorderAngle = 0; // degrees, rotates over time for animated border
let recMediaRecorder = null;
let recChunks = [];
let recMicStream = null;
let recAudioCtx = null;
// Must keep references to Web Audio source nodes to prevent garbage collection,
// which would silently disconnect them and produce silent audio.
let recAudioSources = [];
let recCanvasStream = null;
let recCaptureTrack = null;
let recCombinedStream = null;
let recGeneration = 0;
let recLayoutCache = null;
function buildRecLayoutCache() {
    const containerRect = previewContainer.getBoundingClientRect();
    let cameraNameData = null;
    if (overlayName && cameraName.classList.contains('active')) {
        const rect = cameraName.getBoundingClientRect();
        const cs = window.getComputedStyle(cameraName);
        cameraNameData = {
            rect,
            fontSize: parseFloat(cs.fontSize),
            fontFamily: cs.fontFamily,
            fontWeight: cs.fontWeight,
        };
    }
    const socialItems = [];
    if (activeSocials.length > 0 && cameraSocials.classList.contains('active')) {
        const children = cameraSocials.children;
        for (let ci = 0; ci < children.length; ci++) {
            const child = children[ci];
            if (child.tagName === 'DIV') {
                continue; // row break spacer
            }
            const childRect = child.getBoundingClientRect();
            const cs = window.getComputedStyle(child);
            const entry = {
                type: child.classList.contains('social-dot') ? 'dot' : 'item',
                rect: childRect,
                fontSize: parseFloat(cs.fontSize),
                fontFamily: cs.fontFamily,
                fontWeight: cs.fontWeight,
                color: cs.color,
            };
            if (entry.type === 'item') {
                const svg = child.querySelector('svg');
                if (svg) {
                    entry.svgRect = svg.getBoundingClientRect();
                }
                const textNode = child.childNodes[child.childNodes.length - 1];
                if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                    const range = document.createRange();
                    range.selectNode(textNode);
                    entry.textRect = range.getBoundingClientRect();
                }
            }
            socialItems.push(entry);
        }
    }
    return { containerRect, cameraName: cameraNameData, socialItems };
}
function drawAnimatedBorder(ctx, x, y, w, h, borderWidth, angle) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const angleRad = (angle * Math.PI) / 180;
    const gradient = ctx.createConicGradient(angleRad, cx, cy);
    gradient.addColorStop(0, '#d600ff');
    gradient.addColorStop(0.25, '#00ff9f');
    gradient.addColorStop(0.5, '#00b8ff');
    gradient.addColorStop(0.75, '#001eff');
    gradient.addColorStop(1, '#d600ff');
    ctx.fillStyle = gradient;
    // Draw border as the area between outer and inner rectangles
    ctx.beginPath();
    // Outer rect (clockwise)
    ctx.rect(x - borderWidth, y - borderWidth, w + borderWidth * 2, h + borderWidth * 2);
    // Inner rect (counter-clockwise to cut out)
    ctx.rect(x + w, y, -w, h);
    ctx.fill('evenodd');
}
/** Guard against setInterval frame pileup — skip if previous frame is still rendering */
let recFrameInProgress = false;
let recProfileAccum = {
    total: 0,
    setup: 0,
    screen: 0,
    camera: 0,
    overlays: 0,
    socials: 0,
    actionFeed: 0,
    waveform: 0,
    cinemaFilter: 0,
};
let recProfileFrames = 0;
let recProfileDropped = 0;
let recProfileLastLog = 0;
const REC_PROFILE_LOG_INTERVAL = 3000; // ms between summary logs
const REC_FRAME_BUDGET = 1000 / 30; // 33.3ms at 30fps
function logFrameProfile() {
    const now = performance.now();
    if (now - recProfileLastLog < REC_PROFILE_LOG_INTERVAL || recProfileFrames === 0) {
        return;
    }
    const n = recProfileFrames;
    const avg = (v) => (v / n).toFixed(1);
    const pct = (v) => ((v / recProfileAccum.total) * 100).toFixed(0);
    console.log(`[rec-perf] ${n} frames, ${recProfileDropped} dropped | ` +
        `avg ${avg(recProfileAccum.total)}ms ` +
        `(setup ${avg(recProfileAccum.setup)}ms ${pct(recProfileAccum.setup)}%, ` +
        `screen ${avg(recProfileAccum.screen)}ms ${pct(recProfileAccum.screen)}%, ` +
        `camera ${avg(recProfileAccum.camera)}ms ${pct(recProfileAccum.camera)}%, ` +
        `overlays ${avg(recProfileAccum.overlays)}ms ${pct(recProfileAccum.overlays)}%, ` +
        `socials ${avg(recProfileAccum.socials)}ms ${pct(recProfileAccum.socials)}%, ` +
        `actionFeed ${avg(recProfileAccum.actionFeed)}ms ${pct(recProfileAccum.actionFeed)}%, ` +
        `waveform ${avg(recProfileAccum.waveform)}ms ${pct(recProfileAccum.waveform)}%, ` +
        `cinema ${avg(recProfileAccum.cinemaFilter)}ms ${pct(recProfileAccum.cinemaFilter)}%)`);
    // Reset accumulators
    recProfileAccum = {
        total: 0,
        setup: 0,
        screen: 0,
        camera: 0,
        overlays: 0,
        socials: 0,
        actionFeed: 0,
        waveform: 0,
        cinemaFilter: 0,
    };
    recProfileDropped = 0;
    recProfileFrames = 0;
    recProfileLastLog = now;
}
function drawRecordingFrame() {
    if (!recCtx || !recCanvas) {
        return;
    }
    // Don't draw or push frames while the MediaRecorder is paused.
    // The audio stream pauses with the recorder, but if we keep calling
    // requestFrame() the video track accumulates frames that desync
    // from audio on resume.
    if (recMediaRecorder && recMediaRecorder.state === 'paused') {
        return;
    }
    if (recFrameInProgress) {
        recProfileDropped++;
        return; // previous frame still rendering — skip to prevent pileup
    }
    recFrameInProgress = true;
    const t0 = performance.now();
    // Use cached container rect (populated at recording start, refreshed on overlay change)
    const containerRect = recLayoutCache?.containerRect ?? previewContainer.getBoundingClientRect();
    const w = recCanvas.width;
    const h = recCanvas.height;
    // Uniform scale — preserves aspect ratio, centres content with letterboxing
    const scale = Math.min(w / containerRect.width, h / containerRect.height);
    const offsetX = (w - containerRect.width * scale) / 2;
    const offsetY = (h - containerRect.height * scale) / 2;
    // Update animated border angle (4s cycle at ~30fps)
    recBorderAngle = (recBorderAngle + 360 / (4 * REC_FRAMERATE)) % 360;
    // Background (fills any letterbox areas too)
    recCtx.fillStyle = bgColor;
    recCtx.fillRect(0, 0, w, h);
    // Mesh gradient background (replaces solid fill visually)
    if (activeBgStyle === 'mesh' && meshBlobs.length > 0) {
        const meshTime = performance.now() / 1000 - meshStartTime;
        drawMeshGradient(recCtx, w, h, meshTime);
    }
    // Ambient particles on background
    if (ambientParticlesEnabled) {
        updateAmbientParticles(1 / REC_FRAMERATE);
        drawAmbientParticles(recCtx, w, h);
    }
    // Update smooth mouse + zoom for recording frame
    updateSmoothMouse();
    const tSetup = performance.now();
    // Draw screen video (with click-to-zoom crop)
    // Compensate for Display P3 → sRGB gamut compression when canvas captures
    // macOS <video> elements.  A slight saturation/contrast bump restores the
    // vibrancy lost in the colour-space conversion.
    if (screenVideo.classList.contains('active') && screenStream) {
        // Use layout dimensions (offsetWidth/Height) instead of getBoundingClientRect()
        // so that CSS scale transforms from zoom don't inflate the destination size.
        const layoutW = screenVideo.offsetWidth;
        const layoutH = screenVideo.offsetHeight;
        const layoutLeft = screenVideo.offsetLeft;
        // offsetTop gives CSS `top: 50%` but doesn't include `translateY(-50%)`
        // which visually centres the element, so we compute the centred position manually.
        const layoutTop = screenVideo.offsetTop - layoutH / 2;
        const x = offsetX + layoutLeft * scale;
        const y = offsetY + layoutTop * scale;
        const vw = layoutW * scale;
        const vh = layoutH * scale;
        // Animated gradient border (drawn before vibrancy filter so border stays clean)
        const border = 4 * scale;
        drawAnimatedBorder(recCtx, x, y, vw, vh, border, recBorderAngle);
        // Clip all screen content (video + cursor) to the screen area
        recCtx.save();
        recCtx.beginPath();
        recCtx.rect(x, y, vw, vh);
        recCtx.clip();
        // Apply vibrancy boost only to the screen drawImage calls
        recCtx.filter = 'saturate(1.12) contrast(1.03)';
        // Apply zoom crop to the source video
        const natW = screenVideo.videoWidth;
        const natH = screenVideo.videoHeight;
        if (currentZoom > 1.0 && natW && natH) {
            // Crop region size (inverse of zoom)
            const cropW = natW / currentZoom;
            const cropH = natH / currentZoom;
            // Get mouse position relative to captured content
            const relPos = getMouseRelativeToCaptured();
            if (relPos) {
                // Centre crop on mouse position, clamped to bounds
                let cropX = relPos.relX * natW - cropW / 2;
                let cropY = relPos.relY * natH - cropH / 2;
                cropX = Math.max(0, Math.min(natW - cropW, cropX));
                cropY = Math.max(0, Math.min(natH - cropH, cropY));
                recCtx.drawImage(screenVideo, cropX, cropY, cropW, cropH, x, y, vw, vh);
            }
            else {
                // Fallback: draw full video if no valid mouse position
                recCtx.drawImage(screenVideo, x, y, vw, vh);
            }
        }
        else {
            // No zoom — draw full video
            recCtx.drawImage(screenVideo, x, y, vw, vh);
        }
        // Reset vibrancy filter after screen draw
        recCtx.filter = 'none';
        recCtx.restore(); // restore clip
    }
    const tScreen = performance.now();
    // Cache camera bounding rect — used by multiple draw stages below
    const hasCamActive = cameraContainer.classList.contains('active') && cameraStream;
    const camRect = hasCamActive ? cameraVideo.getBoundingClientRect() : null;
    let camCanvasX = 0;
    let camCanvasY = 0;
    let camCanvasW = 0;
    let camCanvasH = 0;
    if (camRect) {
        camCanvasX = offsetX + (camRect.left - containerRect.left) * scale;
        camCanvasY = offsetY + (camRect.top - containerRect.top) * scale;
        camCanvasW = camRect.width * scale;
        camCanvasH = camRect.height * scale;
    }
    // Draw camera video (mirrored) — with cinema filter applied only to camera
    if (hasCamActive && camRect) {
        const x = camCanvasX;
        const y = camCanvasY;
        const vw = camCanvasW;
        const vh = camCanvasH;
        // Animated gradient border
        const border = 4 * scale;
        drawAnimatedBorder(recCtx, x, y, vw, vh, border, recBorderAngle);
        // Apply combined enhancement + cinema filter to camera only
        const recEnhFilter = buildEnhancementFilter(activeCameraEnhancement);
        const recCinFilter = getCinemaCanvas(activeCinemaFilter);
        const recCombined = [recEnhFilter, recCinFilter].filter(Boolean).join(' ');
        if (recCombined) {
            recCtx.filter = recCombined;
        }
        // Camera uses object-fit: cover — manually crop to match
        const natW = cameraVideo.videoWidth;
        const natH = cameraVideo.videoHeight;
        if (natW && natH) {
            const drawAspect = camRect.width / camRect.height;
            const vidAspect = natW / natH;
            let sx, sy, sw, sh;
            if (vidAspect > drawAspect) {
                sh = natH;
                sw = sh * drawAspect;
                sx = (natW - sw) / 2;
                sy = 0;
            }
            else {
                sw = natW;
                sh = sw / drawAspect;
                sx = 0;
                sy = (natH - sh) / 2;
            }
            // Mirror the camera by flipping horizontally
            recCtx.save();
            recCtx.translate(x + vw, y);
            recCtx.scale(-1, 1);
            recCtx.drawImage(cameraVideo, sx, sy, sw, sh, 0, 0, vw, vh);
            recCtx.restore();
        }
        // Reset filter after camera draw
        if (recCombined) {
            recCtx.filter = 'none';
        }
    }
    const tCamera = performance.now();
    // Draw camera name text (above camera) — uses cached layout measurements
    if (recLayoutCache?.cameraName) {
        const cn = recLayoutCache.cameraName;
        const cx = offsetX + (cn.rect.left - containerRect.left + cn.rect.width / 2) * scale;
        const cy = offsetY + (cn.rect.top - containerRect.top + cn.rect.height / 2) * scale;
        const fontSize = cn.fontSize * scale;
        recCtx.fillStyle = '#ffffff';
        recCtx.font = `${cn.fontWeight} ${fontSize}px ${cn.fontFamily}`;
        recCtx.textAlign = 'center';
        recCtx.textBaseline = 'middle';
        recCtx.fillText(overlayName, cx, cy);
    }
    const tOverlays = performance.now();
    // Draw social links — uses cached layout measurements for pixel-perfect match
    if (recLayoutCache && recLayoutCache.socialItems.length > 0) {
        let socialIdx = 0; // tracks which activeSocials entry we're on
        for (const item of recLayoutCache.socialItems) {
            const cx = offsetX + (item.rect.left - containerRect.left) * scale;
            const cy = offsetY + (item.rect.top - containerRect.top) * scale;
            const cw = item.rect.width * scale;
            const ch = item.rect.height * scale;
            if (item.type === 'dot') {
                // Draw dot separator
                const dotFontSize = item.fontSize * scale;
                recCtx.fillStyle = item.color;
                recCtx.font = `${item.fontWeight} ${dotFontSize}px ${item.fontFamily}`;
                recCtx.textAlign = 'center';
                recCtx.textBaseline = 'middle';
                recCtx.fillText('•', cx + cw / 2, cy + ch / 2);
            }
            else {
                // Draw SVG icon
                const socialEntry = socialIdx < activeSocials.length ? activeSocials[socialIdx] : undefined;
                if (item.svgRect && socialEntry) {
                    const svgX = offsetX + (item.svgRect.left - containerRect.left) * scale;
                    const svgY = offsetY + (item.svgRect.top - containerRect.top) * scale;
                    const svgSize = item.svgRect.width * scale;
                    const iconScale = svgSize / 24; // SVG paths use 24x24 viewBox
                    recCtx.save();
                    recCtx.translate(svgX, svgY);
                    recCtx.scale(iconScale, iconScale);
                    recCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                    recCtx.fill(getSocialPath2D(socialEntry.platform));
                    recCtx.restore();
                }
                // Draw username text
                const itemFontSize = item.fontSize * scale;
                if (item.textRect && socialEntry) {
                    const textX = offsetX + (item.textRect.left - containerRect.left) * scale;
                    const textY = offsetY + (item.textRect.top - containerRect.top) * scale;
                    const textH = item.textRect.height * scale;
                    recCtx.fillStyle = item.color;
                    recCtx.font = `${item.fontWeight} ${itemFontSize}px ${item.fontFamily}`;
                    recCtx.textAlign = 'left';
                    recCtx.textBaseline = 'middle';
                    recCtx.fillText(socialEntry.username, textX, textY + textH / 2);
                }
                socialIdx++;
            }
        }
    }
    const tSocials = performance.now();
    // Draw action feed overlaid on the camera area (bottom-right)
    if (hasCamActive && actionFeedItems.length > 0) {
        drawActionFeedOnCanvas(recCtx, { x: camCanvasX, y: camCanvasY, w: camCanvasW, h: camCanvasH }, scale);
    }
    const tActionFeed = performance.now();
    // Draw waveform at bottom of camera area
    if (hasCamActive) {
        drawWaveformOnCanvas(recCtx, camCanvasX, camCanvasY, camCanvasW, camCanvasH, scale);
    }
    const tWaveform = performance.now();
    // Cinema post-processing: shadow tints, highlight washes (camera-only effect)
    if (hasCamActive) {
        applyRecordingCinemaFilter(recCtx, { x: camCanvasX, y: camCanvasY, w: camCanvasW, h: camCanvasH }, activeCinemaFilter);
    }
    // CTA popup overlay — slides in from bottom during recording
    if (ctaIsVisible && ctaText) {
        drawCtaOnCanvas(recCtx, w, h, scale);
    }
    const tEnd = performance.now();
    // Accumulate profiling data
    recProfileAccum.total += tEnd - t0;
    recProfileAccum.setup += tSetup - t0;
    recProfileAccum.screen += tScreen - tSetup;
    recProfileAccum.camera += tCamera - tScreen;
    recProfileAccum.overlays += tOverlays - tCamera;
    recProfileAccum.socials += tSocials - tOverlays;
    recProfileAccum.actionFeed += tActionFeed - tSocials;
    recProfileAccum.waveform += tWaveform - tActionFeed;
    recProfileAccum.cinemaFilter += tEnd - tWaveform;
    recProfileFrames++;
    // Log warning for individual slow frames
    const frameTime = tEnd - t0;
    if (frameTime > REC_FRAME_BUDGET * 1.5) {
        console.warn(`[rec-perf] SLOW FRAME ${frameTime.toFixed(1)}ms: ` +
            `setup=${(tSetup - t0).toFixed(1)} screen=${(tScreen - tSetup).toFixed(1)} ` +
            `camera=${(tCamera - tScreen).toFixed(1)} overlays=${(tOverlays - tCamera).toFixed(1)} ` +
            `socials=${(tSocials - tOverlays).toFixed(1)} actionFeed=${(tActionFeed - tSocials).toFixed(1)} ` +
            `waveform=${(tWaveform - tActionFeed).toFixed(1)} ` +
            `cinema=${(tEnd - tWaveform).toFixed(1)}`);
    }
    logFrameProfile();
    // Feed data to performance monitor (only when visible to avoid overhead)
    if ((0, perf_monitor_1.isVisible)()) {
        (0, perf_monitor_1.updatePipelineState)({
            isRecording: true,
            profile: { ...recProfileAccum },
            frameCount: recProfileFrames,
            droppedFrames: recProfileDropped,
            recorderState: recMediaRecorder?.state ?? null,
            chunkCount: recChunks.length,
            targetFps: REC_FRAMERATE,
        });
    }
    // Manually push this frame into the capture stream. We use captureStream(0)
    // (manual mode) so frames are delivered even when the window is hidden and
    // Chromium would otherwise throttle automatic capture to ~1 fps.
    if (recCaptureTrack) {
        recCaptureTrack.requestFrame();
    }
    recFrameInProgress = false;
}
// Pick the best MIME type + extension for recording.
// Prefer MP4/H.264 (YouTube-optimal), fall back to WebM/VP9.
function pickRecordingFormat() {
    // Use avc3 (not avc1) — avc3 embeds codec parameters inline per frame,
    // so the encoder tolerates dynamic changes from captureStream() without
    // stalling. avc1 requires a fixed codec description for the entire
    // recording, which causes frame drops when the canvas content changes.
    // H.264 High Profile + AAC-LC (YouTube-optimal)
    // Level 4.0 for 1080p output, fall back to Level 5.1 (4K-capable), then generic
    const mp4Candidates = [
        'video/mp4;codecs=avc3.640028,mp4a.40.2',
        'video/mp4;codecs=avc3.640028',
        'video/mp4;codecs=avc3.640033,mp4a.40.2',
        'video/mp4;codecs=avc3.640033',
        'video/mp4;codecs=avc3',
        // Fall back to avc1 if avc3 is not supported
        'video/mp4;codecs=avc1.640028,mp4a.40.2',
        'video/mp4;codecs=avc1.640028',
        'video/mp4;codecs=avc1.640033,mp4a.40.2',
        'video/mp4;codecs=avc1.640033',
        'video/mp4;codecs=avc1',
        'video/mp4',
    ];
    for (const mime of mp4Candidates) {
        if (MediaRecorder.isTypeSupported(mime)) {
            return { mimeType: mime, extension: 'mp4' };
        }
    }
    // Fallback to WebM
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        return { mimeType: 'video/webm;codecs=vp9', extension: 'webm' };
    }
    return { mimeType: 'video/webm', extension: 'webm' };
}
// YouTube-optimal recording settings for 1080p (1080p) SDR uploads:
// - Video: 8-12 Mbps at 30fps → we use 12 Mbps for headroom
// - Audio: AAC-LC stereo at 48 kHz, 384 kbps (YouTube's stereo recommendation)
// - Container: MP4 with H.264 High Profile
const REC_VIDEO_BITRATE = 12_000_000;
const REC_AUDIO_BITRATE = 384_000;
const REC_AUDIO_SAMPLE_RATE = 48_000;
const REC_FRAMERATE = 30;
async function startCanvasRecording(micDeviceId) {
    // Bump generation so any in-flight onstop/onerror from a previous session
    // will detect the mismatch and skip cleanup (the new session owns those vars).
    recGeneration++;
    const myGeneration = recGeneration;
    // Clean up any previous recording resources to prevent leaks
    if (recAnimFrame !== null) {
        clearInterval(recAnimFrame);
        recAnimFrame = null;
    }
    if (recMediaRecorder && recMediaRecorder.state !== 'inactive') {
        recMediaRecorder.stop();
        recMediaRecorder = null;
    }
    // Reset recChunks immediately after stopping the old recorder so that any
    // stale ondataavailable events from the previous session can't push old
    // data into the new recording's chunk array.
    recChunks = [];
    if (recCanvasStream) {
        for (const track of recCanvasStream.getTracks()) {
            track.stop();
        }
        recCanvasStream = null;
    }
    const outputW = 1920;
    const outputH = 1080;
    recCanvas = document.createElement('canvas');
    recCanvas.width = outputW;
    recCanvas.height = outputH;
    recCtx = recCanvas.getContext('2d');
    // Start compositing loop — use setInterval for consistent frame delivery
    // (requestAnimationFrame is throttled when the window is backgrounded)
    // If we're restarting from playback mode (e.g. retry), restore the preview
    // container so layout calculations get valid dimensions.
    if (!playbackContainer.classList.contains('hidden')) {
        exitPlaybackMode();
    }
    recAnimFrame = setInterval(drawRecordingFrame, 1000 / REC_FRAMERATE);
    recLayoutCache = buildRecLayoutCache();
    // Get canvas video stream in manual mode (0 = no automatic capture).
    // We call requestFrame() explicitly after each draw so frames are captured
    // even when the window is hidden / throttled by Chromium.
    recCanvasStream = recCanvas.captureStream(0);
    recCaptureTrack = recCanvasStream.getVideoTracks()[0] ?? null;
    const combinedTracks = [...recCanvasStream.getVideoTracks()];
    // Stop the waveform visualizer's mic capture — having two concurrent
    // getUserMedia streams on the same device can cause one to receive silence
    // on macOS / Chromium.  Save the device ID first so we can restart after
    // recording ends (stopWaveformCapture nulls currentMicDeviceId).
    savedMicDeviceIdForRestart = currentMicDeviceId;
    stopWaveformCapture();
    // Capture mic audio if selected
    const audioTracks = [];
    if (micDeviceId) {
        try {
            recMicStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: { exact: micDeviceId },
                    sampleRate: { ideal: REC_AUDIO_SAMPLE_RATE },
                    channelCount: { ideal: 2 },
                },
                video: false,
            });
            const micTracks = recMicStream.getAudioTracks();
            audioTracks.push(...micTracks);
        }
        catch (err) {
            console.warn('Mic capture for recording failed:', err);
        }
    }
    // Always route audio through AudioContext → MediaStreamDestination.
    // Chromium's MP4 MediaRecorder has a bug where it silently produces empty
    // audio when a raw getUserMedia audio track is combined with a canvas
    // captureStream video track. Routing through AudioContext creates a
    // "synthetic" MediaStreamTrack from the destination node, which the
    // MP4 muxer handles correctly.
    if (audioTracks.length > 0) {
        recAudioCtx = new AudioContext({ sampleRate: REC_AUDIO_SAMPLE_RATE });
        await recAudioCtx.resume();
        const dest = recAudioCtx.createMediaStreamDestination();
        recAudioSources = [];
        for (const track of audioTracks) {
            const source = recAudioCtx.createMediaStreamSource(new MediaStream([track]));
            source.connect(dest);
            recAudioSources.push(source); // prevent GC from disconnecting the node
        }
        combinedTracks.push(...dest.stream.getAudioTracks());
    }
    recCombinedStream = new MediaStream(combinedTracks);
    const { mimeType } = pickRecordingFormat();
    console.log('[rec] Selected recording format:', mimeType);
    // Track the active mimeType for this session — may change on encoder fallback
    let activeMimeType = mimeType;
    recMediaRecorder = new MediaRecorder(recCombinedStream, {
        mimeType,
        videoBitsPerSecond: REC_VIDEO_BITRATE,
        audioBitsPerSecond: REC_AUDIO_BITRATE,
    });
    recChunks = [];
    recMediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
            recChunks.push(e.data);
        }
    };
    // Track whether a fallback recorder has taken over — prevents the old
    // recorder's onstop from cleaning up resources the fallback still needs.
    let fallbackActive = false;
    recMediaRecorder.onerror = (event) => {
        if (myGeneration !== recGeneration) {
            return; // stale session — new recording owns the shared state
        }
        const error = event.error;
        console.error('[rec] MediaRecorder error:', error?.name, error?.message);
        // Encoder initialization can fail even when isTypeSupported() returns true
        // (Chromium bug). If the encoder failed with the current format, retry with
        // a WebM fallback before giving up completely.
        if (error?.name === 'EncodingError' &&
            recCombinedStream &&
            !activeMimeType.startsWith('video/webm')) {
            console.warn('[rec] MP4 encoder failed — retrying with WebM fallback');
            recChunks = [];
            const webmMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
                ? 'video/webm;codecs=vp9'
                : 'video/webm';
            activeMimeType = webmMime;
            console.log('[rec] Fallback format:', webmMime);
            try {
                // Mark fallback as active BEFORE creating the new recorder so the
                // old recorder's onstop (which may fire after onerror) is a no-op.
                fallbackActive = true;
                recMediaRecorder = new MediaRecorder(recCombinedStream, {
                    mimeType: webmMime,
                    videoBitsPerSecond: REC_VIDEO_BITRATE,
                    audioBitsPerSecond: REC_AUDIO_BITRATE,
                });
                recMediaRecorder.ondataavailable = (ev) => {
                    if (ev.data.size > 0) {
                        recChunks.push(ev.data);
                    }
                };
                recMediaRecorder.onerror = (ev) => {
                    if (myGeneration !== recGeneration) {
                        return;
                    }
                    const err2 = ev.error;
                    console.error('[rec] Fallback MediaRecorder also failed:', err2?.name, err2?.message);
                    cleanupRecordingResources();
                };
                recMediaRecorder.onstop = () => {
                    if (myGeneration !== recGeneration) {
                        return;
                    }
                    if (recAnimFrame) {
                        clearInterval(recAnimFrame);
                        recAnimFrame = null;
                    }
                    const blob = new Blob(recChunks, { type: webmMime });
                    pendingRecordingBlob = blob;
                    enterPlaybackMode(blob);
                    cleanupRecordingResources();
                };
                recMediaRecorder.start(1000);
                console.log('[rec] Fallback MediaRecorder started successfully');
                return;
            }
            catch (fallbackErr) {
                console.error('[rec] Failed to create fallback MediaRecorder:', fallbackErr);
                fallbackActive = false;
            }
        }
        cleanupRecordingResources();
    };
    /** Clean up all recording resources (streams, audio, canvas) */
    function cleanupRecordingResources() {
        // Clean up compositing loop
        if (recAnimFrame) {
            clearInterval(recAnimFrame);
            recAnimFrame = null;
        }
        // Clean up canvas stream tracks
        if (recCanvasStream) {
            for (const track of recCanvasStream.getTracks()) {
                track.stop();
            }
            recCanvasStream = null;
        }
        // Clean up combined stream tracks
        if (recCombinedStream) {
            for (const track of recCombinedStream.getTracks()) {
                track.stop();
            }
            recCombinedStream = null;
        }
        // Clean up mic stream
        if (recMicStream) {
            for (const track of recMicStream.getTracks()) {
                track.stop();
            }
            recMicStream = null;
        }
        // Disconnect audio source nodes before closing context
        for (const src of recAudioSources) {
            src.disconnect();
        }
        recAudioSources = [];
        if (recAudioCtx) {
            void recAudioCtx.close();
            recAudioCtx = null;
        }
        recLayoutCache = null;
        recCaptureTrack = null;
        recCanvas = null;
        recCtx = null;
        recMediaRecorder = null;
        recChunks = [];
    }
    recMediaRecorder.onstop = () => {
        if (myGeneration !== recGeneration) {
            return; // stale session — new recording owns the shared state
        }
        // If a fallback recorder took over, this is the OLD recorder's onstop
        // firing after its onerror — ignore it so we don't kill the fallback.
        if (fallbackActive) {
            return;
        }
        // Stop compositing loop
        if (recAnimFrame) {
            clearInterval(recAnimFrame);
            recAnimFrame = null;
        }
        const blob = new Blob(recChunks, { type: activeMimeType });
        // Store blob for playback/export and enter playback mode
        pendingRecordingBlob = blob;
        enterPlaybackMode(blob);
        // Clean up canvas stream tracks
        if (recCanvasStream) {
            for (const track of recCanvasStream.getTracks()) {
                track.stop();
            }
            recCanvasStream = null;
        }
        // Clean up combined stream tracks
        if (recCombinedStream) {
            for (const track of recCombinedStream.getTracks()) {
                track.stop();
            }
            recCombinedStream = null;
        }
        // Clean up mic stream
        if (recMicStream) {
            for (const track of recMicStream.getTracks()) {
                track.stop();
            }
            recMicStream = null;
        }
        // Disconnect audio source nodes before closing context
        for (const src of recAudioSources) {
            src.disconnect();
        }
        recAudioSources = [];
        if (recAudioCtx) {
            void recAudioCtx.close();
            recAudioCtx = null;
        }
        recLayoutCache = null;
        recCaptureTrack = null;
        recCanvas = null;
        recCtx = null;
        recMediaRecorder = null;
        recChunks = [];
    };
    recMediaRecorder.start(1000);
    // Signal main process that recording is fully started (mic acquired,
    // MediaRecorder running). Main process will now hide the window.
    // Hiding before this point causes Chromium to deliver a silent audio track.
    window.mainAPI.signalRecordingReady();
}
// ---------------------------------------------------------------------------
// Playback mode — shows recorded video with Export/Exit buttons
// ---------------------------------------------------------------------------
let pendingRecordingBlob = null;
let playbackBlobUrl = null;
async function enterPlaybackMode(blob) {
    console.log('[rec] enterPlaybackMode — blob size:', blob.size, 'type:', blob.type);
    // Show processing indicator
    previewContainer.style.display = 'none';
    processingSub.textContent = 'Remuxing and enhancing audio';
    processingOverlay.classList.remove('hidden');
    // Send blob to main process for remuxing (fMP4 → faststart MP4)
    // This fixes Chromium's inability to play fMP4 blob URLs smoothly
    try {
        processingSub.textContent = 'Converting to playback format...';
        const arrayBuffer = await blob.arrayBuffer();
        console.log('[rec] Sending buffer to preparePlayback, size:', arrayBuffer.byteLength);
        processingSub.textContent = 'Re-encoding video for preview...';
        const filePath = await window.mainAPI.preparePlayback(arrayBuffer);
        console.log('[rec] Got remuxed file path:', filePath);
        playbackVideo.src = `file://${filePath}`;
        console.log('[rec] Set playbackVideo.src to file:// URL');
    }
    catch (err) {
        console.warn('[rec] Playback preparation failed, falling back to blob URL:', err);
        playbackBlobUrl = URL.createObjectURL(blob);
        playbackVideo.src = playbackBlobUrl;
    }
    // Hide processing indicator
    processingOverlay.classList.add('hidden');
    // Log video events for debugging
    playbackVideo.onloadedmetadata = () => {
        console.log('[rec] Video loadedmetadata — duration:', playbackVideo.duration, 'videoWidth:', playbackVideo.videoWidth, 'videoHeight:', playbackVideo.videoHeight);
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
function exitPlaybackMode() {
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
    // These were running before recording started but the recording cleanup
    // (which stops streams, nulls state) doesn't restart them.
    if (screenStream) {
        void window.mainAPI.startMouseTracking();
        startZoomRenderLoop();
    }
    // Restart waveform mic capture if a mic was selected before recording.
    // Recording calls stopWaveformCapture() to avoid dual-stream issues on macOS;
    // we need to re-acquire it now that the recording mic is released.
    // We use savedMicDeviceIdForRestart because stopWaveformCapture() nulls
    // currentMicDeviceId during recording teardown.
    if (savedMicDeviceIdForRestart) {
        void startWaveformCapture(savedMicDeviceIdForRestart);
        savedMicDeviceIdForRestart = null;
    }
}
playbackExportBtn.addEventListener('click', () => {
    void (async () => {
        if (!pendingRecordingBlob) {
            return;
        }
        const filePath = await window.mainAPI.exportRecording();
        if (!filePath) {
            return; // user cancelled
        }
        // Show processing overlay during export (FFmpeg post-processing can be slow)
        playbackContainer.classList.add('hidden');
        processingSub.textContent = 'Preparing file for export...';
        processingOverlay.classList.remove('hidden');
        try {
            processingSub.textContent = 'Writing recording data...';
            const arrayBuffer = await pendingRecordingBlob.arrayBuffer();
            processingSub.textContent = 'Enhancing audio and finalizing...';
            await window.mainAPI.saveRecording(filePath, arrayBuffer);
            console.log('[rec] Export complete:', filePath);
        }
        catch (err) {
            console.error('Failed to export recording:', err);
        }
        processingOverlay.classList.add('hidden');
        exitPlaybackMode();
    })();
});
playbackExitBtn.addEventListener('click', () => {
    exitPlaybackMode();
});
// ---------------------------------------------------------------------------
window.mainAPI.onRecordingStart((micDeviceId) => {
    console.log('[rec] onRecordingStart received, micDeviceId:', micDeviceId);
    startCanvasRecording(micDeviceId).catch((error) => {
        console.error('Failed to start recording:', error);
    });
    startCtaLoop();
});
window.mainAPI.onRecordingStop(() => {
    stopCtaLoop();
    if (!recMediaRecorder) {
        // Stale stop signal (e.g. app restart) — ignore silently
        return;
    }
    console.log('[rec] onRecordingStop received, recMediaRecorder:', recMediaRecorder.state, 'chunks:', recChunks.length);
    if (recMediaRecorder.state !== 'inactive') {
        recMediaRecorder.stop();
    }
});
window.mainAPI.onRecordingPause(() => {
    if (recMediaRecorder && recMediaRecorder.state === 'recording') {
        recMediaRecorder.pause();
    }
});
window.mainAPI.onRecordingResume(() => {
    if (recMediaRecorder && recMediaRecorder.state === 'paused') {
        recMediaRecorder.resume();
    }
});
// ---------------------------------------------------------------------------
// Overlay settings
// ---------------------------------------------------------------------------
function applyOverlay(settings) {
    overlayName = settings.name;
    if (overlayName) {
        wrapNameInCharSpans(overlayName);
        if (settings.nameFont) {
            cameraName.style.fontFamily = `"${settings.nameFont}", sans-serif`;
        }
        if (settings.nameFontSize) {
            cameraName.style.fontSize = `${settings.nameFontSize}px`;
        }
        cameraName.hidden = false;
        positionCameraName();
        startMagnifyLoop();
    }
    else {
        stopMagnifyLoop();
        cameraName.hidden = true;
        cameraName.classList.remove('active');
    }
    if (settings.bgColor) {
        bgColor = settings.bgColor;
    }
    // CSS background is set after bgStyle is resolved (below)
    if (settings.socials) {
        buildSocialsDOM(settings.socials);
        positionSocials();
    }
    else {
        activeSocials = [];
        cameraSocials.innerHTML = '';
        cameraSocials.classList.remove('active');
    }
    // Apply cinema filter + camera enhancement to live preview
    activeCinemaFilter = settings.cinemaFilter ?? 'none';
    if (settings.cameraEnhancement) {
        activeCameraEnhancement = settings.cameraEnhancement;
    }
    applyCameraFiltersToPreview();
    // Mesh gradient background
    const newBgStyle = settings.bgStyle ?? 'solid';
    const bgStyleChanged = newBgStyle !== activeBgStyle;
    const colorChanged = settings.bgColor !== meshBlobsColor;
    activeBgStyle = newBgStyle;
    if (activeBgStyle === 'mesh') {
        // Make CSS background transparent so canvas mesh gradient shows through
        previewContainer.style.background = 'transparent';
        if (bgStyleChanged || colorChanged || meshBlobs.length === 0) {
            initMeshBlobs(bgColor);
            sizeBgCanvas();
            if (meshStartTime === 0) {
                meshStartTime = performance.now() / 1000;
            }
        }
        startMeshLoop();
    }
    else {
        // Solid mode — use CSS background color
        previewContainer.style.background = bgColor;
        if (bgStyleChanged) {
            // Switched away from mesh — clear bg canvas
            bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
        }
    }
    // Ambient particles
    const wantParticles = settings.ambientParticles ?? false;
    if (wantParticles && !ambientParticlesEnabled) {
        initAmbientParticles();
        sizeBgCanvas();
        // Start a standalone particle animation if the zoom render loop isn't running
        startParticleLoop();
    }
    ambientParticlesEnabled = wantParticles;
    if (!wantParticles) {
        bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    }
    // Mouse zoom settings
    {
        const range = clickZoomRange(settings.mouseZoom ?? MOUSE_ZOOM_DEFAULT);
        activeClickZoomMin = range.min;
        activeClickZoomMax = range.max;
    }
    if (settings.zoomLingerMs !== undefined) {
        zoomLingerTime = Math.max(500, Math.min(5000, settings.zoomLingerMs));
    }
    // CTA popup text + font (uses same font as name overlay)
    const prevCtaText = ctaText;
    const prevCtaInterval = ctaIntervalMs;
    ctaText = settings.ctaText ?? '';
    ctaIcon = settings.ctaIcon ?? '';
    ctaIntervalMs = Math.max(45000, Math.min(180000, settings.ctaIntervalMs ?? 180000));
    ctaFont = settings.nameFont || 'Datatype';
    // Restart CTA loop if text or interval changed (runs in both preview and recording)
    if (ctaText !== prevCtaText || ctaIntervalMs !== prevCtaInterval) {
        if (ctaText) {
            startCtaLoop();
        }
        else {
            stopCtaLoop();
        }
    }
    // Refresh recording layout cache if recording is active
    if (recAnimFrame !== null) {
        recLayoutCache = buildRecLayoutCache();
    }
}
window.mainAPI.onOverlayUpdate(applyOverlay);
// ---------------------------------------------------------------------------
// Audio Waveform Visualizer — real-time frequency bars from mic input
// ---------------------------------------------------------------------------
const WAVEFORM_BAR_COUNT = 48;
const WAVEFORM_BAR_WIDTH = 3; // px in preview space
const WAVEFORM_BAR_GAP = 2; // px between bars
const WAVEFORM_HEIGHT = 48; // px — matches CSS height
const WAVEFORM_FFT_SIZE = 256;
let waveformAudioCtx = null;
let waveformAnalyser = null;
let waveformSource = null;
let waveformMicStream = null;
let waveformAnimFrame = 0;
let waveformFreqData = new Uint8Array(0);
let currentMicDeviceId = null;
let savedMicDeviceIdForRestart = null;
/** Set the waveform canvas pixel dimensions for DPR-crisp rendering.
 *  CSS handles position/size (bottom of camera container). */
function sizeWaveformCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = waveformCanvas.clientWidth;
    const cssH = waveformCanvas.clientHeight;
    if (cssW > 0 && cssH > 0) {
        waveformCanvas.width = Math.round(cssW * dpr);
        waveformCanvas.height = Math.round(cssH * dpr);
    }
}
async function startWaveformCapture(deviceId) {
    stopWaveformCapture();
    try {
        waveformMicStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: deviceId } },
            video: false,
        });
        waveformAudioCtx = new AudioContext();
        waveformAnalyser = waveformAudioCtx.createAnalyser();
        waveformAnalyser.fftSize = WAVEFORM_FFT_SIZE;
        waveformAnalyser.smoothingTimeConstant = 0.8;
        waveformSource = waveformAudioCtx.createMediaStreamSource(waveformMicStream);
        waveformSource.connect(waveformAnalyser);
        waveformFreqData = new Uint8Array(waveformAnalyser.frequencyBinCount);
        currentMicDeviceId = deviceId;
        // Size the canvas pixel dimensions for DPR-crisp rendering
        sizeWaveformCanvas();
        waveformCanvas.classList.add('active');
        if (!waveformAnimFrame) {
            waveformAnimFrame = requestAnimationFrame(renderWaveform);
        }
    }
    catch (err) {
        console.warn('Waveform mic capture failed:', err);
    }
}
function stopWaveformCapture() {
    if (waveformMicStream) {
        for (const track of waveformMicStream.getTracks()) {
            track.stop();
        }
        waveformMicStream = null;
    }
    if (waveformSource) {
        waveformSource.disconnect();
        waveformSource = null;
    }
    if (waveformAudioCtx) {
        void waveformAudioCtx.close();
        waveformAudioCtx = null;
    }
    waveformAnalyser = null;
    currentMicDeviceId = null;
    waveformCanvas.classList.remove('active');
    if (waveformAnimFrame) {
        cancelAnimationFrame(waveformAnimFrame);
        waveformAnimFrame = 0;
    }
}
function renderWaveform() {
    if (!waveformAnalyser) {
        waveformAnimFrame = 0;
        return;
    }
    waveformAnalyser.getByteFrequencyData(waveformFreqData);
    const dpr = window.devicePixelRatio || 1;
    const cw = waveformCanvas.width;
    const ch = waveformCanvas.height;
    waveformCtx.clearRect(0, 0, cw, ch);
    const barW = WAVEFORM_BAR_WIDTH * dpr;
    const gap = WAVEFORM_BAR_GAP * dpr;
    const totalBarsW = WAVEFORM_BAR_COUNT * (barW + gap) - gap;
    const startX = (cw - totalBarsW) / 2;
    // Map frequency bins to bar count
    const binCount = waveformFreqData.length;
    const binsPerBar = Math.floor(binCount / WAVEFORM_BAR_COUNT);
    // Shared gradient for all bars — avoids 48 createLinearGradient() calls per frame.
    // Per-bar alpha variation is approximated via globalAlpha instead.
    const minH = 2 * dpr;
    const maxH = ch * 0.85;
    const sharedGradient = waveformCtx.createLinearGradient(0, ch, 0, ch * 0.15);
    sharedGradient.addColorStop(0, 'rgba(0, 180, 255, 0.55)');
    sharedGradient.addColorStop(0.5, 'rgba(0, 255, 255, 0.75)');
    sharedGradient.addColorStop(1, 'rgba(180, 255, 255, 0.8)');
    waveformCtx.fillStyle = sharedGradient;
    for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
        // Average the frequency bins for this bar
        let sum = 0;
        for (let b = 0; b < binsPerBar; b++) {
            sum += waveformFreqData[i * binsPerBar + b] ?? 0;
        }
        const avg = sum / binsPerBar / 255; // 0-1
        const barH = Math.max(minH, avg * maxH);
        const x = startX + i * (barW + gap);
        const y = ch - barH;
        // Approximate per-bar alpha variation via globalAlpha
        waveformCtx.globalAlpha = 0.5 + avg * 0.5;
        waveformCtx.beginPath();
        waveformCtx.roundRect(x, y, barW, barH, barW / 2);
        waveformCtx.fill();
        // Glow effect on active bars
        if (avg > 0.3) {
            waveformCtx.shadowColor = 'rgba(0, 255, 255, 0.4)';
            waveformCtx.shadowBlur = 6 * dpr;
            waveformCtx.beginPath();
            waveformCtx.roundRect(x, y, barW, barH, barW / 2);
            waveformCtx.fill();
            waveformCtx.shadowColor = 'transparent';
            waveformCtx.shadowBlur = 0;
        }
    }
    waveformCtx.globalAlpha = 1;
    waveformAnimFrame = requestAnimationFrame(renderWaveform);
}
/** Draw the waveform on the recording canvas at the bottom of the camera area.
 *  Performance-sensitive — avoids per-bar gradient allocation and shadowBlur
 *  (which is expensive on the recording canvas). Uses a single shared gradient
 *  and a wider translucent bar for the glow effect instead. */
function drawWaveformOnCanvas(ctx, camX, camY, camW, camH, scale) {
    if (!waveformAnalyser || waveformFreqData.length === 0) {
        return;
    }
    const barW = WAVEFORM_BAR_WIDTH * scale;
    const gap = WAVEFORM_BAR_GAP * scale;
    const wfH = WAVEFORM_HEIGHT * scale;
    const totalBarsW = WAVEFORM_BAR_COUNT * (barW + gap) - gap;
    const startX = camX + (camW - totalBarsW) / 2;
    const baseY = camY + camH; // bottom of camera
    const maxH = wfH * 0.85;
    const minH = 2 * scale;
    // Single shared gradient for all bars (vertical, covering full waveform height)
    const gradient = ctx.createLinearGradient(0, baseY, 0, baseY - maxH);
    gradient.addColorStop(0, 'rgba(0, 180, 255, 0.6)');
    gradient.addColorStop(0.5, 'rgba(0, 255, 255, 0.8)');
    gradient.addColorStop(1, 'rgba(180, 255, 255, 0.9)');
    const binCount = waveformFreqData.length;
    const binsPerBar = Math.floor(binCount / WAVEFORM_BAR_COUNT);
    // Pre-compute bar averages once — avoids redundant iteration in glow + solid passes
    const barAverages = new Float32Array(WAVEFORM_BAR_COUNT);
    for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
        let sum = 0;
        for (let b = 0; b < binsPerBar; b++) {
            sum += waveformFreqData[i * binsPerBar + b] ?? 0;
        }
        barAverages[i] = sum / binsPerBar / 255;
    }
    // Draw glow layer first (wider translucent bars — cheap shadowBlur substitute)
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = 'rgba(0, 255, 255, 0.5)';
    const glowPad = 3 * scale;
    for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
        const avg = barAverages[i];
        if (avg > 0.3) {
            const barH = Math.max(minH, avg * maxH);
            const x = startX + i * (barW + gap);
            const y = baseY - barH;
            ctx.beginPath();
            ctx.roundRect(x - glowPad, y - glowPad, barW + glowPad * 2, barH + glowPad * 2, (barW + glowPad * 2) / 2);
            ctx.fill();
        }
    }
    ctx.restore();
    // Draw solid bars
    ctx.fillStyle = gradient;
    for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
        const avg = barAverages[i];
        const barH = Math.max(minH, avg * maxH);
        const x = startX + i * (barW + gap);
        const y = baseY - barH;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, barW / 2);
        ctx.fill();
    }
}
// ---------------------------------------------------------------------------
// Action feed — agent-style activity log overlaid on the camera area
// ---------------------------------------------------------------------------
// SVG icon paths for action types (16×16 viewBox)
const ACTION_ICON_PATHS = {
    // Cursor/pointer icon
    click: 'M3 1L3 11L5.5 8.5L8 14L10 13L7.5 7L11 7Z',
    // Keyboard icon
    type: 'M1 4H15V13H1V4ZM3 6H5V8H3V6ZM7 6H9V8H7V6ZM11 6H13V8H11V6ZM4 9H12V11H4V9Z',
    // Lightning bolt icon
    shortcut: 'M9 1L4 9H8L7 15L12 7H8Z',
    // Mouse scroll icon
    scroll: 'M8 1C5.2 1 3 3.2 3 6V10C3 12.8 5.2 15 8 15C10.8 15 13 12.8 13 10V6C13 3.2 10.8 1 8 1ZM8 3C9.7 3 11 4.3 11 6V10C11 11.7 9.7 13 8 13C6.3 13 5 11.7 5 10V6C5 4.3 6.3 3 8 3ZM7.5 5V8H8.5V5H7.5Z',
};
// Cache parsed Path2D objects for action icons — avoids re-parsing SVG paths every frame
const actionPath2DCache = new Map();
function getActionPath2D(actionType) {
    let p = actionPath2DCache.get(actionType);
    if (!p) {
        p = new Path2D(ACTION_ICON_PATHS[actionType]);
        actionPath2DCache.set(actionType, p);
    }
    return p;
}
const ACTION_FEED_MAX = 5;
const ACTION_SLIDE_DURATION = 500; // ms for slide-in
const ACTION_ITEM_HEIGHT = 28; // px in preview space (single-line pill)
const ACTION_ITEM_GAP = 6; // px gap between items
const ACTION_ITEM_PADDING_H = 10; // horizontal padding inside pill
const ACTION_ITEM_PADDING_V = 7; // vertical padding inside pill
const ACTION_ICON_SIZE = 14; // icon size in preview space
const ACTION_FONT_SIZE = 11; // font size in preview space
const ACTION_LINE_HEIGHT = 14; // line height for wrapped text
const ACTION_MARGIN_BOTTOM = 12; // px from bottom of camera
const ACTION_MARGIN_RIGHT = 12; // px from right edge of camera
const ACTION_MAX_PILL_W_RATIO = 0.9; // max pill width as fraction of camera width
const ACTION_MAX_LINES = 3; // max text lines before truncation
let actionFeedItems = [];
/** Add a new action to the feed */
function addActionFeedItem(event) {
    const now = performance.now();
    // Push existing items up by one slot
    for (const item of actionFeedItems) {
        item.slotIndex += 1;
    }
    // Remove items beyond max (mark for fade-out)
    actionFeedItems = actionFeedItems.filter((item) => item.slotIndex < ACTION_FEED_MAX + 1);
    for (const item of actionFeedItems) {
        if (item.slotIndex >= ACTION_FEED_MAX) {
            item.opacity = 0; // will be cleaned up on next frame
        }
    }
    // Add new item at slot 0 (bottom)
    actionFeedItems.push({
        event,
        slotIndex: 0,
        enterTime: now,
        opacity: 1.0,
        slideX: 1.0, // starts fully offscreen right
        targetY: 0,
        currentY: 0,
        computedHeight: ACTION_ITEM_HEIGHT,
    });
    // Restart the preview feed render loop if it's not already running
    startPreviewFeedLoop();
}
/** Update action feed animation state each frame (deduped per rAF frame) */
let lastActionFeedUpdateFrame = -1;
function updateActionFeed() {
    // Prevent double-updating when both preview and recording loops call this in the same frame
    const frame = Math.round(performance.now());
    if (frame === lastActionFeedUpdateFrame) {
        return;
    }
    lastActionFeedUpdateFrame = frame;
    const now = performance.now();
    // Sort by slotIndex ascending (0 = newest/bottom, higher = older/top)
    const sorted = [...actionFeedItems].sort((a, b) => a.slotIndex - b.slotIndex);
    // Compute targetY: cumulative heights of items below (slot 0 starts at y=0)
    let cumulativeY = 0;
    for (const item of sorted) {
        item.targetY = cumulativeY;
        cumulativeY += item.computedHeight + ACTION_ITEM_GAP;
    }
    for (const item of actionFeedItems) {
        // Slide-in animation: easeOutCubic from right edge into final position
        const slideElapsed = now - item.enterTime;
        const t = Math.min(1, slideElapsed / ACTION_SLIDE_DURATION);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        item.slideX = 1 - eased; // 1 (offscreen right) → 0 (in place)
        // Smooth Y interpolation (springy vertical movement)
        const yDiff = item.targetY - item.currentY;
        item.currentY += yDiff * 0.15; // smooth lerp factor
        // Time-based fade: fully visible for 3.5s, then fade over 1.5s (total 5s lifetime)
        const age = now - item.enterTime;
        const FADE_START = 3500;
        const FADE_DURATION = 1500;
        if (age > FADE_START) {
            item.opacity = Math.max(0, 1 - (age - FADE_START) / FADE_DURATION);
        }
        // Also immediately fade items pushed beyond max
        if (item.slotIndex >= ACTION_FEED_MAX) {
            item.opacity = Math.max(0, item.opacity - 0.05);
        }
    }
    // Remove fully faded items
    actionFeedItems = actionFeedItems.filter((item) => item.opacity > 0.01);
}
/**
 * Draw an action type icon on the canvas.
 * Uses simple path rendering scaled to the icon size.
 */
function drawActionIcon(ctx, actionType, x, y, size) {
    const iconScale = size / 16; // paths are designed for 16×16 viewBox
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(iconScale, iconScale);
    ctx.fillStyle = '#000000';
    ctx.fill(getActionPath2D(actionType));
    ctx.restore();
}
/**
 * Truncate a single-line label to fit maxWidth.
 * For 'type' actions, keeps the END of the text (most recently typed) with leading …
 * For other actions, keeps the START with trailing …
 */
function truncateLabel(ctx, text, maxWidth, fromStart) {
    if (ctx.measureText(text).width <= maxWidth) {
        return text;
    }
    if (fromStart) {
        // Keep the end (most recent typing), prepend …
        let truncated = text;
        while (ctx.measureText(`…${truncated}`).width > maxWidth && truncated.length > 1) {
            truncated = truncated.slice(1);
        }
        return `…${truncated}`;
    }
    // Keep the start, append …
    let truncated = text;
    while (ctx.measureText(`${truncated}…`).width > maxWidth && truncated.length > 1) {
        truncated = truncated.slice(0, -1);
    }
    return `${truncated}…`;
}
/**
 * Word-wrap text to fit within maxWidth, returning an array of lines.
 * Truncates with ellipsis if more than maxLines are needed.
 * If fromStart is true, truncation removes the beginning (for typing labels).
 */
function wrapActionText(ctx, text, maxWidth, maxLines, fromStart) {
    // If the text has no spaces (common for typing), handle as single line
    if (!text.includes(' ')) {
        return [truncateLabel(ctx, text, maxWidth, fromStart)];
    }
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = ctx.measureText(testLine).width;
        if (testWidth > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
            if (lines.length >= maxLines) {
                // Truncate the last line
                lines[lines.length - 1] = truncateLabel(ctx, lines[lines.length - 1] ?? '', maxWidth, fromStart);
                return lines;
            }
        }
        else {
            currentLine = testLine;
        }
    }
    if (currentLine) {
        if (lines.length >= maxLines) {
            lines[lines.length - 1] = truncateLabel(ctx, lines[lines.length - 1] ?? '', maxWidth, fromStart);
        }
        else {
            lines.push(currentLine);
        }
    }
    return lines.length > 0 ? lines : [text];
}
/**
 * Draw the action feed on the recording canvas.
 * Positioned at bottom-right of the camera video area.
 */
function drawActionFeedOnCanvas(ctx, camRect, scale) {
    if (actionFeedItems.length === 0) {
        return;
    }
    updateActionFeed();
    // Clip to camera bounds so pills slide in from under the border
    ctx.save();
    ctx.beginPath();
    ctx.rect(camRect.x, camRect.y, camRect.w, camRect.h);
    ctx.clip();
    const fontSize = ACTION_FONT_SIZE * scale;
    const iconSize = ACTION_ICON_SIZE * scale;
    const padH = ACTION_ITEM_PADDING_H * scale;
    const padV = ACTION_ITEM_PADDING_V * scale;
    const lineHeight = ACTION_LINE_HEIGHT * scale;
    const marginBottom = ACTION_MARGIN_BOTTOM * scale;
    const marginRight = ACTION_MARGIN_RIGHT * scale;
    const cornerRadius = 6 * scale;
    const iconTextGap = 6 * scale;
    const maxPillTextW = camRect.w * ACTION_MAX_PILL_W_RATIO - padH * 2 - iconSize - iconTextGap;
    const boldFont = `400 ${fontSize}px "Datatype", "Roboto", system-ui, sans-serif`;
    ctx.font = boldFont;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    // Shimmer animation — sweeps a highlight across text over time
    const shimmerCycle = 1800; // ms per full sweep
    const now = performance.now();
    // Anchor point: bottom-right of camera
    const anchorRight = camRect.x + camRect.w - marginRight;
    const anchorBottom = camRect.y + camRect.h - marginBottom;
    for (const item of actionFeedItems) {
        const label = item.event.label;
        ctx.font = boldFont;
        // Word-wrap text if it exceeds the max pill width
        // For 'type' actions, truncate from the start to show most recently typed text
        const truncateFromStart = item.event.type === 'type';
        const lines = wrapActionText(ctx, label, maxPillTextW, ACTION_MAX_LINES, truncateFromStart);
        const numLines = lines.length;
        // Find the widest line for pill width
        let maxLineW = 0;
        for (const line of lines) {
            const lineW = ctx.measureText(line).width;
            if (lineW > maxLineW) {
                maxLineW = lineW;
            }
        }
        const pillW = padH + iconSize + iconTextGap + maxLineW + padH;
        const pillH = numLines === 1 ? ACTION_ITEM_HEIGHT * scale : padV * 2 + numLines * lineHeight;
        // Update computedHeight in preview-space px (unscaled) for targetY stacking
        item.computedHeight = pillH / scale;
        // Position: anchored at bottom-right, items stack upward
        const itemY = item.currentY * scale;
        // slideX is in [0, 1]: 1 = pill fully off right, 0 = at final position
        const slideOffset = item.slideX * (pillW + marginRight + 40 * scale);
        const pillX = anchorRight - pillW + slideOffset;
        const pillY = anchorBottom - pillH - itemY;
        ctx.save();
        ctx.globalAlpha = item.opacity;
        // Pill shadow — lightweight offset rectangle instead of expensive shadowBlur
        ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
        ctx.beginPath();
        ctx.roundRect(pillX + 1, pillY + 2 * scale, pillW, pillH, cornerRadius);
        ctx.fill();
        // White pill background with rounded corners
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, cornerRadius);
        ctx.fill();
        // Icon — vertically centred in pill
        const iconX = pillX + padH;
        const iconY = pillY + (pillH - iconSize) / 2;
        drawActionIcon(ctx, item.event.type, iconX, iconY, iconSize);
        // Text with animated shimmer gradient — one line or multi-line
        const textX = iconX + iconSize + iconTextGap;
        ctx.font = boldFont;
        // Measure total text width for shimmer (use widest line)
        const shimmerWidth = maxLineW * 0.4;
        const elapsed = (now - item.enterTime) % shimmerCycle;
        const progress = elapsed / shimmerCycle;
        const shimmerPos = textX - shimmerWidth + (maxLineW + shimmerWidth * 2) * progress;
        const grad = ctx.createLinearGradient(shimmerPos, 0, shimmerPos + shimmerWidth, 0);
        grad.addColorStop(0, '#1a1a2e');
        grad.addColorStop(0.35, '#6c63ff');
        grad.addColorStop(0.5, '#e0e0ff');
        grad.addColorStop(0.65, '#6c63ff');
        grad.addColorStop(1, '#1a1a2e');
        // Clip to the text region so shimmer doesn't bleed outside the pill
        ctx.save();
        ctx.beginPath();
        ctx.rect(textX - 1, pillY, maxLineW + 2, pillH);
        ctx.clip();
        ctx.fillStyle = grad;
        if (numLines === 1) {
            // Single-line: vertically centred
            ctx.fillText(lines[0] ?? '', textX, pillY + pillH / 2);
        }
        else {
            // Multi-line: stack lines from top with padding
            for (let li = 0; li < numLines; li++) {
                const textY = pillY + padV + lineHeight * li + lineHeight / 2;
                ctx.fillText(lines[li] ?? '', textX, textY);
            }
        }
        ctx.restore();
        ctx.restore();
    }
    // Restore from camera clip
    ctx.restore();
}
// ---------------------------------------------------------------------------
// Live preview action feed — overlay canvas positioned on top of camera
// ---------------------------------------------------------------------------
let previewFeedAnimFrame = 0;
/** Position & size the action feed canvas to match the camera video element */
function positionActionFeedCanvas() {
    const hasCam = cameraContainer.classList.contains('active');
    if (!hasCam) {
        actionFeedCanvas.classList.remove('active');
        return;
    }
    const camRect = cameraVideo.getBoundingClientRect();
    const containerRect = previewContainer.getBoundingClientRect();
    const left = camRect.left - containerRect.left;
    const top = camRect.top - containerRect.top;
    const w = camRect.width;
    const h = camRect.height;
    // Use 2x resolution for crisp text on retina displays
    const dpr = window.devicePixelRatio || 1;
    const newW = Math.round(w * dpr);
    const newH = Math.round(h * dpr);
    if (actionFeedCanvas.width !== newW || actionFeedCanvas.height !== newH) {
        actionFeedCanvas.width = newW;
        actionFeedCanvas.height = newH;
    }
    actionFeedCanvas.style.left = `${Math.round(left)}px`;
    actionFeedCanvas.style.top = `${Math.round(top)}px`;
    actionFeedCanvas.style.width = `${Math.round(w)}px`;
    actionFeedCanvas.style.height = `${Math.round(h)}px`;
    actionFeedCanvas.classList.add('active');
}
/** Render the action feed overlay on the preview canvas each frame */
function renderPreviewFeed() {
    const hasCam = cameraContainer.classList.contains('active') && cameraStream;
    if (!hasCam || actionFeedItems.length === 0) {
        // Nothing to draw — stop looping to save CPU. The loop is restarted by
        // startPreviewFeedLoop() when a new action feed item arrives.
        actionFeedCtx.clearRect(0, 0, actionFeedCanvas.width, actionFeedCanvas.height);
        previewFeedAnimFrame = 0;
        return;
    }
    // Re-position canvas to track camera (handles layout changes, resizes)
    positionActionFeedCanvas();
    const cw = actionFeedCanvas.width;
    const ch = actionFeedCanvas.height;
    actionFeedCtx.clearRect(0, 0, cw, ch);
    // The canvas covers the camera area exactly, so camRect in canvas coords is (0, 0, cw, ch)
    drawActionFeedOnCanvas(actionFeedCtx, { x: 0, y: 0, w: cw, h: ch }, window.devicePixelRatio || 1);
    previewFeedAnimFrame = requestAnimationFrame(renderPreviewFeed);
}
function startPreviewFeedLoop() {
    if (previewFeedAnimFrame) {
        return;
    }
    previewFeedAnimFrame = requestAnimationFrame(renderPreviewFeed);
}
// The preview feed loop is started on-demand when action feed items arrive,
// and stops itself automatically when there's nothing to draw.
// ---------------------------------------------------------------------------
// Integrate new features into existing event handlers
// ---------------------------------------------------------------------------
// Listen for CTA test trigger from edit modal
window.mainAPI.onCtaTest(() => {
    showCtaPopup();
});
// Register action event handler for the action feed
window.mainAPI.onActionEvent((event) => {
    addActionFeedItem(event);
});
// ---------------------------------------------------------------------------
// Restore saved overlay on startup
// ---------------------------------------------------------------------------
void window.mainAPI.getConfig().then((config) => {
    if (config.overlay) {
        applyOverlay(config.overlay);
    }
});
// ---------------------------------------------------------------------------
// Performance monitor — toggle with Cmd+Shift+P
// ---------------------------------------------------------------------------
(0, perf_monitor_1.initPerfMonitor)();
/** Build the active features list for the performance monitor */
function refreshPerfMonitorFeatures() {
    const hasCam = cameraContainer.classList.contains('active');
    const hasCinema = activeCinemaFilter !== 'none';
    const features = [
        { name: 'Screen capture', cost: 'low', active: screenStream !== null },
        { name: 'Camera capture', cost: 'low', active: hasCam },
        { name: 'Click-to-zoom', cost: 'medium', active: zoomAnimFrame !== 0 },
        { name: 'Waveform visualizer', cost: 'low', active: waveformAnalyser !== null },
        { name: 'Action feed', cost: 'medium', active: actionFeedItems.length > 0 },
        { name: 'Name magnify wave', cost: 'low', active: magnifyTimer !== null },
        { name: `Cinema filter: ${activeCinemaFilter}`, cost: 'medium', active: hasCinema },
        { name: 'Social overlays', cost: 'low', active: activeSocials.length > 0 },
        { name: 'Animated border (conic gradient)', cost: 'medium', active: recAnimFrame !== null },
        { name: 'Canvas recording (1920×1080)', cost: 'high', active: recAnimFrame !== null },
        {
            name: 'Camera enhancement filters',
            cost: 'low',
            active: buildEnhancementFilter(activeCameraEnhancement) !== '',
        },
    ];
    (0, perf_monitor_1.updateActiveFeatures)(features);
}
// Refresh features periodically when monitor is visible
setInterval(() => {
    if ((0, perf_monitor_1.isVisible)()) {
        refreshPerfMonitorFeatures();
        // Also update pipeline state when not recording (for preview-only metrics)
        if (!recAnimFrame) {
            (0, perf_monitor_1.updatePipelineState)({
                isRecording: false,
                profile: {
                    total: 0,
                    setup: 0,
                    screen: 0,
                    camera: 0,
                    overlays: 0,
                    socials: 0,
                    actionFeed: 0,
                    waveform: 0,
                    cinemaFilter: 0,
                },
                frameCount: 0,
                droppedFrames: 0,
                recorderState: null,
                chunkCount: 0,
                targetFps: 30,
            });
        }
    }
}, 500);
//# sourceMappingURL=main.js.map