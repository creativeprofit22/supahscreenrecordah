#!/usr/bin/env node
/**
 * Generates the app icon as a pixel-art style PNG at multiple sizes,
 * then packages them into a Windows .ico file.
 *
 * Dependencies: sharp, png-to-ico  (install as devDependencies)
 *
 * Usage:  node scripts/generate-icon.js
 * Output: assets/icon.ico, assets/icon_256x256.png, assets/icon_1024x1024.png
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------
const PAL = {
  transparent:    [0, 0, 0, 0],
  frameDark:      [28, 28, 44, 255],
  frame:          [42, 42, 62, 255],
  frameHi:        [62, 62, 90, 255],
  screen:         [10, 14, 20, 255],
  screenLine:     [40, 55, 80, 255],
  screenLineBri:  [55, 80, 120, 255],
  recRed:         [255, 40, 40, 255],
  recGlow:        [255, 60, 60, 100],
  camBody:        [52, 52, 72, 255],
  camBodyHi:      [66, 66, 88, 255],
  lensRing:       [30, 30, 50, 255],
  lens:           [70, 110, 170, 255],
  lensHi:         [110, 150, 210, 255],
  standHi:        [66, 66, 92, 255],
  standEdge:      [36, 36, 54, 255],
};

// ---------------------------------------------------------------------------
// 32x32 pixel grid — procedural drawing
// ---------------------------------------------------------------------------
const SIZE = 32;
const grid = Array.from({ length: SIZE }, () =>
  Array.from({ length: SIZE }, () => PAL.transparent),
);

function fillRect(x, y, w, h, color) {
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      if (y + dy < SIZE && x + dx < SIZE && y + dy >= 0 && x + dx >= 0)
        grid[y + dy][x + dx] = color;
}

function pixel(x, y, color) {
  if (y >= 0 && y < SIZE && x >= 0 && x < SIZE) grid[y][x] = color;
}

// --- Camera on top ---
fillRect(13, 2, 6, 1, PAL.camBody);       // top edge
fillRect(12, 3, 8, 3, PAL.camBody);       // body
fillRect(13, 6, 6, 1, PAL.camBody);       // bottom edge
// Camera highlight
fillRect(13, 2, 6, 1, PAL.camBodyHi);
fillRect(12, 3, 8, 1, PAL.camBodyHi);
// Lens
fillRect(14, 4, 4, 2, PAL.lensRing);
fillRect(15, 4, 2, 2, PAL.lens);
pixel(15, 4, PAL.lensHi);                 // lens glint

// --- Monitor frame ---
fillRect(3, 8, 26, 1, PAL.frameHi);       // top highlight strip
fillRect(3, 9, 26, 16, PAL.frame);        // main body (rows 9-24)
fillRect(3, 25, 26, 1, PAL.frameHi);      // bottom highlight strip
// Darker inner border
fillRect(4, 10, 24, 14, PAL.frameDark);

// --- Screen ---
fillRect(5, 11, 22, 12, PAL.screen);      // rows 11-22

// --- Screen content: code-like lines for visual interest ---
fillRect(7,  12, 8, 1, PAL.screenLine);
fillRect(7,  14, 12, 1, PAL.screenLineBri);
fillRect(7,  16, 6, 1, PAL.screenLine);
fillRect(7,  18, 10, 1, PAL.screenLine);
fillRect(9,  20, 7, 1, PAL.screenLineBri);

// --- REC indicator (top-right of screen) ---
// 3x3 red dot with glow ring
fillRect(22, 11, 4, 4, PAL.recGlow);      // glow backdrop
fillRect(23, 12, 2, 2, PAL.recRed);       // solid dot centre
// Round the glow a bit
pixel(22, 11, PAL.screen);
pixel(25, 11, PAL.screen);
pixel(22, 14, PAL.screen);
pixel(25, 14, PAL.screen);

// --- Stand ---
fillRect(14, 26, 4, 2, PAL.frame);        // neck
fillRect(11, 28, 10, 1, PAL.standEdge);   // base shadow
fillRect(11, 29, 10, 1, PAL.frame);       // base
fillRect(11, 30, 10, 1, PAL.standHi);     // base highlight

// ---------------------------------------------------------------------------
// Render to raw RGBA buffer
// ---------------------------------------------------------------------------
function renderGrid(pixelSize) {
  const w = SIZE * pixelSize;
  const h = SIZE * pixelSize;
  const buf = Buffer.alloc(w * h * 4, 0);

  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const rgba = grid[row][col];
      if (rgba[3] === 0) continue;

      for (let py = 0; py < pixelSize; py++) {
        for (let px = 0; px < pixelSize; px++) {
          const x = col * pixelSize + px;
          const y = row * pixelSize + py;
          const idx = (y * w + x) * 4;
          buf[idx]     = rgba[0];
          buf[idx + 1] = rgba[1];
          buf[idx + 2] = rgba[2];
          buf[idx + 3] = rgba[3];
        }
      }
    }
  }

  return { buf, w, h };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.error('sharp is required. Run:  npm i -D sharp');
    process.exit(1);
  }

  let pngToIco;
  try {
    const mod = require('png-to-ico');
    pngToIco = mod.default || mod;
  } catch {
    console.error('png-to-ico is required. Run:  npm i -D png-to-ico');
    process.exit(1);
  }

  const outDir = path.join(__dirname, '..', 'assets');

  const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
  const pngPaths = [];

  for (const size of sizes) {
    const pixelSize = Math.max(1, Math.ceil(size / SIZE));
    const { buf, w, h } = renderGrid(pixelSize);

    const outPath = path.join(outDir, `icon_${size}x${size}.png`);
    await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
      .resize(size, size, { kernel: 'nearest' })
      .png()
      .toFile(outPath);

    pngPaths.push(outPath);
    console.log(`  ${size}x${size} -> ${path.basename(outPath)}`);
  }

  // Build .ico from 256px and smaller PNGs
  const icoInputs = pngPaths.filter((p) => {
    const s = parseInt(path.basename(p).match(/(\d+)x/)?.[1] ?? '0', 10);
    return s <= 256;
  });

  const icoBuffers = icoInputs.map((p) => fs.readFileSync(p));
  const ico = await pngToIco(icoBuffers);
  const icoPath = path.join(outDir, 'icon.ico');
  fs.writeFileSync(icoPath, ico);
  console.log(`  ICO -> ${path.basename(icoPath)}`);

  console.log('\nIcon generation complete!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
