"use strict";
// Simple JSON file store for persisting app configuration
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.getConfig = getConfig;
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const CONFIG_FILE = path_1.default.join(electron_1.app.getPath('userData'), 'config.json');
const DEFAULT_CONFIG = {
    screenName: '',
    cameraLabel: '',
    micLabel: '',
    layout: 'camera-right',
    overlay: {
        name: '',
        nameFont: 'Roboto',
        nameFontSize: 25,
        bgColor: '#6b8cce',
        bgStyle: 'solid',
        cinemaFilter: 'none',
        cameraEnhancement: {
            brightness: 105,
            contrast: 110,
            saturation: 115,
            warmth: 5,
            sharpness: 0,
            softness: 0,
        },
        socials: { x: '', youtube: '', tiktok: '', instagram: '' },
        ambientParticles: false,
        mouseZoom: 1.5,
        zoomLingerMs: 2500,
        ctaText: '',
        ctaIcon: '',
        ctaIntervalMs: 180000,
    },
};
let config = { ...DEFAULT_CONFIG };
function loadConfig() {
    try {
        if (fs_1.default.existsSync(CONFIG_FILE)) {
            const raw = fs_1.default.readFileSync(CONFIG_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            config = {
                ...DEFAULT_CONFIG,
                ...parsed,
                overlay: { ...DEFAULT_CONFIG.overlay, ...(parsed.overlay ?? {}) },
            };
        }
    }
    catch (err) {
        console.warn('Failed to load config:', err);
        config = { ...DEFAULT_CONFIG };
    }
    return config;
}
async function saveConfig(partial) {
    if (partial.overlay) {
        config.overlay = { ...config.overlay, ...partial.overlay };
    }
    config = { ...config, ...partial, overlay: config.overlay };
    try {
        await fs_1.default.promises.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    }
    catch (err) {
        console.warn('Failed to save config:', err);
    }
}
function getConfig() {
    return config;
}
//# sourceMappingURL=store.js.map