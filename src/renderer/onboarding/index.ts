// Onboarding wizard renderer

import type {
  PermissionStatus,
  InstallProgress,
} from '../../shared/activation-types';

// ── DOM references ──────────────────────────────────────────────

const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;
const backBtn = document.getElementById('back-btn') as HTMLButtonElement;
const skoolLink = document.getElementById('skool-link') as HTMLAnchorElement;

// Step containers
const stepPermissions = document.getElementById('step-permissions') as HTMLElement;
const stepPrerequisites = document.getElementById('step-prerequisites') as HTMLElement;

// Step dots
const stepDots = document.querySelectorAll('.step-dot');

// Permissions step
const permissionsContinue = document.getElementById('permissions-continue') as HTMLButtonElement;

// Prerequisites step
const prereqsContinue = document.getElementById('prereqs-continue') as HTMLButtonElement;

type StepName = 'permissions' | 'prerequisites';

let currentStep: StepName = 'permissions';
let permissionPollTimer: ReturnType<typeof setInterval> | null = null;

// ── Step navigation ─────────────────────────────────────────────

const STEP_ORDER: StepName[] = ['permissions', 'prerequisites'];

const STEP_ELEMENTS: Record<StepName, HTMLElement> = {
  permissions: stepPermissions,
  prerequisites: stepPrerequisites,
};

function showStep(step: StepName): void {
  // Hide all steps
  for (const el of Object.values(STEP_ELEMENTS)) {
    el.hidden = true;
  }

  // Show target step
  STEP_ELEMENTS[step].hidden = false;
  currentStep = step;

  // Update step dots
  const currentIdx = STEP_ORDER.indexOf(step);
  stepDots.forEach((dot, i) => {
    dot.classList.remove('active', 'completed');
    if (i < currentIdx) {
      dot.classList.add('completed');
    } else if (i === currentIdx) {
      dot.classList.add('active');
    }
  });

  // Show/hide back button (hidden on first step)
  backBtn.hidden = currentIdx === 0;

  // Step-specific initialization
  if (step === 'permissions') {
    void initPermissionsStep();
  } else if (step === 'prerequisites') {
    stopPermissionPolling();
    void initPrerequisitesStep();
  }
}

// ── Close / external links ──────────────────────────────────────

closeBtn.addEventListener('click', () => {
  window.onboardingAPI.quit();
});

backBtn.addEventListener('click', () => {
  const currentIdx = STEP_ORDER.indexOf(currentStep);
  if (currentIdx > 0) {
    showStep(STEP_ORDER[currentIdx - 1]);
  }
});

skoolLink.addEventListener('click', (e: MouseEvent) => {
  e.preventDefault();
  void window.onboardingAPI.openExternal('https://www.skool.com/kenkai');
});

// ── Permissions step ────────────────────────────────────────────

function updatePermissionUI(status: PermissionStatus): void {
  const rows = Array.from(document.querySelectorAll('.permission-row'));
  for (const row of rows) {
    const el = row as HTMLElement;
    const perm = el.dataset.permission as keyof PermissionStatus;
    const btn = el.querySelector('.permission-btn') as HTMLButtonElement;
    const permStatus = status[perm];
    btn.dataset.status = permStatus;

    if (permStatus === 'granted') {
      btn.textContent = '✓ Granted';
    } else if (permStatus === 'denied') {
      btn.textContent = 'Open Settings';
    } else {
      btn.textContent = 'Enable';
    }
  }

  // Enable continue when camera + microphone + screenRecording are granted
  const required: (keyof PermissionStatus)[] = ['camera', 'microphone', 'screenRecording'];
  const allGranted = required.every((p) => status[p] === 'granted');
  permissionsContinue.disabled = !allGranted;
}

async function initPermissionsStep(): Promise<void> {
  const status = await window.onboardingAPI.checkPermissions();
  updatePermissionUI(status);
  startPermissionPolling();
}

function startPermissionPolling(): void {
  stopPermissionPolling();
  permissionPollTimer = setInterval(() => {
    if (currentStep !== 'permissions') {
      stopPermissionPolling();
      return;
    }
    window.onboardingAPI
      .checkPermissions()
      .then((status: PermissionStatus) => {
        updatePermissionUI(status);
      })
      .catch(() => {
        // ignore polling errors
      });
  }, 2000);
}

function stopPermissionPolling(): void {
  if (permissionPollTimer) {
    clearInterval(permissionPollTimer);
    permissionPollTimer = null;
  }
}

// Permission button clicks
document.querySelectorAll('.permission-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const row = (btn as HTMLElement).closest('.permission-row') as HTMLElement;
    const perm = row.dataset.permission as keyof PermissionStatus;
    void window.onboardingAPI.requestPermission(perm);
  });
});

permissionsContinue.addEventListener('click', () => {
  showStep('prerequisites');
});

// ── Prerequisites step ──────────────────────────────────────────

async function initPrerequisitesStep(): Promise<void> {
  const ffmpegRow = document.querySelector('.prereq-row[data-dep="ffmpeg"]') as HTMLElement | null;
  if (!ffmpegRow) {
    return;
  }
  const statusContainer = ffmpegRow.querySelector('.prereq-status') as HTMLElement;
  setBadge(statusContainer, 'checking', 'Checking...');
  prereqsContinue.disabled = true;

  const deps = await window.onboardingAPI.checkDependencies();
  if (deps.ffmpeg.installed) {
    setBadge(statusContainer, 'installed', '✓ Installed');
    prereqsContinue.disabled = false;
  } else {
    showInstallButton(statusContainer);
  }
}

function setBadge(container: HTMLElement, className: string, text: string): void {
  container.innerHTML = `<span class="prereq-badge ${className}">${text}</span>`;
}

function showInstallButton(container: HTMLElement): void {
  container.innerHTML = '<button class="prereq-install-btn">Install</button>';
  const btn = container.querySelector('.prereq-install-btn') as HTMLButtonElement;
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Installing...';

    // Set up progress listener
    window.onboardingAPI.onInstallProgress((progress: InstallProgress) => {
      handleInstallProgress(container, progress);
    });
    void window.onboardingAPI.installDependency('ffmpeg');
  });
}

function handleInstallProgress(container: HTMLElement, progress: InstallProgress): void {
  if (progress.status === 'downloading') {
    const pct = progress.progress ?? 0;
    container.innerHTML = `
      <span class="prereq-badge downloading">${pct}%</span>
      <div class="prereq-progress">
        <div class="prereq-progress-bar" style="width: ${pct}%"></div>
      </div>
    `;
  } else if (progress.status === 'installing') {
    setBadge(container, 'installing', 'Installing...');
  } else if (progress.status === 'done') {
    setBadge(container, 'installed', '✓ Installed');
    prereqsContinue.disabled = false;
  } else if (progress.status === 'error') {
    container.innerHTML = `
      <span class="prereq-badge error">Error</span>
    `;
    // Show install button again after a short delay
    setTimeout(() => {
      showInstallButton(container);
    }, 2000);
  }
}

prereqsContinue.addEventListener('click', () => {
  window.onboardingAPI.completeOnboarding();
});

// Start at permissions step
showStep('permissions');
