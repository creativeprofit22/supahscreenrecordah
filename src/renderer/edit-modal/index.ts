// Edit modal renderer

import type {
  CinemaFilter,
  Socials,
  CameraEnhancement,
  AppConfig,
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

// Send current overlay state to main window for live preview
function sendPreview(): void {
  window.editModalAPI.previewOverlay({
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
    zoomLingerMs: Number(zoomLingerSlider.value),
    ctaText: overlayCtaInput.value.trim(),
    ctaIcon: selectedCtaIcon,
    ctaIntervalMs: Number(ctaIntervalSlider.value),
  });
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

mouseZoomSlider.addEventListener('input', () => {
  mouseZoomVal.textContent = mouseZoomSlider.value;
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
    if (overlay.zoomLingerMs !== undefined) {
      zoomLingerSlider.value = String(overlay.zoomLingerMs);
      zoomLingerVal.textContent = formatLingerLabel(overlay.zoomLingerMs);
    }
    if (overlay.ctaIntervalMs !== undefined) {
      ctaIntervalSlider.value = String(overlay.ctaIntervalMs);
      ctaIntervalVal.textContent = formatIntervalLabel(overlay.ctaIntervalMs);
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

modalSaveBtn.addEventListener('click', () => {
  window.editModalAPI.save({
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
    zoomLingerMs: Number(zoomLingerSlider.value),
    ctaText: overlayCtaInput.value.trim(),
    ctaIcon: selectedCtaIcon,
    ctaIntervalMs: Number(ctaIntervalSlider.value),
  });
});
