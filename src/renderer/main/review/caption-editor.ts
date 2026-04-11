// Caption Editor — modal for editing transcribed subtitle text
// ---------------------------------------------------------------------------

import type { TranscribedWord } from '../../../main/services/assemblyai/types';
import {
  captionEditorModal, captionEditorClose, captionEditorList,
} from '../dom';

// ---------------------------------------------------------------------------
// Word grouping (mirrors caption-preview groupWords logic)
// ---------------------------------------------------------------------------

interface EditorGroup {
  words: TranscribedWord[];
  start: number;
  end: number;
}

const MAX_WORDS_PER_LINE = 6;

function buildGroups(words: TranscribedWord[]): EditorGroup[] {
  if (words.length === 0) return [];

  const groups: EditorGroup[] = [];
  let current: TranscribedWord[] = [];

  for (const word of words) {
    current.push(word);
    let shouldBreak = current.length >= MAX_WORDS_PER_LINE;
    const lastChar = word.text.slice(-1);
    if ('.!?,;:'.includes(lastChar)) shouldBreak = true;

    if (shouldBreak) {
      groups.push({
        words: [...current],
        start: current[0].start,
        end: current[current.length - 1].end,
      });
      current = [];
    }
  }

  if (current.length > 0) {
    groups.push({
      words: [...current],
      start: current[0].start,
      end: current[current.length - 1].end,
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let isOpen = false;
let currentWords: TranscribedWord[] = [];
let seekCallback: ((time: number) => void) | null = null;
let onEditCallback: (() => void) | null = null;
let activeRowIndex = -1;
let playheadRafId: number | null = null;
let getPlayheadTime: (() => number) | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function openCaptionEditor(
  words: TranscribedWord[],
  onSeek: (time: number) => void,
  onEdit: () => void,
  getPlayhead: () => number,
): void {
  currentWords = words;
  seekCallback = onSeek;
  onEditCallback = onEdit;
  getPlayheadTime = getPlayhead;

  buildEditorRows();
  captionEditorModal.classList.remove('hidden');
  isOpen = true;
  startPlayheadTracking();
}

export function closeCaptionEditor(): void {
  captionEditorModal.classList.add('hidden');
  isOpen = false;
  currentWords = [];
  seekCallback = null;
  onEditCallback = null;
  getPlayheadTime = null;
  activeRowIndex = -1;
  stopPlayheadTracking();
  captionEditorList.innerHTML = '';
}

export function isCaptionEditorOpen(): boolean {
  return isOpen;
}

// ---------------------------------------------------------------------------
// Build rows
// ---------------------------------------------------------------------------

function buildEditorRows(): void {
  captionEditorList.innerHTML = '';
  const groups = buildGroups(currentWords);

  groups.forEach((group, index) => {
    const row = document.createElement('div');
    row.className = 'caption-editor-row';
    row.dataset.index = String(index);

    // Timestamp button — click to seek
    const ts = document.createElement('span');
    ts.className = 'caption-editor-ts';
    ts.textContent = formatTime(group.start);
    ts.addEventListener('click', () => {
      seekCallback?.(group.start);
    });

    // Text input — auto-sizing textarea
    const input = document.createElement('textarea');
    input.className = 'caption-editor-input';
    input.rows = 1;
    input.value = group.words.map(w => w.text).join(' ');

    // Auto-resize height
    const autoResize = () => {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';
    };

    input.addEventListener('input', () => {
      autoResize();
      applyEdit(group, input.value);
    });

    // Initial sizing after DOM insertion
    requestAnimationFrame(autoResize);

    row.appendChild(ts);
    row.appendChild(input);
    captionEditorList.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Apply edits back to TranscribedWord array
// ---------------------------------------------------------------------------

function applyEdit(group: EditorGroup, newText: string): void {
  const newWords = newText.trim().split(/\s+/).filter(w => w.length > 0);
  const origWords = group.words;

  // Assign new text to existing words in order
  for (let i = 0; i < origWords.length && i < newWords.length; i++) {
    origWords[i].text = newWords[i];
  }

  // If user typed more words than original, append extras to the last word
  if (newWords.length > origWords.length) {
    const lastWord = origWords[origWords.length - 1];
    const extras = newWords.slice(origWords.length);
    lastWord.text = lastWord.text + ' ' + extras.join(' ');
  }

  // If user typed fewer words, blank out remaining (they'll be skipped in captions)
  if (newWords.length < origWords.length) {
    for (let i = newWords.length; i < origWords.length; i++) {
      origWords[i].text = '';
    }
  }

  onEditCallback?.();
}

// ---------------------------------------------------------------------------
// Playhead tracking — highlight the active subtitle row
// ---------------------------------------------------------------------------

function startPlayheadTracking(): void {
  if (playheadRafId !== null) return;

  const rows = captionEditorList.querySelectorAll('.caption-editor-row');
  const groups = buildGroups(currentWords);

  const tick = () => {
    if (!isOpen) {
      playheadRafId = null;
      return;
    }

    const t = getPlayheadTime?.() ?? 0;
    let newActive = -1;
    for (let i = 0; i < groups.length; i++) {
      if (t >= groups[i].start && t < groups[i].end) {
        newActive = i;
        break;
      }
    }

    if (newActive !== activeRowIndex) {
      if (activeRowIndex >= 0 && activeRowIndex < rows.length) {
        rows[activeRowIndex].classList.remove('active');
      }
      if (newActive >= 0 && newActive < rows.length) {
        rows[newActive].classList.add('active');
      }
      activeRowIndex = newActive;
    }

    playheadRafId = requestAnimationFrame(tick);
  };

  playheadRafId = requestAnimationFrame(tick);
}

function stopPlayheadTracking(): void {
  if (playheadRafId !== null) {
    cancelAnimationFrame(playheadRafId);
    playheadRafId = null;
  }
}

// ---------------------------------------------------------------------------
// Event listeners (attached once)
// ---------------------------------------------------------------------------

let listenersAttached = false;

export function initCaptionEditorListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;

  captionEditorClose.addEventListener('click', closeCaptionEditor);

  // Close on backdrop click
  captionEditorModal.addEventListener('click', (e) => {
    if (e.target === captionEditorModal) {
      closeCaptionEditor();
    }
  });

  // Escape key closes editor
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      e.stopPropagation();
      closeCaptionEditor();
    }
  }, true); // capture phase to beat the playback Escape handler
}
