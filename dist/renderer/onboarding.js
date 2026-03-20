"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ── DOM references ──────────────────────────────────────────────
const closeBtn = document.getElementById('close-btn');
const backBtn = document.getElementById('back-btn');
const skoolLink = document.getElementById('skool-link');
// Step containers
const stepEmail = document.getElementById('step-email');
const stepPermissions = document.getElementById('step-permissions');
const stepPrerequisites = document.getElementById('step-prerequisites');
// Step dots
const stepDots = document.querySelectorAll('.step-dot');
// Email step
const form = document.getElementById('activation-form');
const emailInput = document.getElementById('email-input');
const activateBtn = document.getElementById('activate-btn');
const btnText = activateBtn.querySelector('.btn-text');
const btnLoading = activateBtn.querySelector('.btn-loading');
const errorMessage = document.getElementById('error-message');
// Permissions step
const permissionsContinue = document.getElementById('permissions-continue');
// Prerequisites step
const prereqsContinue = document.getElementById('prereqs-continue');
let currentStep = 'email';
let permissionPollTimer = null;
// ── Step navigation ─────────────────────────────────────────────
const STEP_ORDER = ['email', 'permissions', 'prerequisites'];
const STEP_ELEMENTS = {
    email: stepEmail,
    permissions: stepPermissions,
    prerequisites: stepPrerequisites,
};
function showStep(step) {
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
        }
        else if (i === currentIdx) {
            dot.classList.add('active');
        }
    });
    // Show/hide back button (hidden on first step)
    backBtn.hidden = currentIdx === 0;
    // Step-specific initialization
    if (step === 'email') {
        stopPermissionPolling();
        setLoading(false);
        hideError();
    }
    else if (step === 'permissions') {
        void initPermissionsStep();
    }
    else if (step === 'prerequisites') {
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
skoolLink.addEventListener('click', (e) => {
    e.preventDefault();
    void window.onboardingAPI.openExternal('https://www.skool.com/kenkai');
});
// ── Email step ──────────────────────────────────────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email) {
    return EMAIL_REGEX.test(email.trim());
}
function updateActivateButton() {
    activateBtn.disabled = !isValidEmail(emailInput.value);
}
// Start disabled, enable once a valid email is typed
activateBtn.disabled = true;
emailInput.addEventListener('input', updateActivateButton);
function setLoading(loading) {
    if (loading) {
        activateBtn.disabled = true;
    }
    else {
        updateActivateButton();
    }
    emailInput.disabled = loading;
    btnText.hidden = loading;
    btnLoading.hidden = !loading;
}
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
}
function hideError() {
    errorMessage.hidden = true;
    errorMessage.textContent = '';
}
form.addEventListener('submit', (e) => {
    e.preventDefault();
    hideError();
    const email = emailInput.value.trim();
    if (!email) {
        showError('Please enter your email address.');
        return;
    }
    setLoading(true);
    window.onboardingAPI
        .activate(email)
        .then((result) => {
        if (result.success) {
            showStep('permissions');
            return;
        }
        showError(result.error ?? 'Activation failed. Please try again.');
        setLoading(false);
    })
        .catch(() => {
        showError('An unexpected error occurred. Please try again.');
        setLoading(false);
    });
});
function updatePermissionUI(status) {
    const rows = Array.from(document.querySelectorAll('.permission-row'));
    for (const row of rows) {
        const perm = row.dataset.permission;
        const btn = row.querySelector('.permission-btn');
        const permStatus = status[perm];
        btn.dataset.status = permStatus;
        if (permStatus === 'granted') {
            btn.textContent = '✓ Granted';
        }
        else if (permStatus === 'denied') {
            btn.textContent = 'Open Settings';
        }
        else {
            btn.textContent = 'Enable';
        }
    }
    // Enable continue when camera + microphone + screenRecording are granted
    const required = ['camera', 'microphone', 'screenRecording'];
    const allGranted = required.every((p) => status[p] === 'granted');
    permissionsContinue.disabled = !allGranted;
}
async function initPermissionsStep() {
    const status = await window.onboardingAPI.checkPermissions();
    updatePermissionUI(status);
    startPermissionPolling();
}
function startPermissionPolling() {
    stopPermissionPolling();
    permissionPollTimer = setInterval(() => {
        if (currentStep !== 'permissions') {
            stopPermissionPolling();
            return;
        }
        window.onboardingAPI
            .checkPermissions()
            .then((status) => {
            updatePermissionUI(status);
        })
            .catch(() => {
            // ignore polling errors
        });
    }, 2000);
}
function stopPermissionPolling() {
    if (permissionPollTimer) {
        clearInterval(permissionPollTimer);
        permissionPollTimer = null;
    }
}
// Permission button clicks
document.querySelectorAll('.permission-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        const row = btn.closest('.permission-row');
        const perm = row.dataset.permission;
        void window.onboardingAPI.requestPermission(perm);
    });
});
permissionsContinue.addEventListener('click', () => {
    showStep('prerequisites');
});
// ── Prerequisites step ──────────────────────────────────────────
async function initPrerequisitesStep() {
    const ffmpegRow = document.querySelector('.prereq-row[data-dep="ffmpeg"]');
    if (!ffmpegRow) {
        return;
    }
    const statusContainer = ffmpegRow.querySelector('.prereq-status');
    setBadge(statusContainer, 'checking', 'Checking...');
    prereqsContinue.disabled = true;
    const deps = await window.onboardingAPI.checkDependencies();
    if (deps.ffmpeg.installed) {
        setBadge(statusContainer, 'installed', '✓ Installed');
        prereqsContinue.disabled = false;
    }
    else {
        showInstallButton(statusContainer);
    }
}
function setBadge(container, className, text) {
    container.innerHTML = `<span class="prereq-badge ${className}">${text}</span>`;
}
function showInstallButton(container) {
    container.innerHTML = '<button class="prereq-install-btn">Install</button>';
    const btn = container.querySelector('.prereq-install-btn');
    btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = 'Installing...';
        // Set up progress listener
        window.onboardingAPI.onInstallProgress((progress) => {
            handleInstallProgress(container, progress);
        });
        void window.onboardingAPI.installDependency('ffmpeg');
    });
}
function handleInstallProgress(container, progress) {
    if (progress.status === 'downloading') {
        const pct = progress.progress ?? 0;
        container.innerHTML = `
      <span class="prereq-badge downloading">${pct}%</span>
      <div class="prereq-progress">
        <div class="prereq-progress-bar" style="width: ${pct}%"></div>
      </div>
    `;
    }
    else if (progress.status === 'installing') {
        setBadge(container, 'installing', 'Installing...');
    }
    else if (progress.status === 'done') {
        setBadge(container, 'installed', '✓ Installed');
        prereqsContinue.disabled = false;
    }
    else if (progress.status === 'error') {
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
//# sourceMappingURL=onboarding.js.map