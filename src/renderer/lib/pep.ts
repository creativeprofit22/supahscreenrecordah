// Global button click sound effect
const audio = new Audio('assets/pep.mp3');
audio.volume = 0.5;

const INTERACTIVE_CLASSES = [
  'toolbar-btn',
  'permission-btn',
  'prereq-install-btn',
  'color-swatch',
  'playback-btn',
  'continue-btn',
  'modal-close',
  'modal-save',
  'back-btn',
  'close-btn',
  'footer-link',
  'step-dot',
];

document.addEventListener(
  'click',
  (e: MouseEvent) => {
    let target = e.target as HTMLElement | null;
    while (target && target !== document.body) {
      const tag = target.tagName;
      if (
        tag === 'BUTTON' ||
        tag === 'A' ||
        (tag === 'INPUT' &&
          ((target as HTMLInputElement).type === 'checkbox' ||
            (target as HTMLInputElement).type === 'radio')) ||
        (tag === 'LABEL' &&
          target.querySelector('input[type="checkbox"], input[type="radio"]')) ||
        target.role === 'button' ||
        INTERACTIVE_CLASSES.some((cls) => target!.classList.contains(cls)) ||
        target.dataset.clickSound !== undefined
      ) {
        // Clone so overlapping clicks each produce sound
        const clone = audio.cloneNode() as HTMLAudioElement;
        clone.volume = audio.volume;
        clone.play().catch(() => {});
        return;
      }
      target = target.parentElement;
    }
  },
  true,
);
