// Countdown overlay — shows 3-2-1 before recording starts
// ---------------------------------------------------------------------------
// Full-screen semi-transparent overlay with large countdown numbers.
// Each number displays for 1 second with a scale-down + fade animation.
// Skippable by calling skipCountdown() (e.g. pressing record again).
// ---------------------------------------------------------------------------

let overlayEl: HTMLDivElement | null = null;
let numberEl: HTMLDivElement | null = null;
let countdownTimer: ReturnType<typeof setTimeout> | null = null;
let currentResolve: (() => void) | null = null;
let isRunning = false;

/** Whether a countdown is currently in progress */
export function isCountdownActive(): boolean {
  return isRunning;
}

/** Skip the countdown and resolve immediately */
export function skipCountdown(): void {
  if (!isRunning) {
    return;
  }
  cleanup();
  if (currentResolve) {
    const resolve = currentResolve;
    currentResolve = null;
    resolve();
  }
}

/**
 * Run the 3-2-1 countdown overlay.
 * Resolves when countdown completes or is skipped.
 * Calls `onTick(value)` for each number so the main process can
 * forward countdown state to the toolbar.
 */
export function runCountdown(onTick: (value: number) => void): Promise<void> {
  return new Promise((resolve) => {
    currentResolve = resolve;
    isRunning = true;

    // Create overlay
    overlayEl = document.createElement('div');
    overlayEl.className = 'countdown-overlay';
    overlayEl.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.45);
      pointer-events: none;
    `;

    numberEl = document.createElement('div');
    numberEl.style.cssText = `
      font-size: 180px;
      font-weight: 800;
      color: #ffffff;
      text-shadow: 0 4px 40px rgba(0,0,0,0.5);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      opacity: 0;
      transform: scale(1.8);
      transition: opacity 0.25s ease-out, transform 0.75s cubic-bezier(0.16, 1, 0.3, 1);
      will-change: transform, opacity;
    `;

    overlayEl.appendChild(numberEl);
    document.body.appendChild(overlayEl);

    // Run sequence: 3 → 2 → 1
    let count = 3;
    showNumber(count, onTick);

    const tick = (): void => {
      count--;
      if (count > 0) {
        showNumber(count, onTick);
        countdownTimer = setTimeout(tick, 1000);
      } else {
        // Countdown complete
        cleanup();
        isRunning = false;
        currentResolve = null;
        resolve();
      }
    };

    countdownTimer = setTimeout(tick, 1000);
  });
}

function showNumber(num: number, onTick: (value: number) => void): void {
  if (!numberEl) {
    return;
  }
  onTick(num);

  // Reset animation state
  numberEl.style.transition = 'none';
  numberEl.style.opacity = '0';
  numberEl.style.transform = 'scale(1.8)';
  numberEl.textContent = String(num);

  // Force reflow to apply reset
  void numberEl.offsetHeight;

  // Animate in: scale down from 1.8 → 1, fade in
  numberEl.style.transition = 'opacity 0.25s ease-out, transform 0.75s cubic-bezier(0.16, 1, 0.3, 1)';
  numberEl.style.opacity = '1';
  numberEl.style.transform = 'scale(1)';

  // Fade out near the end of the 1-second window
  setTimeout(() => {
    if (numberEl) {
      numberEl.style.transition = 'opacity 0.2s ease-in';
      numberEl.style.opacity = '0';
    }
  }, 750);
}

function cleanup(): void {
  isRunning = false;
  if (countdownTimer !== null) {
    clearTimeout(countdownTimer);
    countdownTimer = null;
  }
  if (overlayEl && overlayEl.parentNode) {
    overlayEl.parentNode.removeChild(overlayEl);
  }
  overlayEl = null;
  numberEl = null;
}
