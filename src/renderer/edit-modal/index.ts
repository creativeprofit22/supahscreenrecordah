// Edit modal renderer

import type {
  CinemaFilter,
  Socials,
  CameraEnhancement,
  AppConfig,
  OverlayConfig,
  ProgressBarConfig,
  WatermarkConfig,
  SilenceRemovalConfig,
  IntroOutroConfig,
  TemplateId,
  ExportPlatform,
} from '../../shared/types';

const modalCloseBtn = document.getElementById('modal-close-btn') as HTMLButtonElement;
const modalSaveBtn = document.getElementById('modal-save-btn') as HTMLButtonElement;
const overlayNameInput = document.getElementById('overlay-name') as HTMLInputElement;
const overlayFontSelect = document.getElementById('overlay-font') as HTMLSelectElement;
const overlayFontSizeSelect = document.getElementById('overlay-font-size') as HTMLSelectElement;
const overlayCtaInput = document.getElementById('overlay-cta') as HTMLInputElement;
const ambientParticlesToggle = document.getElementById(
  'ambient-particles-toggle',
) as HTMLInputElement;
const mouseZoomSlider = document.getElementById('mouse-zoom') as HTMLInputElement;
const mouseZoomVal = document.getElementById('mouse-zoom-val') as HTMLElement;
const shortsBaseZoomSlider = document.getElementById('shorts-base-zoom') as HTMLInputElement;
const shortsBaseZoomVal = document.getElementById('shorts-base-zoom-val') as HTMLElement;
const zoomLingerSlider = document.getElementById('zoom-linger') as HTMLInputElement;
const zoomLingerVal = document.getElementById('zoom-linger-val') as HTMLElement;
const ctaIntervalSlider = document.getElementById('cta-interval') as HTMLInputElement;
const ctaIntervalVal = document.getElementById('cta-interval-val') as HTMLElement;
const bgColorGrid = document.getElementById('bg-color-grid') as HTMLElement;
const bgStyleSelect = document.getElementById('bg-style-select') as HTMLSelectElement;
const cinemaFilterSelect = document.getElementById('cinema-filter-select') as HTMLSelectElement;

// Camera enhancement sliders
type CamSliderKey = 'brightness' | 'contrast' | 'saturation' | 'warmth' | 'sharpness' | 'softness';

const camSliders: Record<CamSliderKey, HTMLInputElement> = {
  brightness: document.getElementById('cam-brightness') as HTMLInputElement,
  contrast: document.getElementById('cam-contrast') as HTMLInputElement,
  saturation: document.getElementById('cam-saturation') as HTMLInputElement,
  warmth: document.getElementById('cam-warmth') as HTMLInputElement,
  sharpness: document.getElementById('cam-sharpness') as HTMLInputElement,
  softness: document.getElementById('cam-softness') as HTMLInputElement,
};

const camValueLabels: Record<CamSliderKey, HTMLElement> = {
  brightness: document.getElementById('cam-brightness-val') as HTMLElement,
  contrast: document.getElementById('cam-contrast-val') as HTMLElement,
  saturation: document.getElementById('cam-saturation-val') as HTMLElement,
  warmth: document.getElementById('cam-warmth-val') as HTMLElement,
  sharpness: document.getElementById('cam-sharpness-val') as HTMLElement,
  softness: document.getElementById('cam-softness-val') as HTMLElement,
};

const socialInputs: Record<string, HTMLInputElement> = {
  x: document.getElementById('social-x') as HTMLInputElement,
  youtube: document.getElementById('social-youtube') as HTMLInputElement,
  tiktok: document.getElementById('social-tiktok') as HTMLInputElement,
  instagram: document.getElementById('social-instagram') as HTMLInputElement,
};

// Progress bar elements
const progressBarToggle = document.getElementById('progress-bar-toggle') as HTMLInputElement;
const progressBarOptions = document.getElementById('progress-bar-options') as HTMLElement;
const progressBarColor = document.getElementById('progress-bar-color') as HTMLInputElement;
const progressBarHeightSlider = document.getElementById('progress-bar-height') as HTMLInputElement;
const progressBarHeightVal = document.getElementById('progress-bar-height-val') as HTMLElement;

// Watermark elements
const watermarkToggle = document.getElementById('watermark-toggle') as HTMLInputElement;
const watermarkOptions = document.getElementById('watermark-options') as HTMLElement;
const watermarkFileBtn = document.getElementById('watermark-file-btn') as HTMLButtonElement;
const watermarkFileName = document.getElementById('watermark-file-name') as HTMLElement;
const watermarkOpacitySlider = document.getElementById('watermark-opacity') as HTMLInputElement;
const watermarkOpacityVal = document.getElementById('watermark-opacity-val') as HTMLElement;
const watermarkSizeSlider = document.getElementById('watermark-size') as HTMLInputElement;
const watermarkSizeVal = document.getElementById('watermark-size-val') as HTMLElement;

let selectedWatermarkPath = '';

function formatLingerLabel(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatIntervalLabel(ms: number): string {
  const sec = ms / 1000;
  if (sec >= 60) {
    const min = sec / 60;
    return min === Math.floor(min) ? `${min}m` : `${min.toFixed(1)}m`;
  }
  return `${sec}s`;
}

let currentOverlay: OverlayConfig | null = null;

let selectedBgColor = '#6b8cce';
let selectedBgStyle = 'solid';
let selectedCinemaFilter: CinemaFilter = 'none';
let selectedCtaIcon = '';

// CTA icon picker elements
const ctaIconBtn = document.getElementById('cta-icon-btn') as HTMLButtonElement;
const ctaIconGrid = document.getElementById('cta-icon-grid') as HTMLElement;

function updateCtaIconBtn(): void {
  ctaIconBtn.textContent = selectedCtaIcon || '☺';
}

function selectCtaIcon(icon: string): void {
  selectedCtaIcon = icon;
  updateCtaIconBtn();
  // Highlight the selected option
  const options = ctaIconGrid.querySelectorAll('.cta-icon-option');
  options.forEach((opt) => {
    const el = opt as HTMLElement;
    el.classList.toggle('selected', (el.dataset['icon'] ?? '') === icon);
  });
}

ctaIconBtn.addEventListener('click', () => {
  ctaIconGrid.classList.toggle('active');
});

ctaIconGrid.addEventListener('click', (e: MouseEvent) => {
  const option = (e.target as HTMLElement).closest('.cta-icon-option') as HTMLElement | null;
  if (!option) {
    return;
  }
  selectCtaIcon(option.dataset['icon'] ?? '');
  ctaIconGrid.classList.remove('active');
  sendPreview();
});

// Show selected font in the select dropdown itself
function updateFontPreview(): void {
  overlayFontSelect.style.fontFamily = `"${overlayFontSelect.value}", sans-serif`;
}

function getSocials(): Socials {
  return {
    x: socialInputs.x.value.trim(),
    youtube: socialInputs.youtube.value.trim(),
    tiktok: socialInputs.tiktok.value.trim(),
    instagram: socialInputs.instagram.value.trim(),
  };
}

function getCameraEnhancement(): CameraEnhancement {
  return {
    brightness: Number(camSliders.brightness.value),
    contrast: Number(camSliders.contrast.value),
    saturation: Number(camSliders.saturation.value),
    warmth: Number(camSliders.warmth.value),
    sharpness: Number(camSliders.sharpness.value),
    softness: Number(camSliders.softness.value),
  };
}

function getProgressBarConfig(): ProgressBarConfig {
  const positionRadio = document.querySelector(
    'input[name="progress-bar-position"]:checked',
  ) as HTMLInputElement | null;
  return {
    enabled: progressBarToggle.checked,
    position: (positionRadio?.value as 'top' | 'bottom') ?? 'bottom',
    color: progressBarColor.value,
    height: Number(progressBarHeightSlider.value),
  };
}

function getWatermarkConfig(): WatermarkConfig {
  const positionRadio = document.querySelector(
    'input[name="watermark-position"]:checked',
  ) as HTMLInputElement | null;
  return {
    enabled: watermarkToggle.checked,
    imagePath: selectedWatermarkPath,
    position: (positionRadio?.value as WatermarkConfig['position']) ?? 'bottom-right',
    opacity: Number(watermarkOpacitySlider.value),
    size: Number(watermarkSizeSlider.value),
  };
}

function getOverlayFromUI(): OverlayConfig {
  return {
    ...(currentOverlay as OverlayConfig),
    name: overlayNameInput.value.trim(),
    nameFont: overlayFontSelect.value,
    nameFontSize: Number(overlayFontSizeSelect.value),
    bgColor: selectedBgColor,
    bgStyle: selectedBgStyle,
    cinemaFilter: selectedCinemaFilter,
    cameraEnhancement: getCameraEnhancement(),
    socials: getSocials(),
    ambientParticles: ambientParticlesToggle.checked,
    mouseZoom: Number(mouseZoomSlider.value),
    shortsBaseZoom: Number(shortsBaseZoomSlider.value),
    zoomLingerMs: Number(zoomLingerSlider.value),
    ctaText: overlayCtaInput.value.trim(),
    ctaIcon: selectedCtaIcon,
    ctaIntervalMs: Number(ctaIntervalSlider.value),
    progressBar: getProgressBarConfig(),
    watermark: getWatermarkConfig(),
    introOutro: getIntroOutroConfig(),
  };
}

// Send current overlay state to main window for live preview
function sendPreview(): void {
  if (!currentOverlay) return;
  window.editModalAPI.previewOverlay(getOverlayFromUI());
}

overlayFontSelect.addEventListener('change', () => {
  updateFontPreview();
  sendPreview();
});

overlayFontSizeSelect.addEventListener('change', sendPreview);

const ctaTestBtn = document.getElementById('cta-test-btn') as HTMLButtonElement;

overlayNameInput.addEventListener('input', sendPreview);
overlayCtaInput.addEventListener('input', sendPreview);

ctaTestBtn.addEventListener('click', () => {
  sendPreview();
  window.editModalAPI.testCta();
});

for (const input of Object.values(socialInputs)) {
  input.addEventListener('input', sendPreview);
}

bgStyleSelect.addEventListener('change', () => {
  selectedBgStyle = bgStyleSelect.value;
  sendPreview();
});

ambientParticlesToggle.addEventListener('change', sendPreview);

// ---------------------------------------------------------------------------
// Progress bar controls
// ---------------------------------------------------------------------------

progressBarToggle.addEventListener('change', () => {
  progressBarOptions.style.display = progressBarToggle.checked ? '' : 'none';
  sendPreview();
});

progressBarColor.addEventListener('input', sendPreview);

progressBarHeightSlider.addEventListener('input', () => {
  progressBarHeightVal.textContent = `${progressBarHeightSlider.value}px`;
  sendPreview();
});

document.querySelectorAll('input[name="progress-bar-position"]').forEach((radio) => {
  radio.addEventListener('change', sendPreview);
});

// ---------------------------------------------------------------------------
// Watermark controls
// ---------------------------------------------------------------------------

watermarkToggle.addEventListener('change', () => {
  watermarkOptions.style.display = watermarkToggle.checked ? '' : 'none';
  sendPreview();
});

watermarkFileBtn.addEventListener('click', () => {
  void window.editModalAPI.selectWatermarkFile().then((filePath) => {
    if (filePath) {
      selectedWatermarkPath = filePath;
      // Show just the filename, not the full path
      const parts = filePath.replace(/\\/g, '/').split('/');
      watermarkFileName.textContent = parts[parts.length - 1];
      watermarkFileName.title = filePath;
      sendPreview();
    }
  });
});

watermarkOpacitySlider.addEventListener('input', () => {
  watermarkOpacityVal.textContent = `${Math.round(Number(watermarkOpacitySlider.value) * 100)}%`;
  sendPreview();
});

watermarkSizeSlider.addEventListener('input', () => {
  watermarkSizeVal.textContent = `${watermarkSizeSlider.value}%`;
  sendPreview();
});

document.querySelectorAll('input[name="watermark-position"]').forEach((radio) => {
  radio.addEventListener('change', sendPreview);
});

// ---------------------------------------------------------------------------
// Silence removal controls
// ---------------------------------------------------------------------------

const silenceRemovalToggle = document.getElementById('silence-removal-toggle') as HTMLInputElement;
const silenceRemovalOptions = document.getElementById('silence-removal-options') as HTMLElement;
const silenceMinDurationSlider = document.getElementById('silence-min-duration') as HTMLInputElement;
const silenceMinDurationVal = document.getElementById('silence-min-duration-val') as HTMLElement;
const silenceFillerToggle = document.getElementById('silence-filler-toggle') as HTMLInputElement;

function getSilenceRemovalConfig(): SilenceRemovalConfig {
  return {
    enabled: silenceRemovalToggle.checked,
    minSilenceMs: Number(silenceMinDurationSlider.value),
    keepPaddingMs: 150,
    removeFillers: silenceFillerToggle.checked,
  };
}

silenceRemovalToggle.addEventListener('change', () => {
  silenceRemovalOptions.style.display = silenceRemovalToggle.checked ? '' : 'none';
});

silenceMinDurationSlider.addEventListener('input', () => {
  silenceMinDurationVal.textContent = `${(Number(silenceMinDurationSlider.value) / 1000).toFixed(1)}s`;
});

// ---------------------------------------------------------------------------
// Intro & Outro controls
// ---------------------------------------------------------------------------

const introToggle = document.getElementById('intro-toggle') as HTMLInputElement;
const introOptions = document.getElementById('intro-options') as HTMLElement;
const introTemplateSelect = document.getElementById('intro-template') as HTMLSelectElement;
const introTextInput = document.getElementById('intro-text') as HTMLInputElement;
const introSubtextInput = document.getElementById('intro-subtext') as HTMLInputElement;
const introDurationSlider = document.getElementById('intro-duration') as HTMLInputElement;
const introDurationVal = document.getElementById('intro-duration-val') as HTMLElement;

const outroToggle = document.getElementById('outro-toggle') as HTMLInputElement;
const outroOptions = document.getElementById('outro-options') as HTMLElement;
const outroTemplateSelect = document.getElementById('outro-template') as HTMLSelectElement;
const outroTextInput = document.getElementById('outro-text') as HTMLInputElement;
const outroSubtextInput = document.getElementById('outro-subtext') as HTMLInputElement;
const outroDurationSlider = document.getElementById('outro-duration') as HTMLInputElement;
const outroDurationVal = document.getElementById('outro-duration-val') as HTMLElement;

function getIntroOutroConfig(): IntroOutroConfig {
  return {
    introEnabled: introToggle.checked,
    introTemplate: introTemplateSelect.value as TemplateId,
    introText: introTextInput.value.trim(),
    introSubtext: introSubtextInput.value.trim(),
    introDuration: Number(introDurationSlider.value),
    outroEnabled: outroToggle.checked,
    outroTemplate: outroTemplateSelect.value as TemplateId,
    outroText: outroTextInput.value.trim(),
    outroSubtext: outroSubtextInput.value.trim(),
    outroDuration: Number(outroDurationSlider.value),
  };
}

introToggle.addEventListener('change', () => {
  introOptions.style.display = introToggle.checked ? '' : 'none';
});

introDurationSlider.addEventListener('input', () => {
  introDurationVal.textContent = `${introDurationSlider.value}s`;
});

outroToggle.addEventListener('change', () => {
  outroOptions.style.display = outroToggle.checked ? '' : 'none';
});

outroDurationSlider.addEventListener('input', () => {
  outroDurationVal.textContent = `${outroDurationSlider.value}s`;
});

mouseZoomSlider.addEventListener('input', () => {
  mouseZoomVal.textContent = mouseZoomSlider.value;
  sendPreview();
});

shortsBaseZoomSlider.addEventListener('input', () => {
  shortsBaseZoomVal.textContent = shortsBaseZoomSlider.value;
  sendPreview();
});

zoomLingerSlider.addEventListener('input', () => {
  zoomLingerVal.textContent = formatLingerLabel(Number(zoomLingerSlider.value));
  sendPreview();
});

ctaIntervalSlider.addEventListener('input', () => {
  ctaIntervalVal.textContent = formatIntervalLabel(Number(ctaIntervalSlider.value));
  sendPreview();
});

// ---------------------------------------------------------------------------
// Restore saved overlay settings
// ---------------------------------------------------------------------------

void window.editModalAPI
  .getConfig()
  .then((config: AppConfig) => {
    const overlay = config.overlay;
    if (!overlay) {
      return;
    }

    currentOverlay = overlay;

    overlayNameInput.value = overlay.name ?? '';

    if (overlay.nameFont) {
      overlayFontSelect.value = overlay.nameFont;
    }
    if (overlay.nameFontSize) {
      overlayFontSizeSelect.value = String(overlay.nameFontSize);
    }
    updateFontPreview();

    if (overlay.bgColor) {
      selectBgColor(overlay.bgColor);
    }
    if (overlay.bgStyle) {
      selectedBgStyle = overlay.bgStyle;
      bgStyleSelect.value = overlay.bgStyle;
    }
    if (overlay.cinemaFilter) {
      selectCinemaFilter(overlay.cinemaFilter);
    }
    if (overlay.cameraEnhancement) {
      const enh = overlay.cameraEnhancement;
      for (const key of Object.keys(camSliders) as CamSliderKey[]) {
        camSliders[key].value = String(enh[key]);
        camValueLabels[key].textContent = String(enh[key]);
      }
    }
    if (overlay.socials) {
      for (const key of Object.keys(socialInputs) as (keyof Socials)[]) {
        socialInputs[key].value = overlay.socials[key] ?? '';
      }
    }

    overlayCtaInput.value = overlay.ctaText ?? '';
    selectCtaIcon(overlay.ctaIcon ?? '');
    ambientParticlesToggle.checked = overlay.ambientParticles ?? false;

    if (overlay.mouseZoom !== undefined) {
      mouseZoomSlider.value = String(overlay.mouseZoom);
      mouseZoomVal.textContent = String(overlay.mouseZoom);
    }
    if (overlay.shortsBaseZoom !== undefined) {
      shortsBaseZoomSlider.value = String(overlay.shortsBaseZoom);
      shortsBaseZoomVal.textContent = String(overlay.shortsBaseZoom);
    }
    if (overlay.zoomLingerMs !== undefined) {
      zoomLingerSlider.value = String(overlay.zoomLingerMs);
      zoomLingerVal.textContent = formatLingerLabel(overlay.zoomLingerMs);
    }
    if (overlay.ctaIntervalMs !== undefined) {
      ctaIntervalSlider.value = String(overlay.ctaIntervalMs);
      ctaIntervalVal.textContent = formatIntervalLabel(overlay.ctaIntervalMs);
    }

    // Restore progress bar settings
    if (overlay.progressBar) {
      const pb = overlay.progressBar;
      progressBarToggle.checked = pb.enabled;
      progressBarOptions.style.display = pb.enabled ? '' : 'none';
      progressBarColor.value = pb.color;
      progressBarHeightSlider.value = String(pb.height);
      progressBarHeightVal.textContent = `${pb.height}px`;
      const posRadio = document.querySelector(
        `input[name="progress-bar-position"][value="${pb.position}"]`,
      ) as HTMLInputElement | null;
      if (posRadio) posRadio.checked = true;
    }

    // Restore watermark settings
    if (overlay.watermark) {
      const wm = overlay.watermark;
      watermarkToggle.checked = wm.enabled;
      watermarkOptions.style.display = wm.enabled ? '' : 'none';
      selectedWatermarkPath = wm.imagePath ?? '';
      if (wm.imagePath) {
        const parts = wm.imagePath.replace(/\\/g, '/').split('/');
        watermarkFileName.textContent = parts[parts.length - 1];
        watermarkFileName.title = wm.imagePath;
      }
      watermarkOpacitySlider.value = String(wm.opacity);
      watermarkOpacityVal.textContent = `${Math.round(wm.opacity * 100)}%`;
      watermarkSizeSlider.value = String(wm.size);
      watermarkSizeVal.textContent = `${wm.size}%`;
      const wmPosRadio = document.querySelector(
        `input[name="watermark-position"][value="${wm.position}"]`,
      ) as HTMLInputElement | null;
      if (wmPosRadio) wmPosRadio.checked = true;
    }

    // Restore silence removal settings
    if (config.silenceRemoval) {
      const sr = config.silenceRemoval;
      silenceRemovalToggle.checked = sr.enabled;
      silenceRemovalOptions.style.display = sr.enabled ? '' : 'none';
      silenceMinDurationSlider.value = String(sr.minSilenceMs);
      silenceMinDurationVal.textContent = `${(sr.minSilenceMs / 1000).toFixed(1)}s`;
      silenceFillerToggle.checked = sr.removeFillers;
    }

    // Restore intro/outro settings
    if (overlay.introOutro) {
      const io = overlay.introOutro;
      introToggle.checked = io.introEnabled;
      introOptions.style.display = io.introEnabled ? '' : 'none';
      introTemplateSelect.value = io.introTemplate;
      introTextInput.value = io.introText ?? '';
      introSubtextInput.value = io.introSubtext ?? '';
      introDurationSlider.value = String(io.introDuration);
      introDurationVal.textContent = `${io.introDuration}s`;

      outroToggle.checked = io.outroEnabled;
      outroOptions.style.display = io.outroEnabled ? '' : 'none';
      outroTemplateSelect.value = io.outroTemplate;
      outroTextInput.value = io.outroText ?? '';
      outroSubtextInput.value = io.outroSubtext ?? '';
      outroDurationSlider.value = String(io.outroDuration);
      outroDurationVal.textContent = `${io.outroDuration}s`;
    }
  })
  .catch((error: unknown) => {
    console.error('Failed to load config:', error);
  });

// ---------------------------------------------------------------------------
// Background color picker
// ---------------------------------------------------------------------------

function selectBgColor(color: string): void {
  selectedBgColor = color;
  const swatches = bgColorGrid.querySelectorAll('.color-swatch');
  swatches.forEach((swatch) => {
    const el = swatch as HTMLElement;
    el.classList.toggle('selected', el.dataset['color'] === color);
  });
}

bgColorGrid.addEventListener('click', (e: MouseEvent) => {
  const swatch = (e.target as HTMLElement).closest('.color-swatch') as HTMLElement | null;
  if (!swatch?.dataset['color']) {
    return;
  }
  selectBgColor(swatch.dataset['color']);
  sendPreview();
});

// ---------------------------------------------------------------------------
// Cinema filter dropdown
// ---------------------------------------------------------------------------

function selectCinemaFilter(filter: CinemaFilter): void {
  selectedCinemaFilter = filter;
  cinemaFilterSelect.value = filter;
}

cinemaFilterSelect.addEventListener('change', () => {
  selectCinemaFilter(cinemaFilterSelect.value as CinemaFilter);
  sendPreview();
});

// ---------------------------------------------------------------------------
// Camera enhancement sliders
// ---------------------------------------------------------------------------

for (const key of Object.keys(camSliders) as CamSliderKey[]) {
  camSliders[key].addEventListener('input', () => {
    camValueLabels[key].textContent = camSliders[key].value;
    sendPreview();
  });
}

modalCloseBtn.addEventListener('click', () => {
  window.editModalAPI.close();
});

// ---------------------------------------------------------------------------
// Export platforms
// ---------------------------------------------------------------------------

const platformCheckboxes = document.querySelectorAll<HTMLInputElement>('.platform-checkbox');

function getSelectedPlatforms(): ExportPlatform[] {
  const selected: ExportPlatform[] = [];
  platformCheckboxes.forEach((cb) => {
    if (cb.checked) {
      selected.push(cb.value as ExportPlatform);
    }
  });
  return selected;
}

function restoreExportPlatforms(platforms: ExportPlatform[]): void {
  platformCheckboxes.forEach((cb) => {
    cb.checked = platforms.includes(cb.value as ExportPlatform);
  });
}

// Restore saved export platforms on load
void window.editModalAPI.getConfig().then((config) => {
  if (config.exportPlatforms && config.exportPlatforms.length > 0) {
    restoreExportPlatforms(config.exportPlatforms);
  }
}).catch(() => {
  // ignore
});

modalSaveBtn.addEventListener('click', () => {
  if (!currentOverlay) return;
  window.editModalAPI.save(getOverlayFromUI());
  // Save silence removal config separately (lives on AppConfig, not OverlayConfig)
  window.editModalAPI.saveConfig({ silenceRemoval: getSilenceRemovalConfig() });
  // Save export platform selections
  void window.editModalAPI.setExportPlatforms(getSelectedPlatforms());
});
