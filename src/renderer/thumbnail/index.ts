// Thumbnail review modal renderer

import type {
  ExportPlatform,
  ThumbnailOpenPayload,
  ThumbnailProgressUpdate,
} from '../../shared/types';
import { EXPORT_PRESETS } from '../../shared/feature-types';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;
const skipBtn = document.getElementById('skip-btn') as HTMLButtonElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const statusBar = document.getElementById('status-bar') as HTMLDivElement;
const platformTabsEl = document.getElementById('platform-tabs') as HTMLDivElement;
const sectionsContainer = document.getElementById('sections-container') as HTMLDivElement;
const platformChecksEl = document.getElementById('platform-checks') as HTMLDivElement;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface AspectGroup {
  aspectRatio: string;
  label: string;
  platforms: ExportPlatform[];
  keyFrames: string[];
  aiImagePath: string | null;
  selectedPath: string | null;
  prompt: string;
  titleText: string;
  generating: boolean;
}

let groups: AspectGroup[] = [];
let activeGroupIndex = 0;
let enabledPlatforms: Set<ExportPlatform> = new Set();
let initPayload: ThumbnailOpenPayload | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showStatus(msg: string, isError = false): void {
  statusBar.textContent = msg;
  statusBar.classList.add('visible');
  statusBar.classList.toggle('error', isError);
}

function hideStatus(): void {
  statusBar.classList.remove('visible');
}

function buildDefaultPrompt(summary?: string, title?: string): string {
  const titlePart = title ? `bold text overlay saying '${title}', ` : '';
  const topicSnippet = (summary ?? '').slice(0, 200).trim();
  return `Professional YouTube thumbnail, ${titlePart}vibrant colors, high contrast, engaging, ${topicSnippet}`;
}

function fileUrl(filePath: string): string {
  // Convert local file path to a loadable URL
  // On Windows: file:///C:/path — on Linux: file:///path
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return `file://${normalized}`;
  return `file:///${normalized}`;
}

// Thumbnail card sizing based on aspect ratio
function thumbSize(aspect: string): { width: number; height: number } {
  const [w, h] = aspect.split(':').map(Number);
  const ratio = w / h;
  if (ratio >= 1) return { width: 180, height: Math.round(180 / ratio) };
  return { width: Math.round(130 * ratio), height: 130 };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderTabs(): void {
  platformTabsEl.innerHTML = '';
  groups.forEach((g, i) => {
    const tab = document.createElement('button');
    tab.className = `platform-tab${i === activeGroupIndex ? ' active' : ''}`;
    tab.textContent = `${g.label} ${g.aspectRatio}`;
    tab.addEventListener('click', () => {
      activeGroupIndex = i;
      renderTabs();
      renderActiveSection();
    });
    platformTabsEl.appendChild(tab);
  });
}

function renderActiveSection(): void {
  sectionsContainer.innerHTML = '';
  const g = groups[activeGroupIndex];
  if (!g) return;

  const section = document.createElement('div');
  section.className = 'aspect-section active';

  // Section title
  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = `${g.label} (${g.aspectRatio}) — ${g.platforms.map(p => EXPORT_PRESETS[p].label).join(', ')}`;
  section.appendChild(title);

  // Thumbnail grid
  const grid = document.createElement('div');
  grid.className = 'thumb-grid';
  const size = thumbSize(g.aspectRatio);

  // AI thumbnail card
  const aiCard = document.createElement('div');
  aiCard.className = `thumb-card ai-generated${g.selectedPath === g.aiImagePath && g.aiImagePath ? ' selected' : ''}`;
  aiCard.style.width = `${size.width}px`;
  aiCard.style.height = `${size.height}px`;

  if (g.generating) {
    aiCard.classList.add('loading');
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    aiCard.appendChild(spinner);
  } else if (g.aiImagePath) {
    const img = document.createElement('img');
    img.src = fileUrl(g.aiImagePath);
    img.alt = 'AI Generated';
    aiCard.appendChild(img);
    aiCard.addEventListener('click', () => {
      g.selectedPath = g.aiImagePath;
      renderActiveSection();
      updateSaveBtn();
    });
  } else {
    aiCard.classList.add('loading');
    const placeholder = document.createElement('div');
    placeholder.style.cssText = 'font-size:11px;color:#666;text-align:center;padding:8px;';
    placeholder.textContent = 'Click Regenerate to create AI thumbnail';
    aiCard.appendChild(placeholder);
  }

  const aiLabel = document.createElement('div');
  aiLabel.className = 'thumb-label';
  aiLabel.textContent = '✨ AI Generated';
  aiCard.appendChild(aiLabel);
  grid.appendChild(aiCard);

  // Key frame cards
  g.keyFrames.forEach((framePath, fi) => {
    const card = document.createElement('div');
    card.className = `thumb-card${g.selectedPath === framePath ? ' selected' : ''}`;
    card.style.width = `${size.width}px`;
    card.style.height = `${size.height}px`;

    const img = document.createElement('img');
    img.src = fileUrl(framePath);
    img.alt = `Frame ${fi + 1}`;
    card.appendChild(img);

    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = `Frame ${fi + 1}`;
    card.appendChild(label);

    card.addEventListener('click', () => {
      g.selectedPath = framePath;
      renderActiveSection();
      updateSaveBtn();
    });

    grid.appendChild(card);
  });

  section.appendChild(grid);

  // Title overlay input
  const promptArea = document.createElement('div');
  promptArea.className = 'prompt-area';

  const titleLabel = document.createElement('label');
  titleLabel.textContent = 'Title / Text Overlay';
  promptArea.appendChild(titleLabel);

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'title-input';
  titleInput.placeholder = 'Text to overlay on thumbnail (optional)';
  titleInput.value = g.titleText;
  titleInput.addEventListener('input', () => {
    g.titleText = titleInput.value;
  });
  promptArea.appendChild(titleInput);

  // Prompt textarea + regenerate
  const promptLabel = document.createElement('label');
  promptLabel.textContent = 'AI Prompt (editable)';
  promptArea.appendChild(promptLabel);

  const promptRow = document.createElement('div');
  promptRow.className = 'prompt-row';

  const promptInput = document.createElement('textarea');
  promptInput.className = 'prompt-input';
  promptInput.value = g.prompt;
  promptInput.addEventListener('input', () => {
    g.prompt = promptInput.value;
  });
  promptRow.appendChild(promptInput);

  const regenBtn = document.createElement('button');
  regenBtn.className = 'btn btn-regen';
  regenBtn.textContent = 'Regenerate';
  regenBtn.disabled = g.generating;
  regenBtn.addEventListener('click', () => regenerate(activeGroupIndex));
  promptRow.appendChild(regenBtn);

  promptArea.appendChild(promptRow);
  section.appendChild(promptArea);

  sectionsContainer.appendChild(section);
}

function renderPlatformChecks(): void {
  platformChecksEl.innerHTML = '';
  if (!initPayload) return;

  initPayload.platforms.forEach((p) => {
    const label = document.createElement('label');
    label.className = 'platform-check';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = enabledPlatforms.has(p);
    cb.addEventListener('change', () => {
      if (cb.checked) {
        enabledPlatforms.add(p);
      } else {
        enabledPlatforms.delete(p);
      }
      updateSaveBtn();
    });

    label.appendChild(cb);
    label.appendChild(document.createTextNode(EXPORT_PRESETS[p].label));
    platformChecksEl.appendChild(label);
  });
}

function updateSaveBtn(): void {
  // Enable save only if at least one enabled platform's group has a selection
  const hasSelection = groups.some(
    (g) => g.selectedPath && g.platforms.some((p) => enabledPlatforms.has(p)),
  );
  saveBtn.disabled = !hasSelection;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function regenerate(groupIndex: number): Promise<void> {
  const g = groups[groupIndex];
  if (!g || g.generating) return;

  g.generating = true;
  renderActiveSection();

  try {
    // If user typed a title, fold it into the prompt
    let prompt = g.prompt;
    if (g.titleText && !prompt.includes(g.titleText)) {
      prompt = `bold text overlay saying '${g.titleText}', ${prompt}`;
    }

    const imagePath = await window.thumbnailAPI.generate({
      prompt,
      aspectRatio: g.aspectRatio,
      platform: g.platforms[0],
    });

    g.aiImagePath = imagePath;
    g.selectedPath = imagePath;
    g.generating = false;
  } catch (err) {
    g.generating = false;
    showStatus(`Generation failed: ${err instanceof Error ? err.message : String(err)}`, true);
  }

  renderActiveSection();
  updateSaveBtn();
}

async function handleSave(): Promise<void> {
  if (!initPayload) return;

  const selections: Array<{
    platform: ExportPlatform;
    aspectRatio: string;
    imagePath: string;
  }> = [];

  for (const g of groups) {
    if (!g.selectedPath) continue;
    for (const p of g.platforms) {
      if (!enabledPlatforms.has(p)) continue;
      selections.push({
        platform: p,
        aspectRatio: g.aspectRatio,
        imagePath: g.selectedPath,
      });
    }
  }

  if (selections.length === 0) return;

  saveBtn.disabled = true;
  showStatus('Saving thumbnails…');

  try {
    const paths = await window.thumbnailAPI.save({
      videoPath: initPayload.videoPath,
      selections,
    });
    showStatus(`Saved ${paths.length} thumbnail(s)!`);
  } catch (err) {
    showStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`, true);
    saveBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  initPayload = await window.thumbnailAPI.getInitData();
  if (!initPayload) {
    showStatus('No thumbnail data available.', true);
    return;
  }

  // Build aspect ratio groups from platforms
  const aspectMap = new Map<string, { platforms: ExportPlatform[]; label: string }>();
  for (const p of initPayload.platforms) {
    const preset = EXPORT_PRESETS[p];
    const key = preset.thumbnailAspect;
    if (!aspectMap.has(key)) {
      // Derive a label from the aspect ratio
      const [w, h] = key.split(':').map(Number);
      const label = w > h ? 'Landscape' : w < h ? 'Vertical' : 'Square';
      aspectMap.set(key, { platforms: [], label });
    }
    aspectMap.get(key)!.platforms.push(p);
  }

  const defaultPrompt = buildDefaultPrompt(initPayload.transcriptSummary, initPayload.videoTitle);

  groups = [...aspectMap.entries()].map(([aspectRatio, { platforms, label }]) => ({
    aspectRatio,
    label,
    platforms,
    keyFrames: [],
    aiImagePath: null,
    selectedPath: null,
    prompt: defaultPrompt,
    titleText: initPayload?.videoTitle ?? '',
    generating: false,
  }));

  enabledPlatforms = new Set(initPayload.platforms);

  renderTabs();
  renderActiveSection();
  renderPlatformChecks();
  updateSaveBtn();

  // Extract key frames in background
  showStatus('Extracting key frames from video…');
  try {
    const frames = await window.thumbnailAPI.extractFrames(initPayload.videoPath);
    for (const g of groups) {
      g.keyFrames = frames;
    }
    hideStatus();
    renderActiveSection();
  } catch {
    showStatus('Could not extract key frames — you can still generate AI thumbnails.', true);
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

closeBtn.addEventListener('click', () => window.thumbnailAPI.close());
skipBtn.addEventListener('click', () => window.thumbnailAPI.skip());
saveBtn.addEventListener('click', handleSave);

window.thumbnailAPI.onProgress((update: ThumbnailProgressUpdate) => {
  if (update.stage === 'error') {
    showStatus(update.message, true);
  } else if (update.stage === 'done') {
    // Don't hide — let the save handler manage final status
  } else {
    showStatus(update.message);
  }
});

init();
