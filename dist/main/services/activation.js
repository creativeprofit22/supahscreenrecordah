"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearActivationState = clearActivationState;
exports.activate = activate;
exports.isActivated = isActivated;
exports.getActivationState = getActivationState;
const electron_1 = require("electron");
const crypto_1 = __importDefault(require("crypto"));
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const ACTIVATION_FILE = path_1.default.join(electron_1.app.getPath('userData'), 'activation.json');
const API_BASE_URL = 'https://yaatuber-server-production.up.railway.app';
/**
 * HMAC signing key derived from a static secret + the device fingerprint.
 * This means:
 * - A hand-crafted JSON without the correct HMAC is rejected
 * - An activation.json copied from another machine fails (different device → different key)
 */
const SIGNING_SECRET = 'yaat_k9x$mQ!vR7pL2wZ';
/** Max days the app will trust a local activation cache without phoning home. */
const OFFLINE_GRACE_DAYS = 3;
// ── Device fingerprint ──────────────────────────────────────────
/**
 * Get a stable hardware UUID that doesn't change across reboots or updates.
 *
 * - macOS: IOPlatformUUID from IORegistry (tied to logic board, never changes)
 * - Linux: /etc/machine-id (systemd) or /var/lib/dbus/machine-id (dbus)
 * - Windows: MachineGuid from registry (set at OS install, stable)
 *
 * Falls back to hostname+platform+arch+cpu if the platform-specific
 * method fails, which is still more stable than MAC addresses
 * (macOS randomizes WiFi MACs with Private WiFi Address).
 */
function getHardwareUUID() {
    try {
        if (process.platform === 'darwin') {
            const output = (0, child_process_1.execFileSync)('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
                timeout: 3000,
                encoding: 'utf-8',
            });
            const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(output);
            if (match?.[1]) {
                return match[1];
            }
        }
        else if (process.platform === 'linux') {
            // Try both paths — /etc/machine-id (systemd) and /var/lib/dbus/machine-id (dbus)
            for (const idPath of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
                if (fs_1.default.existsSync(idPath)) {
                    const id = fs_1.default.readFileSync(idPath, 'utf-8').trim();
                    if (id) {
                        return id;
                    }
                }
            }
        }
        else if (process.platform === 'win32') {
            // Use Windows Registry MachineGuid — more reliable than wmic (deprecated in newer Windows)
            const output = (0, child_process_1.execFileSync)('reg', ['query', 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { timeout: 3000, encoding: 'utf-8' });
            const match = /MachineGuid\s+REG_SZ\s+([a-zA-Z0-9-]+)/.exec(output);
            if (match?.[1]) {
                return match[1];
            }
        }
    }
    catch (err) {
        console.warn('Failed to get hardware UUID:', err);
    }
    // Fallback: stable identifiers without MAC (hostname can change but is
    // far less volatile than randomized MAC addresses)
    return `fallback:${os_1.default.hostname()}|${os_1.default.platform()}|${os_1.default.arch()}`;
}
/** Generate a deterministic device fingerprint from stable hardware identifiers. */
function getDeviceFingerprint() {
    const hwUUID = getHardwareUUID();
    const cpuModel = os_1.default.cpus()[0]?.model ?? 'unknown';
    const raw = `${hwUUID}|${os_1.default.platform()}|${os_1.default.arch()}|${cpuModel}`;
    return crypto_1.default.createHash('sha256').update(raw).digest('hex');
}
/**
 * Compute the legacy (v1) fingerprint that used MAC addresses.
 * Used only for migrating existing activation.json files.
 */
function getLegacyDeviceFingerprint() {
    const cpuModel = os_1.default.cpus()[0]?.model ?? 'unknown';
    const interfaces = os_1.default.networkInterfaces();
    let mac = '';
    for (const name of Object.keys(interfaces)) {
        const iface = interfaces[name];
        if (!iface) {
            continue;
        }
        for (const entry of iface) {
            if (!entry.internal && entry.mac && entry.mac !== '00:00:00:00:00:00') {
                mac = entry.mac;
                break;
            }
        }
        if (mac) {
            break;
        }
    }
    const raw = `${os_1.default.hostname()}|${os_1.default.platform()}|${os_1.default.arch()}|${cpuModel}|${mac}`;
    return crypto_1.default.createHash('sha256').update(raw).digest('hex');
}
/** Compute HMAC over the activation payload, keyed to this device. */
function computeHmac(email, deviceId, activatedAt, lastValidated) {
    const payload = `${email}|${deviceId}|${activatedAt}|${lastValidated}`;
    return crypto_1.default
        .createHmac('sha256', SIGNING_SECRET + deviceId)
        .update(payload)
        .digest('hex');
}
// ── Local state persistence ─────────────────────────────────────
function loadSignedState() {
    try {
        if (fs_1.default.existsSync(ACTIVATION_FILE)) {
            const raw = fs_1.default.readFileSync(ACTIVATION_FILE, 'utf-8');
            return JSON.parse(raw);
        }
    }
    catch (err) {
        console.warn('Failed to load activation state:', err);
    }
    return null;
}
function saveSignedState(email, deviceId, activatedAt, lastValidated) {
    const hmac = computeHmac(email, deviceId, activatedAt, lastValidated);
    const data = { email, deviceId, activatedAt, lastValidated, hmac };
    try {
        fs_1.default.writeFileSync(ACTIVATION_FILE, JSON.stringify(data, null, 2), 'utf-8');
    }
    catch (err) {
        console.error('Failed to save activation state:', err);
    }
}
/** Verify the HMAC + device match on a loaded state. Returns the state if valid, null if tampered. */
function verifySignedState(state) {
    const deviceId = getDeviceFingerprint();
    if (state.deviceId !== deviceId) {
        // Check if this is a legacy activation (old MAC-based fingerprint)
        // that needs migration to the new stable fingerprint
        const legacyId = getLegacyDeviceFingerprint();
        if (state.deviceId === legacyId) {
            const expectedHmac = computeHmac(state.email, state.deviceId, state.activatedAt, state.lastValidated);
            if (crypto_1.default.timingSafeEqual(Buffer.from(state.hmac, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
                console.log('Legacy activation detected — will migrate to stable device fingerprint.');
                return state;
            }
        }
        console.warn('Activation device mismatch — file was copied from another machine.');
        return null;
    }
    const expected = computeHmac(state.email, state.deviceId, state.activatedAt, state.lastValidated);
    if (!crypto_1.default.timingSafeEqual(Buffer.from(state.hmac, 'hex'), Buffer.from(expected, 'hex'))) {
        console.warn('Activation HMAC mismatch — file has been tampered with.');
        return null;
    }
    return state;
}
/** Remove activation state (deactivate). */
function clearActivationState() {
    try {
        if (fs_1.default.existsSync(ACTIVATION_FILE)) {
            fs_1.default.unlinkSync(ACTIVATION_FILE);
        }
    }
    catch (err) {
        console.warn('Failed to clear activation state:', err);
    }
}
// ── Remote API calls ────────────────────────────────────────────
async function activateRemote(email, deviceId) {
    try {
        const response = await electron_1.net.fetch(`${API_BASE_URL}/api/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, deviceId }),
        });
        return (await response.json());
    }
    catch (err) {
        console.error('Remote activation failed:', err);
        return {
            success: false,
            error: 'Unable to reach activation server. Check your internet connection.',
        };
    }
}
async function validateRemote(email, deviceId) {
    try {
        const response = await electron_1.net.fetch(`${API_BASE_URL}/api/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, deviceId }),
        });
        return (await response.json());
    }
    catch (err) {
        console.error('Remote validation failed (offline?):', err);
        return { valid: false, error: 'offline' };
    }
}
// ── Public API ──────────────────────────────────────────────────
/** Attempt to activate with the given email. */
async function activate(email) {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return { success: false, error: 'Please enter a valid email address.' };
    }
    const deviceId = getDeviceFingerprint();
    const remote = await activateRemote(trimmed, deviceId);
    if (!remote.success) {
        return {
            success: false,
            error: remote.error ?? 'This email is not authorized. Contact the admin for access.',
        };
    }
    const now = new Date().toISOString();
    saveSignedState(trimmed, deviceId, now, now);
    return { success: true };
}
/**
 * Check if the app is activated on this device.
 * Re-validates with the server every launch. If the server says the license
 * was revoked or re-bound, the local cache is wiped. Allows a short offline
 * grace period so the app doesn't brick without internet.
 */
async function isActivated() {
    const raw = loadSignedState();
    if (!raw) {
        return false;
    }
    // Verify HMAC + device — catches copied/tampered files
    const state = verifySignedState(raw);
    if (!state) {
        clearActivationState();
        return false;
    }
    const newDeviceId = getDeviceFingerprint();
    const needsMigration = state.deviceId !== newDeviceId;
    // If migrating from legacy fingerprint, re-activate with the new device ID
    // so the server records the stable fingerprint going forward.
    if (needsMigration) {
        console.log('Migrating activation to stable device fingerprint...');
        const migrateResult = await activateRemote(state.email, newDeviceId);
        if (migrateResult.success) {
            const now = new Date().toISOString();
            saveSignedState(state.email, newDeviceId, state.activatedAt, now);
            console.log('Activation migrated successfully.');
            return true;
        }
        // Migration failed — the server may have rejected the new device.
        // Fall through to validate with the old device ID as a last resort.
        console.warn('Migration failed:', migrateResult.error);
    }
    // Phone home to re-validate
    const result = await validateRemote(state.email, needsMigration ? state.deviceId : newDeviceId);
    if (result.valid) {
        // Update lastValidated timestamp (keep current deviceId if not migrated)
        saveSignedState(state.email, needsMigration ? state.deviceId : newDeviceId, state.activatedAt, new Date().toISOString());
        return true;
    }
    // If offline, allow grace period
    if (result.error === 'offline') {
        const lastValidated = new Date(state.lastValidated).getTime();
        const daysSince = (Date.now() - lastValidated) / (1000 * 60 * 60 * 24);
        if (daysSince <= OFFLINE_GRACE_DAYS) {
            console.log(`Offline validation: ${daysSince.toFixed(1)} days since last check (grace: ${OFFLINE_GRACE_DAYS}d)`);
            return true;
        }
        console.warn('Offline grace period expired — activation invalid.');
        clearActivationState();
        return false;
    }
    // Server explicitly said invalid — revoked, wrong device, etc.
    console.warn('Server rejected activation:', result.error);
    clearActivationState();
    return false;
}
/** Get the current activation state (or null). */
function getActivationState() {
    const raw = loadSignedState();
    if (!raw) {
        return null;
    }
    const state = verifySignedState(raw);
    if (!state) {
        return null;
    }
    return {
        email: state.email,
        deviceId: state.deviceId,
        activatedAt: state.activatedAt,
    };
}
//# sourceMappingURL=activation.js.map