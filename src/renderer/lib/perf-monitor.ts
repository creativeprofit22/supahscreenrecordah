// Performance monitor overlay — identifies bottlenecks that could affect recording quality
//
// Toggle with Cmd+Shift+P. Shows real-time FPS, frame time breakdown,
// memory usage, active animations, and actionable warnings.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfileBreakdown {
  total: number;
  setup: number;
  screen: number;
  camera: number;
  overlays: number;
  socials: number;
  actionFeed: number;
  waveform: number;
  cinemaFilter: number;
}

interface PipelineState {
  isRecording: boolean;
  profile: ProfileBreakdown;
  frameCount: number;
  droppedFrames: number;
  recorderState: string | null;
  chunkCount: number;
  targetFps: number;
}

interface FeatureInfo {
  name: string;
  active: boolean;
  cost: 'low' | 'medium' | 'high';
}

type ProfileSection = keyof Omit<ProfileBreakdown, 'total'>;

// Extend Performance for Chromium-specific memory info
interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

declare global {
  interface Performance {
    memory?: PerformanceMemory;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FPS_HISTORY_SIZE = 120; // ~2 seconds of data at 60fps
const MEMORY_POLL_INTERVAL = 1000; // ms
const WARNING_FRAME_BUDGET_MS = 1000 / 30; // 33.3ms at 30fps
const DANGER_FRAME_BUDGET_MS = WARNING_FRAME_BUDGET_MS * 1.5; // 50ms

// Section colors (Catppuccin-inspired)
const SECTION_COLORS: Record<ProfileSection, string> = {
  setup: '#89b4fa', // blue
  screen: '#a6e3a1', // green
  camera: '#f9e2af', // yellow
  overlays: '#fab387', // peach
  socials: '#cba6f7', // mauve
  actionFeed: '#94e2d5', // teal
  waveform: '#89dceb', // sapphire
  cinemaFilter: '#f38ba8', // red
};

const PROFILE_SECTIONS: ProfileSection[] = [
  'setup',
  'screen',
  'camera',
  'overlays',
  'socials',
  'actionFeed',
  'waveform',
  'cinemaFilter',
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let panelEl: HTMLDivElement | null = null;
let visible = false;
let animFrame = 0;

// FPS tracking
const fpsHistory: number[] = [];
let frameCount = 0;
let fpsLastCalc = 0;
let currentFps = 0;

// Recording FPS tracking
let currentRecFps = 0;

// Memory tracking
let heapUsedMB = 0;
let heapTotalMB = 0;
let heapLimitMB = 0;
let lastMemoryPoll = 0;

// State provided by main.ts
let pipelineState: PipelineState = {
  isRecording: false,
  profile: {
    total: 0,
    setup: 0,
    screen: 0,
    camera: 0,
    overlays: 0,
    socials: 0,
    actionFeed: 0,
    waveform: 0,
    cinemaFilter: 0,
  },
  frameCount: 0,
  droppedFrames: 0,
  recorderState: null,
  chunkCount: 0,
  targetFps: 30,
};

let activeFeatures: FeatureInfo[] = [];
let warnings: string[] = [];

// ---------------------------------------------------------------------------
// DOM creation
// ---------------------------------------------------------------------------

function createPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.id = 'perf-monitor';
  panel.className = 'perf-monitor';
  panel.innerHTML = `
    <div class="perf-header">
      <span class="perf-title">⚡ Performance Monitor</span>
      <span class="perf-copy" title="Copy snapshot to clipboard">📋</span>
      <span class="perf-close" title="Close (⌘⇧P)">✕</span>
    </div>
    <div class="perf-body">
      <div class="perf-section perf-fps-section">
        <div class="perf-section-title">Frame Rate</div>
        <div class="perf-fps-row">
          <div class="perf-fps-gauge" id="perf-preview-fps">
            <span class="perf-fps-value">--</span>
            <span class="perf-fps-label">Preview</span>
          </div>
          <div class="perf-fps-gauge" id="perf-rec-fps">
            <span class="perf-fps-value">--</span>
            <span class="perf-fps-label">Recording</span>
          </div>
          <div class="perf-fps-gauge" id="perf-dropped">
            <span class="perf-fps-value perf-dropped-value">0</span>
            <span class="perf-fps-label">Dropped</span>
          </div>
        </div>
      </div>

      <div class="perf-section perf-frame-section">
        <div class="perf-section-title">Frame Time Breakdown <span id="perf-frame-avg" class="perf-frame-avg">--ms</span></div>
        <div class="perf-frame-bar" id="perf-frame-bar"></div>
        <div class="perf-frame-legend" id="perf-frame-legend"></div>
      </div>

      <div class="perf-section perf-memory-section">
        <div class="perf-section-title">Memory</div>
        <div class="perf-memory-row">
          <div class="perf-memory-bar-container">
            <div class="perf-memory-bar" id="perf-memory-bar"></div>
          </div>
          <span id="perf-memory-text" class="perf-memory-text">--</span>
        </div>
      </div>

      <div class="perf-section perf-features-section">
        <div class="perf-section-title">Active Features</div>
        <div class="perf-features-list" id="perf-features-list"></div>
      </div>

      <div class="perf-section perf-warnings-section" id="perf-warnings-section" style="display:none;">
        <div class="perf-section-title perf-warning-title">⚠ Recommendations</div>
        <div class="perf-warnings-list" id="perf-warnings-list"></div>
      </div>

      <div class="perf-section perf-recorder-section">
        <div class="perf-section-title">Recorder</div>
        <div class="perf-recorder-info" id="perf-recorder-info">Inactive</div>
      </div>
    </div>
  `;

  const copyBtn = panel.querySelector('.perf-copy') as HTMLElement;
  copyBtn.addEventListener('click', () => {
    copySnapshot(copyBtn);
  });

  const closeBtn = panel.querySelector('.perf-close') as HTMLElement;
  closeBtn.addEventListener('click', () => {
    hide();
  });

  // Prevent the panel from interfering with preview interactions
  panel.addEventListener('mousedown', (e: MouseEvent) => {
    e.stopPropagation();
  });

  document.body.appendChild(panel);
  return panel;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function updateFps(): void {
  const now = performance.now();
  frameCount++;
  if (now - fpsLastCalc >= 500) {
    currentFps = Math.round((frameCount * 1000) / (now - fpsLastCalc));
    fpsLastCalc = now;
    frameCount = 0;
    fpsHistory.push(currentFps);
    if (fpsHistory.length > FPS_HISTORY_SIZE) {
      fpsHistory.shift();
    }
  }
}

function updateRecFps(): void {
  if (!pipelineState.isRecording || pipelineState.frameCount === 0) {
    currentRecFps = 0;
    return;
  }
  // frameCount and profile.total cover the same accumulation window (~3s).
  // Derive FPS from avg frame time: fps ≈ 1000 / avgFrameMs
  const avgMs = pipelineState.profile.total / pipelineState.frameCount;
  currentRecFps = avgMs > 0 ? Math.round(1000 / avgMs) : pipelineState.targetFps;
}

function updateMemory(): void {
  const now = performance.now();
  if (now - lastMemoryPoll < MEMORY_POLL_INTERVAL) {
    return;
  }
  lastMemoryPoll = now;
  if (performance.memory) {
    heapUsedMB = performance.memory.usedJSHeapSize / (1024 * 1024);
    heapTotalMB = performance.memory.totalJSHeapSize / (1024 * 1024);
    heapLimitMB = performance.memory.jsHeapSizeLimit / (1024 * 1024);
  }
}

function generateWarnings(): string[] {
  const w: string[] = [];

  if (pipelineState.isRecording) {
    const avgMs =
      pipelineState.frameCount > 0
        ? pipelineState.profile.total / pipelineState.frameCount
        : 0;

    if (avgMs > DANGER_FRAME_BUDGET_MS) {
      w.push(
        `Frame time ${avgMs.toFixed(1)}ms exceeds 50ms budget — recording will drop frames. Disable cinema filters or reduce active overlays.`,
      );
    } else if (avgMs > WARNING_FRAME_BUDGET_MS) {
      w.push(
        `Frame time ${avgMs.toFixed(1)}ms is over 33ms budget — consider disabling film grain or reducing active overlays.`,
      );
    }

    if (pipelineState.droppedFrames > 5) {
      w.push(
        `${pipelineState.droppedFrames} frames dropped in last window — rendering can't keep up with ${pipelineState.targetFps}fps target.`,
      );
    }

    // Check which sections are expensive
    if (pipelineState.frameCount > 0) {
      const n = pipelineState.frameCount;
      const cinemaAvg = pipelineState.profile.cinemaFilter / n;
      const screenAvg = pipelineState.profile.screen / n;
      const cameraAvg = pipelineState.profile.camera / n;
      const socialsAvg = pipelineState.profile.socials / n;

      if (cinemaAvg > 10) {
        w.push(
          `Cinema filter averaging ${cinemaAvg.toFixed(1)}ms/frame — film grain and vignette are GPU-intensive. Try "none" filter.`,
        );
      }
      if (screenAvg > 15) {
        w.push(
          `Screen capture drawing ${screenAvg.toFixed(1)}ms/frame — zoom crop is expensive. Reduce zoom usage.`,
        );
      }
      if (cameraAvg > 10) {
        w.push(
          `Camera drawing ${cameraAvg.toFixed(1)}ms/frame — check camera resolution (ideal: 720p for recording).`,
        );
      }
      if (socialsAvg > 5) {
        w.push(
          `Social overlays ${socialsAvg.toFixed(1)}ms/frame — reduce social links count or disable them.`,
        );
      }
    }
  }

  // Memory warnings
  if (heapUsedMB > 500) {
    w.push(`High memory usage: ${heapUsedMB.toFixed(0)}MB — long recordings may cause GC pauses.`);
  }

  // Feature cost warnings
  const highCostFeatures = activeFeatures.filter((f) => f.active && f.cost === 'high');
  if (highCostFeatures.length >= 3) {
    w.push(
      `${highCostFeatures.length} high-cost features active simultaneously. Consider disabling some for smoother recording.`,
    );
  }

  return w;
}

function renderPanel(): void {
  if (!panelEl || !visible) {
    return;
  }

  updateFps();
  updateRecFps();
  updateMemory();
  warnings = generateWarnings();

  // Preview FPS
  const previewFpsEl = panelEl.querySelector('#perf-preview-fps .perf-fps-value') as HTMLElement;
  previewFpsEl.textContent = String(currentFps);
  previewFpsEl.className =
    'perf-fps-value' +
    (currentFps < 30 ? ' perf-danger' : currentFps < 55 ? ' perf-warn' : ' perf-good');

  // Recording FPS
  const recFpsEl = panelEl.querySelector('#perf-rec-fps .perf-fps-value') as HTMLElement;
  if (pipelineState.isRecording) {
    recFpsEl.textContent = String(currentRecFps);
    recFpsEl.className =
      'perf-fps-value' +
      (currentRecFps < 25 ? ' perf-danger' : currentRecFps < 29 ? ' perf-warn' : ' perf-good');
  } else {
    recFpsEl.textContent = '--';
    recFpsEl.className = 'perf-fps-value';
  }

  // Dropped frames
  const droppedEl = panelEl.querySelector('.perf-dropped-value') as HTMLElement;
  droppedEl.textContent = String(pipelineState.droppedFrames);
  droppedEl.className =
    'perf-fps-value perf-dropped-value' +
    (pipelineState.droppedFrames > 10
      ? ' perf-danger'
      : pipelineState.droppedFrames > 0
        ? ' perf-warn'
        : '');

  // Frame time breakdown
  renderFrameBreakdown();

  // Memory
  const memBar = panelEl.querySelector('#perf-memory-bar') as HTMLElement;
  const memText = panelEl.querySelector('#perf-memory-text') as HTMLElement;
  if (heapLimitMB > 0) {
    const pct = Math.min(100, (heapUsedMB / heapLimitMB) * 100);
    memBar.style.width = `${pct}%`;
    memBar.className =
      'perf-memory-bar' +
      (pct > 80 ? ' perf-danger-bg' : pct > 60 ? ' perf-warn-bg' : ' perf-good-bg');
    memText.textContent = `${heapUsedMB.toFixed(0)}MB / ${heapTotalMB.toFixed(0)}MB`;
  } else {
    memBar.style.width = '0%';
    memText.textContent = 'N/A';
  }

  // Active features
  const featList = panelEl.querySelector('#perf-features-list') as HTMLElement;
  featList.innerHTML = '';
  for (const feat of activeFeatures) {
    if (!feat.active) {
      continue;
    }
    const item = document.createElement('div');
    item.className = 'perf-feature-item';

    const dot = document.createElement('span');
    dot.className =
      'perf-feature-dot' +
      (feat.cost === 'high'
        ? ' perf-danger-bg'
        : feat.cost === 'medium'
          ? ' perf-warn-bg'
          : ' perf-good-bg');

    const label = document.createElement('span');
    label.className = 'perf-feature-label';
    label.textContent = feat.name;

    const cost = document.createElement('span');
    cost.className =
      'perf-feature-cost' +
      (feat.cost === 'high'
        ? ' perf-danger'
        : feat.cost === 'medium'
          ? ' perf-warn'
          : ' perf-good');
    cost.textContent = feat.cost;

    item.appendChild(dot);
    item.appendChild(label);
    item.appendChild(cost);
    featList.appendChild(item);
  }

  // Warnings
  const warningsSection = panelEl.querySelector('#perf-warnings-section') as HTMLElement;
  const warningsList = panelEl.querySelector('#perf-warnings-list') as HTMLElement;
  if (warnings.length > 0) {
    warningsSection.style.display = '';
    warningsList.innerHTML = '';
    for (const w of warnings) {
      const item = document.createElement('div');
      item.className = 'perf-warning-item';
      item.textContent = w;
      warningsList.appendChild(item);
    }
  } else {
    warningsSection.style.display = 'none';
  }

  // Recorder info
  const recInfo = panelEl.querySelector('#perf-recorder-info') as HTMLElement;
  if (pipelineState.isRecording) {
    recInfo.textContent = `State: ${pipelineState.recorderState ?? 'unknown'} | Chunks: ${pipelineState.chunkCount} | Target: ${pipelineState.targetFps}fps`;
  } else {
    recInfo.textContent = 'Inactive';
  }

  animFrame = requestAnimationFrame(renderPanel);
}

function renderFrameBreakdown(): void {
  if (!panelEl) {
    return;
  }

  const bar = panelEl.querySelector('#perf-frame-bar') as HTMLElement;
  const legend = panelEl.querySelector('#perf-frame-legend') as HTMLElement;
  const avgLabel = panelEl.querySelector('#perf-frame-avg') as HTMLElement;

  if (!pipelineState.isRecording || pipelineState.frameCount === 0) {
    bar.innerHTML = '<div class="perf-frame-empty">Not recording</div>';
    legend.innerHTML = '';
    avgLabel.textContent = '--ms';
    return;
  }

  const n = pipelineState.frameCount;
  const avgTotal = pipelineState.profile.total / n;

  avgLabel.textContent = `${avgTotal.toFixed(1)}ms`;
  avgLabel.className =
    'perf-frame-avg' +
    (avgTotal > DANGER_FRAME_BUDGET_MS
      ? ' perf-danger'
      : avgTotal > WARNING_FRAME_BUDGET_MS
        ? ' perf-warn'
        : ' perf-good');

  // Build stacked bar
  bar.innerHTML = '';
  const total = pipelineState.profile.total;
  for (const section of PROFILE_SECTIONS) {
    const value = pipelineState.profile[section];
    if (value <= 0) {
      continue;
    }
    const pct = (value / total) * 100;
    const seg = document.createElement('div');
    seg.className = 'perf-frame-segment';
    seg.style.width = `${pct}%`;
    seg.style.backgroundColor = SECTION_COLORS[section];
    seg.title = `${section}: ${(value / n).toFixed(1)}ms (${pct.toFixed(0)}%)`;
    bar.appendChild(seg);
  }

  // Budget marker
  const budgetPct =
    (WARNING_FRAME_BUDGET_MS / Math.max(avgTotal, WARNING_FRAME_BUDGET_MS * 1.2)) * 100;
  const marker = document.createElement('div');
  marker.className = 'perf-budget-marker';
  marker.style.left = `${Math.min(100, budgetPct)}%`;
  marker.title = `${WARNING_FRAME_BUDGET_MS.toFixed(1)}ms budget (30fps)`;
  bar.appendChild(marker);

  // Legend
  legend.innerHTML = '';
  for (const section of PROFILE_SECTIONS) {
    const value = pipelineState.profile[section];
    if (value <= 0) {
      continue;
    }
    const avg = value / n;
    if (avg < 0.1) {
      continue;
    }
    const item = document.createElement('span');
    item.className = 'perf-legend-item';

    const dot = document.createElement('span');
    dot.className = 'perf-legend-dot';
    dot.style.backgroundColor = SECTION_COLORS[section];

    const text = document.createElement('span');
    text.textContent = `${section} ${avg.toFixed(1)}ms`;

    item.appendChild(dot);
    item.appendChild(text);
    legend.appendChild(item);
  }
}

// ---------------------------------------------------------------------------
// Snapshot / clipboard
// ---------------------------------------------------------------------------

function formatSnapshot(): string {
  const lines: string[] = [];
  const ts = new Date().toISOString();
  lines.push(`=== supahscreenrecordah Performance Snapshot (${ts}) ===`);
  lines.push('');

  // FPS
  lines.push('## Frame Rate');
  lines.push(`  Preview FPS:   ${currentFps}`);
  lines.push(
    `  Recording FPS: ${pipelineState.isRecording ? String(currentRecFps) : 'N/A (not recording)'}`,
  );
  lines.push(`  Dropped:       ${pipelineState.droppedFrames}`);
  lines.push('');

  // Frame time breakdown
  lines.push('## Frame Time Breakdown');
  if (pipelineState.isRecording && pipelineState.frameCount > 0) {
    const n = pipelineState.frameCount;
    const avgTotal = pipelineState.profile.total / n;
    lines.push(
      `  Avg total: ${avgTotal.toFixed(1)}ms (budget: ${WARNING_FRAME_BUDGET_MS.toFixed(1)}ms)`,
    );
    for (const s of PROFILE_SECTIONS) {
      const avg = pipelineState.profile[s] / n;
      if (avg >= 0.1) {
        const pct = ((pipelineState.profile[s] / pipelineState.profile.total) * 100).toFixed(0);
        lines.push(`  ${s.padEnd(14)} ${avg.toFixed(1)}ms  (${pct}%)`);
      }
    }
  } else {
    lines.push('  Not recording');
  }
  lines.push('');

  // Memory
  lines.push('## Memory');
  if (heapLimitMB > 0) {
    const pct = ((heapUsedMB / heapLimitMB) * 100).toFixed(1);
    lines.push(
      `  Heap used:  ${heapUsedMB.toFixed(0)}MB / ${heapTotalMB.toFixed(0)}MB (${pct}% of limit)`,
    );
    lines.push(`  Heap limit: ${heapLimitMB.toFixed(0)}MB`);
  } else {
    lines.push('  N/A (performance.memory not available)');
  }
  lines.push('');

  // Active features
  const active = activeFeatures.filter((f) => f.active);
  lines.push(`## Active Features (${active.length})`);
  if (active.length > 0) {
    for (const f of active) {
      lines.push(`  [${f.cost.toUpperCase()}] ${f.name}`);
    }
  } else {
    lines.push('  None');
  }
  lines.push('');

  // Recorder
  lines.push('## Recorder');
  if (pipelineState.isRecording) {
    lines.push(`  State:      ${pipelineState.recorderState ?? 'unknown'}`);
    lines.push(`  Chunks:     ${pipelineState.chunkCount}`);
    lines.push(`  Target FPS: ${pipelineState.targetFps}`);
  } else {
    lines.push('  Inactive');
  }
  lines.push('');

  // Warnings
  if (warnings.length > 0) {
    lines.push(`## Warnings (${warnings.length})`);
    for (const w of warnings) {
      lines.push(`  ⚠ ${w}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function copyToClipboard(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    // copy failed — ok remains false
  }
  document.body.removeChild(textarea);
  return ok;
}

function copySnapshot(btn: HTMLElement): void {
  const text = formatSnapshot();
  const ok = copyToClipboard(text);
  const original = btn.textContent;
  btn.textContent = ok ? '✅' : '⚠️';
  setTimeout(() => {
    btn.textContent = original;
  }, 1500);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Update the pipeline state snapshot — call from main.ts recording loop */
export function updatePipelineState(state: PipelineState): void {
  pipelineState = state;
}

/** Update the list of active features — call from main.ts when features change */
export function updateActiveFeatures(features: FeatureInfo[]): void {
  activeFeatures = features;
}

/** Show the performance monitor */
export function show(): void {
  if (!panelEl) {
    panelEl = createPanel();
  }
  panelEl.classList.add('active');
  visible = true;
  fpsLastCalc = performance.now();
  frameCount = 0;
  animFrame = requestAnimationFrame(renderPanel);
}

/** Hide the performance monitor */
export function hide(): void {
  if (panelEl) {
    panelEl.classList.remove('active');
  }
  visible = false;
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = 0;
  }
}

/** Toggle the performance monitor visibility */
export function toggle(): void {
  if (visible) {
    hide();
  } else {
    show();
  }
}

/** Whether the monitor is currently visible */
export function isVisible(): boolean {
  return visible;
}

/** Initialize the perf monitor — sets up keyboard shortcut */
export function initPerfMonitor(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // Cmd+Shift+P (macOS) or Ctrl+Shift+P (other)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
      e.preventDefault();
      toggle();
    }
  });
}
