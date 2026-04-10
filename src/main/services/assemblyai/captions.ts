import type { TranscribedWord } from './types';

/** Power words that trigger special colorization. Values are ASS BGR color codes. */
const POWER_WORDS: Record<string, string> = {
  // Horror/scary — Red
  horror: '&H0000FF&', terrifying: '&H0000FF&', scary: '&H0000FF&',
  creepy: '&H0000FF&', haunted: '&H0000FF&', nightmare: '&H0000FF&',
  death: '&H0000FF&', dead: '&H0000FF&', kill: '&H0000FF&',
  murder: '&H0000FF&', blood: '&H0000FF&', evil: '&H0000FF&',
  demon: '&H0000FF&', cursed: '&H0000FF&',
  // Unique/special — Yellow/Gold
  different: '&H00FFFF&', unique: '&H00FFFF&', special: '&H00FFFF&',
  rare: '&H00FFFF&', secret: '&H00FFFF&', hidden: '&H00FFFF&',
  exclusive: '&H00FFFF&',
  // Success/positive — Green
  win: '&H00FF00&', winning: '&H00FF00&', success: '&H00FF00&',
  amazing: '&H00FF00&', incredible: '&H00FF00&', insane: '&H00FF00&',
  perfect: '&H00FF00&', best: '&H00FF00&', top: '&H00FF00&',
  // Market/trend — Orange
  saturated: '&H0080FF&', trending: '&H0080FF&', viral: '&H0080FF&',
  exploding: '&H0080FF&', blowing: '&H0080FF&', massive: '&H0080FF&',
  huge: '&H0080FF&',
  // Money — Gold
  money: '&H00D4FF&', million: '&H00D4FF&', billion: '&H00D4FF&',
  rich: '&H00D4FF&', wealth: '&H00D4FF&', cash: '&H00D4FF&',
  profit: '&H00D4FF&',
  // Warning/danger — Orange-Red
  warning: '&H0066FF&', danger: '&H0066FF&', careful: '&H0066FF&',
  never: '&H0066FF&', stop: '&H0066FF&', "don't": '&H0066FF&',
  // Emphasis — Cyan
  now: '&HFFFF00&', today: '&HFFFF00&', immediately: '&HFFFF00&',
  urgent: '&HFFFF00&', breaking: '&HFFFF00&', just: '&HFFFF00&',
};

export interface CaptionStyle {
  font: string;
  size: number;
  color: string;       // ASS primary color (BGR)
  outlineColor: string;
  shadowColor: string;
  bold: boolean;
  italic: boolean;
  outlineWidth: number;
  shadowDepth: number;
  alignment: number;   // ASS numpad alignment (5 = center, 2 = bottom-center)
  marginV: number;
}

export type CaptionAnimation = 'none' | 'pop' | 'bounce' | 'slide-up';

export interface CaptionOptions {
  style?: Partial<CaptionStyle>;
  position?: 'center' | 'bottom' | 'top';
  fontSize?: number;
  powerWords?: Record<string, string>;
  maxWordsPerGroup?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  resolution?: { width: number; height: number };
  /** When set, each dialogue line gets a \pos(x,y) override for precise positioning */
  posOverride?: { x: number; y: number };
  /** Highlight color for active word (ASS BGR format &HBBGGRR&). When set, emits per-word Dialogue lines. */
  highlightColor?: string;
  /** Entrance animation for each caption group */
  animation?: CaptionAnimation;
}

const DEFAULT_STYLE: CaptionStyle = {
  font: 'Arial',
  size: 72,
  color: '&HFFFFFF&',
  outlineColor: '&H000000&',
  shadowColor: '&H80000000&',
  bold: true,
  italic: false,
  outlineWidth: 4,
  shadowDepth: 2,
  alignment: 5,
  marginV: 400,
};

interface WordGroup {
  words: TranscribedWord[];
  start: number;
  end: number;
  text: string;
}

/** Convert seconds to ASS time format (H:MM:SS.cc) */
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const cs = Math.floor((s % 1) * 100);
  const si = Math.floor(s);
  return `${h}:${m.toString().padStart(2, '0')}:${si.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

/**
 * Build ASS override tags for entrance animations.
 * Returns the tag string to prepend to dialogue text (e.g. scale/move transitions).
 */
function buildAnimationTag(
  animation: CaptionAnimation,
  posOverride?: { x: number; y: number },
): string {
  switch (animation) {
    case 'pop':
      // Scale from 60% to 100% over 150ms
      return '{\\fscx60\\fscy60\\t(0,150,\\fscx100\\fscy100)}';
    case 'bounce':
      // Scale from 40% → overshoot to 115% → settle at 100%
      return '{\\fscx40\\fscy40\\t(0,120,\\fscx115\\fscy115)\\t(120,220,\\fscx100\\fscy100)}';
    case 'slide-up':
      // Slide up from below. With \pos we can use \move; without, fall back to a pop.
      if (posOverride) {
        const slideOffset = 60;
        return `{\\move(${posOverride.x},${posOverride.y + slideOffset},${posOverride.x},${posOverride.y},0,180)}`;
      }
      // Fallback: pop entrance when position isn't known
      return '{\\fscx70\\fscy70\\t(0,180,\\fscx100\\fscy100)}';
    default:
      return '';
  }
}

/** Clean a word for power-word matching (strip punctuation, lowercase). */
function cleanWord(text: string): string {
  return text.toLowerCase().replace(/[^\w]/g, '');
}

/** Colorize a single word if it matches a power word. */
function colorizeWord(
  word: string,
  powerWords: Record<string, string>,
): string {
  const cleaned = cleanWord(word);
  const color = powerWords[cleaned];
  if (color) {
    return `{\\c${color}}${word.toUpperCase()}{\\c&HFFFFFF&}`;
  }
  return word;
}

/** Group words into display chunks (max N words, break at punctuation). */
export function groupWords(
  words: TranscribedWord[],
  maxWords: number,
): WordGroup[] {
  if (words.length === 0) return [];

  const groups: WordGroup[] = [];
  let current: TranscribedWord[] = [];

  for (const word of words) {
    current.push(word);

    let shouldBreak = false;

    if (current.length >= maxWords) {
      shouldBreak = true;
    }

    // Break at punctuation
    const lastChar = word.text.slice(-1);
    if ('.!?,;:'.includes(lastChar)) {
      shouldBreak = true;
    }

    if (shouldBreak) {
      groups.push({
        words: [...current],
        start: current[0].start,
        end: current[current.length - 1].end,
        text: current.map((w) => w.text).join(' '),
      });
      current = [];
    }
  }

  // Remaining words
  if (current.length > 0) {
    groups.push({
      words: [...current],
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((w) => w.text).join(' '),
    });
  }

  return groups;
}

/**
 * Generate ASS (Advanced SubStation Alpha) subtitle content from transcribed words.
 *
 * Supports power-word colorization, fade effects, word grouping,
 * and both landscape (1920×1080) and vertical (1080×1920) resolutions.
 */
export function generateASS(
  words: TranscribedWord[],
  options: CaptionOptions = {},
): string {
  const {
    position = 'center',
    fontSize,
    powerWords: extraPowerWords,
    maxWordsPerGroup = 4,
    fadeInMs = 80,
    fadeOutMs = 40,
    resolution = { width: 1080, height: 1920 },
  } = options;

  // Merge style overrides
  const style: CaptionStyle = { ...DEFAULT_STYLE, ...options.style };

  if (fontSize) {
    style.size = fontSize;
  }

  // Set alignment based on position
  switch (position) {
    case 'top':
      style.alignment = 8; // top-center
      break;
    case 'bottom':
      style.alignment = 2; // bottom-center
      break;
    case 'center':
    default:
      style.alignment = 5; // center
      break;
  }

  // Adjust marginV for landscape
  if (resolution.width > resolution.height) {
    // Landscape 1920×1080
    style.marginV = Math.min(style.marginV, 200);
  }

  // Build power words dict
  const allPowerWords: Record<string, string> = { ...POWER_WORDS };
  if (extraPowerWords) {
    Object.assign(allPowerWords, extraPowerWords);
  }

  const bold = style.bold ? '-1' : '0';
  const italic = style.italic ? '-1' : '0';

  const header = `[Script Info]
Title: Viral Captions
ScriptType: v4.00+
PlayResX: ${resolution.width}
PlayResY: ${resolution.height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.font},${style.size},${style.color},${style.color},${style.outlineColor},${style.shadowColor},${bold},${italic},0,0,100,100,0,0,1,${style.outlineWidth},${style.shadowDepth},${style.alignment},10,10,${style.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Group words and generate dialogue lines
  const groups = groupWords(words, maxWordsPerGroup);
  const lines: string[] = [];
  const highlightColor = options.highlightColor;
  const animation = options.animation ?? 'none';

  const posTag = options.posOverride
    ? `{\\pos(${options.posOverride.x},${options.posOverride.y})}`
    : '';

  // Entrance animation tag — slide-up uses \move which replaces \pos
  const animTag = buildAnimationTag(animation, options.posOverride);
  const usesMoveTag = animation === 'slide-up' && !!options.posOverride;

  if (highlightColor) {
    // Per-word highlighting: emit one Dialogue per word's time span.
    // Each event shows the full group text, with the active word colored.
    for (const group of groups) {
      for (let wi = 0; wi < group.words.length; wi++) {
        const word = group.words[wi];
        const parts: string[] = [];

        for (let j = 0; j < group.words.length; j++) {
          const w = group.words[j];
          const text = colorizeWord(w.text, allPowerWords);
          if (j === wi) {
            // Active word — apply highlight color
            parts.push(`{\\c${highlightColor}}${text}{\\c${style.color}}`);
          } else {
            parts.push(text);
          }
        }

        const fadeTag = `{\\fad(${fadeInMs},${fadeOutMs})}`;
        // Apply entrance animation on the first word of each group
        const groupAnimTag = wi === 0 ? animTag : '';
        // slide-up \move replaces \pos; other animations stack with \pos
        const groupPosTag = (wi === 0 && usesMoveTag) ? '' : posTag;
        const text = groupPosTag + fadeTag + groupAnimTag + parts.join(' ');
        const startTime = formatTime(word.start);
        const endTime = formatTime(word.end);
        lines.push(`Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${text}`);
      }
    }
  } else {
    // Standard: one Dialogue per group
    for (const group of groups) {
      const colorized = group.words
        .map((w) => colorizeWord(w.text, allPowerWords))
        .join(' ');

      const fadeTag = `{\\fad(${fadeInMs},${fadeOutMs})}`;
      // slide-up \move replaces \pos; other animations stack with \pos
      const groupPosTag = usesMoveTag ? '' : posTag;
      const text = groupPosTag + fadeTag + animTag + colorized;

      const startTime = formatTime(group.start);
      const endTime = formatTime(group.end);
      lines.push(`Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${text}`);
    }
  }

  return header + lines.join('\n') + '\n';
}

/** Convert seconds to SRT time format (HH:MM:SS,mmm) */
function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * Generate SRT subtitle content from transcribed words.
 * Groups words the same way as ASS generation for consistency.
 */
export function generateSRT(
  words: TranscribedWord[],
  maxWordsPerGroup = 4,
): string {
  const groups = groupWords(words, maxWordsPerGroup);
  const lines: string[] = [];

  for (let i = 0; i < groups.length; i++) {
    lines.push(`${i + 1}`);
    lines.push(`${formatSRTTime(groups[i].start)} --> ${formatSRTTime(groups[i].end)}`);
    lines.push(groups[i].text);
    lines.push('');
  }

  return lines.join('\n');
}
