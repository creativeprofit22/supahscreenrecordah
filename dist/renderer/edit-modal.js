"use strict";
// Edit modal renderer
Object.defineProperty(exports, "__esModule", { value: true });
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalSaveBtn = document.getElementById('modal-save-btn');
const overlayNameInput = document.getElementById('overlay-name');
const overlayFontSelect = document.getElementById('overlay-font');
const overlayFontSizeSelect = document.getElementById('overlay-font-size');
const overlayCtaInput = document.getElementById('overlay-cta');
const ambientParticlesToggle = document.getElementById('ambient-particles-toggle');
const mouseZoomSlider = document.getElementById('mouse-zoom');
const mouseZoomVal = document.getElementById('mouse-zoom-val');
const zoomLingerSlider = document.getElementById('zoom-linger');
const zoomLingerVal = document.getElementById('zoom-linger-val');
const ctaIntervalSlider = document.getElementById('cta-interval');
const ctaIntervalVal = document.getElementById('cta-interval-val');
const bgColorGrid = document.getElementById('bg-color-grid');
const bgStyleSelect = document.getElementById('bg-style-select');
const cinemaFilterSelect = document.getElementById('cinema-filter-select');
// Camera enhancement sliders
const camSliders = {
    brightness: document.getElementById('cam-brightness'),
    contrast: document.getElementById('cam-contrast'),
    saturation: document.getElementById('cam-saturation'),
    warmth: document.getElementById('cam-warmth'),
    sharpness: document.getElementById('cam-sharpness'),
    softness: document.getElementById('cam-softness'),
};
const camValueLabels = {
    brightness: document.getElementById('cam-brightness-val'),
    contrast: document.getElementById('cam-contrast-val'),
    saturation: document.getElementById('cam-saturation-val'),
    warmth: document.getElementById('cam-warmth-val'),
    sharpness: document.getElementById('cam-sharpness-val'),
    softness: document.getElementById('cam-softness-val'),
};
const socialInputs = {
    x: document.getElementById('social-x'),
    youtube: document.getElementById('social-youtube'),
    tiktok: document.getElementById('social-tiktok'),
    instagram: document.getElementById('social-instagram'),
};
function formatLingerLabel(ms) {
    return `${(ms / 1000).toFixed(1)}s`;
}
function formatIntervalLabel(ms) {
    const sec = ms / 1000;
    if (sec >= 60) {
        const min = sec / 60;
        return min === Math.floor(min) ? `${min}m` : `${min.toFixed(1)}m`;
    }
    return `${sec}s`;
}
let selectedBgColor = '#6b8cce';
let selectedBgStyle = 'solid';
let selectedCinemaFilter = 'none';
let selectedCtaIcon = '';
// CTA icon picker elements
const ctaIconBtn = document.getElementById('cta-icon-btn');
const ctaIconGrid = document.getElementById('cta-icon-grid');
function updateCtaIconBtn() {
    ctaIconBtn.textContent = selectedCtaIcon || '☺';
}
function selectCtaIcon(icon) {
    selectedCtaIcon = icon;
    updateCtaIconBtn();
    // Highlight the selected option
    const options = ctaIconGrid.querySelectorAll('.cta-icon-option');
    options.forEach((opt) => {
        opt.classList.toggle('selected', (opt.dataset['icon'] ?? '') === icon);
    });
}
ctaIconBtn.addEventListener('click', () => {
    ctaIconGrid.classList.toggle('active');
});
ctaIconGrid.addEventListener('click', (e) => {
    const option = e.target.closest('.cta-icon-option');
    if (!option) {
        return;
    }
    selectCtaIcon(option.dataset['icon'] ?? '');
    ctaIconGrid.classList.remove('active');
    sendPreview();
});
// Show selected font in the select dropdown itself
function updateFontPreview() {
    overlayFontSelect.style.fontFamily = `"${overlayFontSelect.value}", sans-serif`;
}
function getSocials() {
    return {
        x: socialInputs.x.value.trim(),
        youtube: socialInputs.youtube.value.trim(),
        tiktok: socialInputs.tiktok.value.trim(),
        instagram: socialInputs.instagram.value.trim(),
    };
}
function getCameraEnhancement() {
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
function sendPreview() {
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
const ctaTestBtn = document.getElementById('cta-test-btn');
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
    .then((config) => {
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
        for (const key of Object.keys(camSliders)) {
            camSliders[key].value = String(enh[key]);
            camValueLabels[key].textContent = String(enh[key]);
        }
    }
    if (overlay.socials) {
        for (const key of Object.keys(socialInputs)) {
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
    .catch((error) => {
    console.error('Failed to load config:', error);
});
// ---------------------------------------------------------------------------
// Background color picker
// ---------------------------------------------------------------------------
function selectBgColor(color) {
    selectedBgColor = color;
    const swatches = bgColorGrid.querySelectorAll('.color-swatch');
    swatches.forEach((swatch) => {
        swatch.classList.toggle('selected', swatch.dataset['color'] === color);
    });
}
bgColorGrid.addEventListener('click', (e) => {
    const swatch = e.target.closest('.color-swatch');
    if (!swatch?.dataset['color']) {
        return;
    }
    selectBgColor(swatch.dataset['color']);
    sendPreview();
});
// ---------------------------------------------------------------------------
// Cinema filter dropdown
// ---------------------------------------------------------------------------
function selectCinemaFilter(filter) {
    selectedCinemaFilter = filter;
    cinemaFilterSelect.value = filter;
}
cinemaFilterSelect.addEventListener('change', () => {
    selectCinemaFilter(cinemaFilterSelect.value);
    sendPreview();
});
// ---------------------------------------------------------------------------
// Camera enhancement sliders
// ---------------------------------------------------------------------------
for (const key of Object.keys(camSliders)) {
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
//# sourceMappingURL=edit-modal.js.map