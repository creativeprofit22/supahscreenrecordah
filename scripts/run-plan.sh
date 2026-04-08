#!/bin/bash
set -eo pipefail

PROJECT_DIR="/mnt/e/Projects/Yaatuber"
LOG_DIR="$PROJECT_DIR/.claude/logs"
CHECK_CMD="npm run typecheck && npm run build"
FEATURE_NAME="Post-Recording Review Screen"
TOTAL_CHUNKS=12

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

START_CHUNK=1
SKIP_FINAL_CHECK=false
CLEANUP_EVERY=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --start) START_CHUNK="$2"; shift 2 ;;
    --skip-final-check) SKIP_FINAL_CHECK=true; shift ;;
    --cleanup-every) CLEANUP_EVERY="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$LOG_DIR"

echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Plan Executor - $FEATURE_NAME${NC}"
echo -e "${BLUE}  $TOTAL_CHUNKS chunks, starting from $START_CHUNK${NC}"
[[ "$CLEANUP_EVERY" -gt 0 ]] && echo -e "${BLUE}  CLAUDE.md cleanup every $CLEANUP_EVERY chunks${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════${NC}"
echo ""

PREV_CONTEXT=""
PREV_CONTEXT_STAT=""
CHUNKS_SINCE_CLEANUP=0

capture_context() {
  cd "$PROJECT_DIR"
  PREV_CONTEXT=$(git diff HEAD 2>/dev/null | head -300 || echo "")
  PREV_CONTEXT_STAT=$(git diff --stat HEAD 2>/dev/null || echo "")
}

run_quality_gate() {
  local num=$1
  local gate_log="$LOG_DIR/gate-${num}.log"

  echo -e "${CYAN}  Running quality gate...${NC}"
  cd "$PROJECT_DIR"

  if eval "$CHECK_CMD" > "$gate_log" 2>&1; then
    echo -e "${GREEN}  ✓ Quality gate passed${NC}"
    return 0
  else
    echo -e "${YELLOW}  ⚠ Quality gate failed — spawning fix pass...${NC}"
    local errors
    errors=$(cat "$gate_log")
    local fix_log="$LOG_DIR/fix-${num}.log"

    claude --dangerously-skip-permissions --max-turns 20 \
      -p "$(cat <<FIXPROMPT
Fix quality check errors in supahscreenrecordah at $PROJECT_DIR

Errors:
\`\`\`
$errors
\`\`\`

Rules:
- Read each file mentioned in the errors
- Fix errors with minimal changes — do NOT refactor or improve surrounding code
- Re-run: $CHECK_CMD
- Loop until clean
- Do NOT ask questions
FIXPROMPT
)" < /dev/null 2>&1 | tee "$fix_log"

    if eval "$CHECK_CMD" > "$gate_log" 2>&1; then
      echo -e "${GREEN}  ✓ Fix pass succeeded${NC}"
      return 0
    else
      echo -e "${RED}  ✗ Still failing after fix pass — STOPPING${NC}"
      echo -e "${RED}  Fix manually, then resume: ./scripts/run-plan.sh --start $((num + 1))${NC}"
      exit 1
    fi
  fi
}

auto_commit() {
  local num=$1
  local name=$2
  cd "$PROJECT_DIR"

  if ! git diff --quiet HEAD 2>/dev/null; then
    git add -A
    git commit -m "chunk ${num}/${TOTAL_CHUNKS}: ${name}

Auto-committed by plan executor after quality gate passed." --no-gpg-sign 2>/dev/null || true
    echo -e "${GREEN}  ✓ Auto-committed chunk $num${NC}"
  fi
}

run_cleanup() {
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}Running CLAUDE.md cleanup...${NC}"
  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 10 \
    -p "Run /minimal-claude:setup-claude-md to clean up CLAUDE.md at $PROJECT_DIR. Keep it minimal and under 150 lines. Do NOT ask questions." \
    < /dev/null 2>&1 | tee "$LOG_DIR/cleanup.log"
  echo -e "${CYAN}✓ Cleanup done${NC}"
}

# ══════════════════════════════════════════════════════
# CHUNK FUNCTIONS — one per chunk, prompt baked in as heredoc
# ══════════════════════════════════════════════════════

run_chunk_1() {
  local log="$LOG_DIR/chunk-1.log"
  echo -e "${YELLOW}▶ Chunk 1/$TOTAL_CHUNKS: Segment Model & Types${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="
### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they're in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_1_PROMPT'
[Project] supahscreenrecordah at /mnt/e/Projects/Yaatuber
Stack: TypeScript, Electron 35, tsdown (IIFE), tsc, vitest, vanilla DOM (no React)
Check: npm run typecheck && npm run build

## Research Findings

### [ADAPT] Whisper.cpp integration in Electron (from Recordly)

**Binary resolution** (Windows + macOS):
```typescript
// Bundled binaries → env var → Homebrew → PATH
function getBundledWhisperExecutableCandidates() {
  const binaryNames = process.platform === 'win32'
    ? ['whisper-cli.exe', 'whisper-cpp.exe', 'whisper.exe', 'main.exe']
    : ['whisper-cli', 'whisper-cpp', 'whisper', 'main']
  return binaryNames.map((binaryName) => getPrebundledNativeHelperPath(binaryName))
}
```

**Audio extraction** (required — whisper needs 16kHz mono WAV):
```
ffmpeg -i input.mp4 -ac 1 -ar 16000 -c:a pcm_s16le output.wav
```

**Transcription with word-level timestamps**:
```
whisper-cli -m ggml-base.bin -f audio.wav -ojf -of output_base -l en -np
```
`-ojf` = output JSON full (includes word-level tokens with ms offsets)

**JSON output format** (whisper.cpp `-ojf`):
```json
{
  "transcription": [
    {
      "text": "segment text",
      "offsets": { "from": 0, "to": 3000 },
      "tokens": [
        { "text": " Hello", "offsets": { "from": 0, "to": 1500 } },
        { "text": " world", "offsets": { "from": 1500, "to": 3000 } }
      ]
    }
  ]
}
```
Offsets in milliseconds. Tokens need whitespace-merge to form words.

**Model download**: `ggml-base.bin` (~148MB) from huggingface.

**Windows binary**: v1.8.4 from ggml-org/whisper.cpp releases.
- Windows x64 zip contains `Release/whisper-cli.exe` + DLLs (`ggml-base.dll`, `ggml-cpu.dll`, `ggml.dll`)
- ALL DLLs must be extracted alongside the exe
- macOS/Linux: `brew install whisper-cpp`

### [ADAPT] Waveform generation from audio buffer (from AFFiNE/FreeShow pattern)

```typescript
const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
const channelData = audioBuffer.getChannelData(0);
const samples = 800;
const blockSize = Math.floor(channelData.length / samples);
const waveform = new Float32Array(samples);
for (let i = 0; i < samples; i++) {
  const start = i * blockSize;
  let sum = 0;
  for (let j = 0; j < blockSize; j++) {
    sum += Math.abs(channelData[start + j]);
  }
  waveform[i] = sum / blockSize;
}
```

### [ADAPT] Snap-to-edge from OpenReel timeline

Threshold-based snapping with 5px drag deadzone. For trim handles:
- When dragging a trim handle, check distance to nearest segment edge or playhead
- If within snap threshold (e.g. 8px), jump to that edge
- Visual feedback: thin vertical line at snap target
- 5px deadzone before drag engages
- Cursor: `ew-resize` when hovering trim handle zones (6px hitbox on each segment edge)

### [REFERENCE] Review screen layout for 9:16 and 16:9

```
┌──────────────────────────────────┐
│                                  │
│         Video Preview            │
│      (plays with cuts)           │
│                                  │
├──────────────────────────────────┤
│ [Auto-trim ▾] [Undo All]        │  ← action bar
├──────────────────────────────────┤
│ ▊▊▋▊▊▊▊░░░▊▊▊▊▊▋▊░░▊▊▊▊▊▊     │  ← waveform with silence regions
│ ─────────●───────────────────    │  ← playhead scrubber
├──────────────────────────────────┤
│ [Skip]   [Exit]        [Export]  │  ← bottom actions
└──────────────────────────────────┘
```

### [ADAPT] Export pipeline bypass for pre-computed segments

For review screen export, bypass transcription+detection and feed pre-computed keep-segments directly:
```
exportWithReviewSegments(videoPath, keepSegments: {start, end}[])
  → cutSilenceRegions(videoPath, keepSegments)  ← reuse existing FFmpeg logic
  → postProcessRecording(videoPath)             ← existing audio enhancement
```
The key function to reuse is `cutSilenceRegions(videoPath, keepSegments)` from `src/main/services/ffmpeg/silence-cut.ts`.

### Gotchas
1. whisper.cpp Windows binary requires DLLs alongside exe
2. Audio extraction before whisper — whisper.cpp only accepts WAV
3. IPC buffer size — extract audio to temp file, process in main process
4. Canvas timeline in existing playback container — expand without breaking existing layout
5. Segment toggle must be non-destructive — segments toggled on/off, never deleted
6. Export must bypass AssemblyAI — call cutSilenceRegions() directly

## Chunk 1/12: Segment Model & Types

Depends on: None

**Read these files first** (do NOT explore beyond this list):
- `src/main/services/assemblyai/types.ts` — existing TranscribedWord, SilenceRegion types to align with
- `src/shared/feature-types.ts` — existing SilenceRemovalConfig, CaptionConfig
- `src/shared/types.ts` — existing PauseTimestamp, MainAPI, channel patterns

**Create:**
- `src/shared/review-types.ts` — segment model, review state types, waveform data type

**Modify:**
- None

**What to Build:**
Define the core data model for the review screen. `ReviewSegment` type with `{id, start, end, type: 'silence'|'filler'|'speech', enabled: boolean}`. `ReviewState` with segments array, waveform data, transcribed words, duration, playhead position. `WaveformData` as `{samples: number[], duration: number}` (plain number array for IPC serialization — Float32Array doesn't survive structured clone). `ReviewAnalysisResult` as the IPC return type: `{waveform: WaveformData, segments: ReviewSegment[], words: TranscribedWord[]}`.

**Code to Adapt:**
Align `ReviewSegment` with existing `SilenceRegion` (same `start`/`end` seconds format). Add `enabled` boolean and `id` string for toggle tracking.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run build
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run build` passes. `ReviewSegment`, `ReviewState`, `WaveformData`, `ReviewAnalysisResult` types are importable from `src/shared/review-types.ts`.
CHUNK_1_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_2() {
  local log="$LOG_DIR/chunk-2.log"
  echo -e "${YELLOW}▶ Chunk 2/$TOTAL_CHUNKS: Whisper Binary Download & Detection${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="
### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they're in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_2_PROMPT'
[Project] supahscreenrecordah at /mnt/e/Projects/Yaatuber
Stack: TypeScript, Electron 35, tsdown (IIFE), tsc, vitest, vanilla DOM (no React)
Check: npm run typecheck && npm run build

## Research Findings

### [ADAPT] Whisper.cpp integration in Electron (from Recordly)

**Binary resolution** (Windows + macOS):
```typescript
function getBundledWhisperExecutableCandidates() {
  const binaryNames = process.platform === 'win32'
    ? ['whisper-cli.exe', 'whisper-cpp.exe', 'whisper.exe', 'main.exe']
    : ['whisper-cli', 'whisper-cpp', 'whisper', 'main']
  return binaryNames.map((binaryName) => getPrebundledNativeHelperPath(binaryName))
}
```

**Windows binary**: v1.8.4 from ggml-org/whisper.cpp releases.
- Windows x64: `https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip`
  - Zip contains `Release/whisper-cli.exe` + DLLs (`ggml-base.dll`, `ggml-cpu.dll`, `ggml.dll`)
  - ALL DLLs must be extracted alongside the exe
- macOS/Linux: `brew install whisper-cpp` → `/opt/homebrew/bin/whisper-cli`

**Model download**: `ggml-base.bin` (~148MB) from `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin`

### Gotchas
1. whisper.cpp Windows binary requires DLLs alongside exe — ALL must be extracted to same dir

## Chunk 2/12: Whisper Binary Download & Detection

Depends on: None

**Read these files first** (do NOT explore beyond this list):
- `src/main/services/dependencies.ts` — existing FFmpeg download/detect pattern to mirror exactly (findFfmpeg, installFfmpeg, downloadFile, extractFfmpegFromZip)

**Create:**
- `src/main/services/whisper.ts` — findWhisper(), findWhisperModel(), installWhisper(), installWhisperModel()

**Modify:**
- None (IPC handlers wired in chunk 7)

**What to Build:**
Mirror the FFmpeg download pattern for whisper.cpp.

`findWhisper()`: Check `<userData>/bin/whisper-cli.exe` (win32) or `<userData>/bin/whisper-cli` (darwin/linux). Then check Homebrew paths (`/opt/homebrew/bin/whisper-cli`). Then check PATH via `which`/`where`. Return path or null.

`findWhisperModel()`: Check `<userData>/whisper/ggml-base.bin`. Return path or null.

`installWhisper(onProgress)`: Download platform zip:
- Windows: `https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip` → extract `Release/whisper-cli.exe` + ALL `Release/*.dll` to `<userData>/bin/`
- macOS/Linux: Log instruction to `brew install whisper-cpp` (no auto-download)

`installWhisperModel(onProgress)`: Download `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin` to `<userData>/whisper/ggml-base.bin` with progress callback. Use existing `downloadFile` helper from dependencies.ts.

**Code to Adapt:**
[ADAPT] Mirror `src/main/services/dependencies.ts` structure exactly: same downloadFile helper, same extractFromZip pattern, same progress callback signature `(progress: InstallProgress) => void`.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run build
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run build` passes. `findWhisper()` returns null when binary not installed. `findWhisperModel()` returns null when model not present.
CHUNK_2_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_3() {
  local log="$LOG_DIR/chunk-3.log"
  echo -e "${YELLOW}▶ Chunk 3/$TOTAL_CHUNKS: Whisper Transcription Service${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="
### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they're in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_3_PROMPT'
[Project] supahscreenrecordah at /mnt/e/Projects/Yaatuber
Stack: TypeScript, Electron 35, tsdown (IIFE), tsc, vitest, vanilla DOM (no React)
Check: npm run typecheck && npm run build

## Research Findings

### [ADAPT] Whisper.cpp integration in Electron (from Recordly)

**Audio extraction** (required — whisper needs 16kHz mono WAV):
```
ffmpeg -i input.mp4 -ac 1 -ar 16000 -c:a pcm_s16le output.wav
```

**Transcription with word-level timestamps**:
```
whisper-cli -m ggml-base.bin -f audio.wav -ojf -of output_base -l en -np
```
`-ojf` = output JSON full (includes word-level tokens with ms offsets)

**JSON output format** (whisper.cpp `-ojf`):
```json
{
  "transcription": [
    {
      "text": "segment text",
      "offsets": { "from": 0, "to": 3000 },
      "tokens": [
        { "text": " Hello", "offsets": { "from": 0, "to": 1500 } },
        { "text": " world", "offsets": { "from": 1500, "to": 3000 } }
      ]
    }
  ]
}
```
Offsets in milliseconds. Tokens need whitespace-merge to form words.

### Gotchas
2. Audio extraction before whisper — whisper.cpp only accepts WAV. Must extract via FFmpeg first.

## Chunk 3/12: Whisper Transcription Service

Depends on: Chunk 2 (for findWhisper, findWhisperModel)

**Read these files first** (do NOT explore beyond this list):
- `src/main/services/whisper.ts` — binary/model paths from chunk 2
- `src/main/services/assemblyai/types.ts` — TranscribedWord type to output
- `src/main/services/dependencies.ts` — findFfmpeg for audio extraction
- `src/main/services/ffmpeg/encode.ts` — FFMPEG_EXEC_OPTIONS pattern

**Create:**
- `src/main/services/whisper-transcribe.ts` — transcribeWithWhisper() function

**Modify:**
- None

**What to Build:**
`transcribeWithWhisper(videoPath: string): Promise<TranscribedWord[]>`.

Steps:
1. Find whisper binary and model via `findWhisper()` + `findWhisperModel()`. If either missing, return `[]` with console warning.
2. Find FFmpeg via `findFfmpeg()`. If missing, return `[]`.
3. Extract audio: `ffmpeg -i videoPath -ac 1 -ar 16000 -c:a pcm_s16le -y tempWav`
4. Run whisper: `whisper-cli -m modelPath -f tempWav -ojf -of tempOutputBase -l en -np`
5. Read `tempOutputBase.json`, parse the whisper JSON format:
   - Iterate `transcription[]` segments → iterate `tokens[]`
   - Merge tokens: tokens starting with space = new word, others append to current word
   - Convert `offsets.from/to` from ms to seconds
   - Set `confidence: 1.0` (whisper.cpp doesn't output per-word confidence in `-ojf`)
6. Clean up temp files (wav, json)
7. Return `TranscribedWord[]`

**Code to Adapt:**
[ADAPT] Recordly's token-merge logic: tokens with leading space start a new word. Consecutive tokens without space are part of the same word. Offsets merge: first token's `from` → word start, last token's `to` → word end.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run build
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run build` passes. `transcribeWithWhisper` returns `TranscribedWord[]` matching the existing type shape. Function compiles and handles missing binary gracefully (returns empty array, no throw).
CHUNK_3_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_4() {
  local log="$LOG_DIR/chunk-4.log"
  echo -e "${YELLOW}▶ Chunk 4/$TOTAL_CHUNKS: Audio Waveform Extraction${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="
### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they're in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_4_PROMPT'
[Project] supahscreenrecordah at /mnt/e/Projects/Yaatuber
Stack: TypeScript, Electron 35, tsdown (IIFE), tsc, vitest, vanilla DOM (no React)
Check: npm run typecheck && npm run build

## Research Findings

### [ADAPT] Waveform generation from audio buffer (from AFFiNE/FreeShow pattern)

```typescript
const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
const channelData = audioBuffer.getChannelData(0);
const samples = 800;
const blockSize = Math.floor(channelData.length / samples);
const waveform = new Float32Array(samples);
for (let i = 0; i < samples; i++) {
  const start = i * blockSize;
  let sum = 0;
  for (let j = 0; j < blockSize; j++) {
    sum += Math.abs(channelData[start + j]);
  }
  waveform[i] = sum / blockSize;
}
```
Standard pattern: decodeAudioData → getChannelData(0) → RMS per block → Float32Array.
But for Node.js main process: use raw PCM extraction via FFmpeg, then Float32Array from Buffer.

## Chunk 4/12: Audio Waveform Extraction

Depends on: Chunk 1 (for WaveformData type)

**Read these files first** (do NOT explore beyond this list):
- `src/main/services/dependencies.ts` — findFfmpeg
- `src/main/services/ffmpeg/encode.ts` — FFMPEG_EXEC_OPTIONS pattern
- `src/shared/review-types.ts` — WaveformData type from chunk 1

**Create:**
- `src/main/services/waveform.ts` — extractWaveform() in main process

**Modify:**
- None

**What to Build:**
`extractWaveform(videoPath: string, samples?: number): Promise<WaveformData>`.

Steps:
1. Find FFmpeg. If missing, return empty waveform.
2. Extract raw PCM: `ffmpeg -i videoPath -ac 1 -ar 8000 -f f32le -y tempPcm`
3. Read the binary file into a Buffer.
4. Interpret as Float32Array: `new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)`
5. Get duration: `buffer.byteLength / 4 / 8000` (samples / sampleRate)
6. Downsample to `samples` (default 800) points: for each block, compute RMS average of absolute values.
7. Convert Float32Array to plain `number[]` for IPC serialization.
8. Clean up temp PCM file.
9. Return `{samples: number[], duration: number}`.

**Code to Adapt:**
[ADAPT] AFFiNE/FreeShow waveform pattern: `blockSize = floor(totalSamples / targetSamples)`, RMS average per block. But operate on Node.js Buffer + Float32Array instead of Web Audio AudioBuffer.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run build
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run build` passes. `extractWaveform` returns a `WaveformData` with `samples.length === 800` and a valid `duration > 0`. Handles missing FFmpeg gracefully.
CHUNK_4_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_5() {
  local log="$LOG_DIR/chunk-5.log"
  echo -e "${YELLOW}▶ Chunk 5/$TOTAL_CHUNKS: Review Screen HTML + CSS Layout${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="
### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they're in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_5_PROMPT'
[Project] supahscreenrecordah at /mnt/e/Projects/Yaatuber
Stack: TypeScript, Electron 35, tsdown (IIFE), tsc, vitest, vanilla DOM (no React)
Check: npm run typecheck && npm run build

## Research Findings

### [REFERENCE] Review screen layout for 9:16 and 16:9

```
┌──────────────────────────────────┐
│                                  │
│         Video Preview            │
│      (plays with cuts)           │
│                                  │
├──────────────────────────────────┤
│ [Auto-trim ▾] [Undo All]        │  ← action bar
├──────────────────────────────────┤
│ ▊▊▋▊▊▊▊░░░▊▊▊▊▊▋▊░░▊▊▊▊▊▊     │  ← waveform with silence regions
│ ─────────●───────────────────    │  ← playhead scrubber
├──────────────────────────────────┤
│ [Skip]   [Exit]        [Export]  │  ← bottom actions
└──────────────────────────────────┘
```

- Silence regions = dimmed/striped overlays on waveform
- Filler regions = orange-tinted overlays
- Click a region to toggle enable/disable (keep/cut)
- Drag edges of regions to fine-tune (with snap)
- Playhead scrubs video + waveform in sync

## Chunk 5/12: Review Screen HTML + CSS Layout

Depends on: Chunk 1 (for types awareness)

**Read these files first** (do NOT explore beyond this list):
- `pages/index.html` — existing playback-container structure (lines 56-63)
- `src/renderer/styles/main.css` — existing `.playback-*` styles (lines 656-700)
- `src/renderer/main/dom.ts` — existing DOM refs to extend

**Create:**
- None

**Modify:**
- `pages/index.html` — expand playback container with timeline elements
- `src/renderer/styles/main.css` — add review screen styles
- `src/renderer/main/dom.ts` — add DOM refs for new elements

**What to Build:**
Expand the playback container from a simple video+buttons into the full review screen layout.

**Expected Layout:**
```
┌──────────────────────────────────────┐
│                                      │
│         #playback-video              │
│     (existing video element,         │
│      flex: 1, object-fit: contain)   │
│                                      │
├──────────────────────────────────────┤
│ #review-actions-bar                  │
│  [Auto-trim ▾]  [Undo All]          │
│  height: 40px, bg: var(--surface)    │
├──────────────────────────────────────┤
│ #review-timeline                     │
│ ┌──────────────────────────────────┐ │
│ │ #timeline-canvas                 │ │
│ │  80px height, full width         │ │
│ │  bg: var(--bg)                   │ │
│ └──────────────────────────────────┘ │
├──────────────────────────────────────┤
│ .playback-actions                    │
│  [Skip] [Exit]            [Export]   │
│  height: 56px                        │
└──────────────────────────────────────┘
```

Button styles:
- Auto-trim: `var(--blue)` background, dropdown arrow
- Undo All: `var(--overlay)` background, subtle
- Skip: `var(--overlay)` background
- Exit: existing style
- Export: existing style (`var(--green)`)

The review-actions-bar and review-timeline start with `display: none` and are shown when analysis completes (chunk 7 handles this).

**Code to Adapt:**
Follow existing `.playback-container` flex column pattern. Use Catppuccin vars: `var(--surface)`, `var(--overlay)`, `var(--text)`, `var(--blue)`, `var(--green)`.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- For ASCII mockups in "Expected Layout": the layout MUST match the mockup. Element order, hierarchy, and spacing as shown. This is not a suggestion.
- After implementing: npm run typecheck && npm run build
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run build` passes. New HTML elements exist in DOM. CSS renders the layout without breaking existing preview/recording views (playback container is `display:none` via `.hidden` class when not active). Action bar and timeline are hidden by default.
CHUNK_5_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_6() {
  local log="$LOG_DIR/chunk-6.log"
  echo -e "${YELLOW}▶ Chunk 6/$TOTAL_CHUNKS: Timeline Canvas Renderer${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="
### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they're in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_6_PROMPT'
[Project] supahscreenrecordah at /mnt/e/Projects/Yaatuber
Stack: TypeScript, Electron 35, tsdown (IIFE), tsc, vitest, vanilla DOM (no React)
Check: npm run typecheck && npm run build

## Research Findings

### [ADAPT] Waveform rendering pattern

Mirror-bar rendering: bars above+below center line. Gradient: cyan #89dceb → teal #94e2d5.

Segment overlay colors:
- Silence: `rgba(0, 0, 0, 0.5)` overlay. If disabled (will be cut): `rgba(243, 139, 168, 0.3)` red tint + diagonal stripe pattern
- Filler: `rgba(249, 226, 175, 0.25)` yellow tint. If disabled: same red tint + stripe

## Chunk 6/12: Timeline Canvas Renderer

Depends on: Chunk 1 (types), Chunk 5 (DOM elements)

**Read these files first** (do NOT explore beyond this list):
- `src/renderer/main/dom.ts` — timeline canvas element ref
- `src/shared/review-types.ts` — ReviewSegment, WaveformData types
- `src/renderer/main/overlays/waveform.ts` — existing waveform drawing patterns (gradient, glow)

**Create:**
- `src/renderer/main/review/timeline-renderer.ts` — canvas rendering for waveform + segments + playhead

**Modify:**
- None

**What to Build:**
`renderTimeline(ctx, width, height, state)` where state has `{waveform, segments, playhead, duration, hoverSegmentId, hoverEdge}`.

Layers drawn bottom-to-top:
1. **Background**: solid `#1e1e2e` (var --bg)
2. **Waveform bars**: vertical bars from samples array. Bar width = `width / samples.length`. Height = `sample * (height - 16)`. Color: linear gradient cyan `#89dceb` → teal `#94e2d5`. Mirror bars above and below center line.
3. **Segment overlays**: For each segment where `type !== 'speech'`:
   - Silence: `rgba(0, 0, 0, 0.5)` overlay. If `!enabled` (will be cut): `rgba(243, 139, 168, 0.3)` red tint + diagonal stripe pattern (45deg, 4px spacing)
   - Filler: `rgba(249, 226, 175, 0.25)` yellow tint. If `!enabled`: same red tint + stripe
4. **Trim handles**: 3px-wide vertical bars at segment edges, color `var(--text)` with 50% opacity. On hover: full opacity + 6px wide.
5. **Playhead**: 2px white vertical line at `(playhead / duration) * width`. Small triangle at top.
6. **Time label**: Current time `MM:SS` near playhead, small font.

All pure canvas 2D. Helper: `timeToX(time) = (time / duration) * width`, `xToTime(x) = (x / width) * duration`.

**Code to Adapt:**
[ADAPT] Existing waveform gradient from `waveform.ts` lines 76-82 (createLinearGradient with cyan stops). Mirror-bar rendering (bars above+below center).

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run build
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run build` passes. `renderTimeline` accepts documented parameters. Calling it with mock data (empty waveform, no segments) draws background + playhead without errors.
CHUNK_6_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_7() {
  local log="$LOG_DIR/chunk-7.log"
  echo -e "${YELLOW}▶ Chunk 7/$TOTAL_CHUNKS: Review Screen Controller${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="
### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they're in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_7_PROMPT'
[Project] supahscreenrecordah at /mnt/e/Projects/Yaatuber
Stack: TypeScript, Electron 35, tsdown (IIFE), tsc, vitest, vanilla DOM (no React)
Check: npm run typecheck && npm run build

## Research Findings

### [ADAPT] Export pipeline bypass for pre-computed segments
For review screen export, bypass transcription+detection and feed pre-computed keep-segments directly. The key function to reuse is `cutSilenceRegions(videoPath, keepSegments)` from `src/main/services/ffmpeg/silence-cut.ts`.

### Gotchas
- IPC buffer size — extract audio to temp file, process in main process
- The remuxed file path is currently only in main process. The analyzeForReview IPC can access it there. Pass the path from preparePlayback by storing it in a module-level variable.

## Chunk 7/12: Review Screen Controller (Wire Everything Together)

Depends on: Chunk 1 (types), Chunk 3 (whisper), Chunk 4 (waveform), Chunk 5 (DOM), Chunk 6 (renderer)

**Read these files first** (do NOT explore beyond this list):
- `src/renderer/main/playback.ts` — existing enterPlaybackMode flow to extend
- `src/renderer/main/dom.ts` — all review DOM refs
- `src/main/ipc/playback.ts` — existing prepare playback handler
- `src/shared/channels.ts` — channel naming pattern
- `src/preload/main-preload.ts` — IPC bridge pattern
- `src/main/services/assemblyai/silence.ts` — detectSilences, detectFillers functions

**Create:**
- `src/renderer/main/review/review-controller.ts` — orchestrates the review screen state + render loop
- `src/main/ipc/review.ts` — IPC handler: runs whisper + waveform extraction + silence detection

**Modify:**
- `src/renderer/main/playback.ts` — after video loads, call `initReview()` to start analysis
- `src/shared/channels.ts` — add `REVIEW_ANALYZE: 'review:analyze'`
- `src/shared/types.ts` — add `analyzeForReview: (videoPath: string) => Promise<ReviewAnalysisResult>` to MainAPI
- `src/preload/main-preload.ts` — wire `analyzeForReview` IPC bridge
- `src/main/ipc/index.ts` — register review handlers

**What to Build:**

**Main process (`review.ts`):**
IPC handler for `REVIEW_ANALYZE`:
1. Receives the temp video path (already on disk from `preparePlayback`)
2. Runs in parallel: `extractWaveform(videoPath)` + `transcribeWithWhisper(videoPath)`
3. After whisper: run `detectSilences(words, 1500, 150)` + `detectFillers(words)` from existing silence.ts
4. Convert `SilenceRegion[]` → `ReviewSegment[]` (add id, enabled=true, type from reason)
5. Also create speech segments for the gaps between silence/filler regions
6. Return `ReviewAnalysisResult` to renderer

**Renderer (`review-controller.ts`):**
- `initReview()`: called after video loads in playback.ts. Shows "Analyzing audio..." in processing overlay. Calls `analyzeForReview` IPC. On response: stores state, shows action bar + timeline, starts render loop.
- `renderLoop()`: rAF loop that calls `renderTimeline()` with current state. Syncs playhead from `playbackVideo.currentTime`.
- `getReviewSegments()`: returns current segment state (for export).
- `destroyReview()`: cleanup on exit.

**Code to Adapt:**
[ADAPT] Existing `enterPlaybackMode` flow — extend by calling `initReview()` after the video src is set and processing overlay hides. Use the existing `playbackTempFile` path for analysis.

**Important**: The remuxed file path is currently only in main process (`playbackTempFile` in playback.ts IPC). The `analyzeForReview` IPC can access it there. Pass the path from the `preparePlayback` handler by storing it in a module-level variable that `analyzeForReview` reads.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run build
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run build` passes. IPC channel `REVIEW_ANALYZE` registered. After recording stops and video loads, the processing overlay shows "Analyzing audio...", then the timeline appears with waveform data. Video playhead syncs with timeline playhead. If whisper is not installed, timeline shows waveform only (no segments).
CHUNK_7_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_8() {
  local log="$LOG_DIR/chunk-8.log"
  echo -e "${YELLOW}▶ Chunk 8/$TOTAL_CHUNKS: Timeline Interaction${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="
### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they're in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_8_PROMPT'
[Project] supahscreenrecordah at /mnt/e/Projects/Yaatuber
Stack: TypeScript, Electron 35, tsdown (IIFE), tsc, vitest, vanilla DOM (no React)
Check: npm run typecheck && npm run build

## Research Findings

### [ADAPT] Snap-to-edge from OpenReel timeline

Threshold-based snapping with 5px drag deadzone. For trim handles:
- When dragging a trim handle, check distance to nearest segment edge or playhead
- If within snap threshold (e.g. 8px), jump to that edge
- Visual feedback: thin vertical line at snap target
- 5px deadzone before drag engages (prevents accidental drags when clicking to toggle)
- Cursor: `ew-resize` when hovering trim handle zones (6px hitbox on each segment edge)

## Chunk 8/12: Timeline Interaction (Playhead Scrub + Segment Toggle)

Depends on: Chunk 6 (renderer), Chunk 7 (controller)

**Read these files first** (do NOT explore beyond this list):
- `src/renderer/main/review/timeline-renderer.ts` — rendering to extend with hover states
- `src/renderer/main/review/review-controller.ts` — state management
- `src/renderer/main/dom.ts` — timeline canvas ref

**Create:**
- `src/renderer/main/review/timeline-interaction.ts` — mouse event handlers for timeline

**Modify:**
- `src/renderer/main/review/review-controller.ts` — wire interaction handlers, expose segment toggle
- `src/renderer/main/review/timeline-renderer.ts` — add hover segment highlighting

**What to Build:**
Mouse interaction on the timeline canvas via mousedown/mousemove/mouseup/mouseleave:

**Hit testing** (on every mousemove):
- Convert `event.offsetX` → time via `xToTime()`
- Find segment under cursor: `segments.find(s => time >= s.start && time <= s.end && s.type !== 'speech')`
- Check if cursor is near a segment edge (within 6px): set `hoverEdge: 'start' | 'end' | null`
- Check if cursor is near playhead (within 6px): set `hoverPlayhead: true`
- Update cursor style: `ew-resize` for edges, `col-resize` for playhead, `pointer` for segment body, `default` otherwise

**Interactions:**
1. **Click on waveform** (no segment hit): seek video to clicked time via `playbackVideo.currentTime = time`
2. **Click on segment body** (not edge): toggle `segment.enabled` (flip boolean). Visual feedback immediate via re-render.
3. **Drag playhead**: mousedown on playhead → track mousemove → update `playbackVideo.currentTime` continuously → mouseup ends drag.
4. **5px drag threshold**: on mousedown, record start position. Don't engage drag until mouse moves 5px. If under threshold and mouseup fires, treat as click (toggle or seek).

**Code to Adapt:**
[REFERENCE] OpenReel's 5px drag threshold + cursor change pattern.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run build
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run build` passes. Clicking waveform area seeks the video. Clicking a silence/filler segment toggles its `enabled` state (visible color change on timeline). Dragging near the playhead scrubs the video. Cursor changes appropriately on hover.
CHUNK_8_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_9() {
  local log="$LOG_DIR/chunk-9.log"
  echo -e "${YELLOW}▶ Chunk 9/$TOTAL_CHUNKS: Trim Handle Dragging with Snap${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="
### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they're in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_9_PROMPT'
[Project] supahscreenrecordah at /mnt/e/Projects/Yaatuber
Stack: TypeScript, Electron 35, tsdown (IIFE), tsc, vitest, vanilla DOM (no React)
Check: npm run typecheck && npm run build

## Research Findings

### [ADAPT] Snap-to-edge from OpenReel timeline

Key insight: threshold-based snapping with 5px drag deadzone. For trim handles:
- When dragging a trim handle, check distance to nearest segment edge or playhead
- If within snap threshold (e.g. 8px), jump to that edge
- Visual feedback: thin vertical line at snap target
- Snap threshold in time: `const snapPx = 8; const snapTime = snapPx / (width / duration);`
- Check all segment edges + playhead, find closest within threshold

## Chunk 9/12: Trim Handle Dragging with Snap

Depends on: Chunk 8 (interaction foundation)

**Read these files first** (do NOT explore beyond this list):
- `src/renderer/main/review/timeline-interaction.ts` — mouse handlers to extend
- `src/renderer/main/review/review-controller.ts` — segment state
- `src/renderer/main/review/timeline-renderer.ts` — trim handle rendering

**Create:**
- None

**Modify:**
- `src/renderer/main/review/timeline-interaction.ts` — add edge drag handling with snap
- `src/renderer/main/review/timeline-renderer.ts` — add snap indicator line + active handle highlight
- `src/renderer/main/review/review-controller.ts` — add segment resize function

**What to Build:**
Extend the interaction system with trim handle dragging:

1. **Drag start**: When mousedown hits a segment edge (within 6px), enter edge-drag mode. Record which segment and which edge (`start` or `end`).
2. **Drag move**: Convert mouse X to time. Clamp: start edge can't go below previous segment's end, end edge can't go above next segment's start. Minimum segment width: 0.1s.
3. **Snap logic**: Check proximity to other segment edges and to the playhead position. If within 8px (in screen coordinates), snap to that time. Draw a thin cyan vertical line at the snap target.
4. **Drag end**: Commit the new edge time to the segment. Adjust adjacent speech segment accordingly (speech segments fill gaps between silence/filler segments — they auto-resize).
5. **Visual feedback during drag**: Active handle drawn at 6px width, full opacity. Snap line drawn as 1px dashed cyan.

**Code to Adapt:**
[ADAPT] OpenReel snap threshold pattern: `const snapPx = 8; const snapTime = snapPx / (width / duration);` Check all segment edges + playhead, find closest within threshold.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run build
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run build` passes. Dragging a segment edge resizes it. Adjacent segments auto-adjust. Snap indicator appears when near another edge. Segment can't be dragged smaller than 0.1s or past its neighbors.
CHUNK_9_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_10() {
  local log="$LOG_DIR/chunk-10.log"
  echo -e "${YELLOW}▶ Chunk 10/$TOTAL_CHUNKS: Bulk Actions & Preview Playback with Cuts${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="
### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they're in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_10_PROMPT'
[Project] supahscreenrecordah at /mnt/e/Projects/Yaatuber
Stack: TypeScript, Electron 35, tsdown (IIFE), tsc, vitest, vanilla DOM (no React)
Check: npm run typecheck && npm run build

## Chunk 10/12: Bulk Actions & Preview Playback with Cuts

Depends on: Chunk 7 (controller), Chunk 8 (interaction)

**Read these files first** (do NOT explore beyond this list):
- `src/renderer/main/review/review-controller.ts` — state + segment management
- `src/renderer/main/dom.ts` — action bar button refs
- `src/main/services/assemblyai/silence.ts` — existing `buildCutSegments` for reference

**Create:**
- None

**Modify:**
- `src/renderer/main/review/review-controller.ts` — add bulk actions + preview playback logic
- `src/renderer/main/playback.ts` — wire auto-trim dropdown and undo button click handlers

**What to Build:**

**Bulk actions** (auto-trim dropdown):
- "Remove silences > 2s": disable all silence segments longer than 2s
- "Remove silences > 3s": disable all silence segments longer than 3s
- "Remove silences > 5s": disable all silence segments longer than 5s
- "Remove all fillers": disable all filler segments
- "Remove silences + fillers": disable all non-speech segments

Dropdown implemented as a native `<select>` or a simple CSS dropdown menu. Each option calls a function that batch-sets `enabled = false` on matching segments.

**Undo All**: re-enable all segments (`segment.enabled = true` for all).

**Preview playback with cuts**:
- Hook into `playbackVideo.ontimeupdate`
- On each update, check if current time falls inside a disabled segment
- If yes: seek to the end of that disabled segment (`playbackVideo.currentTime = segment.end`)
- This creates a seamless skip effect during playback

**Code to Adapt:**
Bulk matching: `segments.filter(s => s.type === 'silence' && (s.end - s.start) > thresholdSeconds)`.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run build
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run build` passes. Selecting "Remove silences > 3s" disables matching segments (visual change on timeline). "Undo All" restores them. Playing video skips over disabled segments smoothly.
CHUNK_10_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_11() {
  local log="$LOG_DIR/chunk-11.log"
  echo -e "${YELLOW}▶ Chunk 11/$TOTAL_CHUNKS: Export with Reviewed Segments${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="
### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they're in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_11_PROMPT'
[Project] supahscreenrecordah at /mnt/e/Projects/Yaatuber
Stack: TypeScript, Electron 35, tsdown (IIFE), tsc, vitest, vanilla DOM (no React)
Check: npm run typecheck && npm run build

## Research Findings

### [ADAPT] Export pipeline bypass for pre-computed segments

Current export flow in `src/main/services/post-export.ts`:
```
processWithSilenceAndCaptions(videoPath, silenceConfig, captionConfig, aspectRatio)
  → transcribe(videoPath)          ← calls AssemblyAI API
  → detectSilences(words)          ← finds silence regions
  → buildCutSegments(cutRegions)   ← inverts to keep-segments
  → cutSilenceRegions(videoPath, keepSegments)  ← FFmpeg trim+concat
```

For review screen export, bypass transcription+detection and feed pre-computed keep-segments directly:
```
exportWithReviewSegments(videoPath, keepSegments: {start, end}[])
  → cutSilenceRegions(videoPath, keepSegments)  ← reuse existing FFmpeg logic
  → postProcessRecording(videoPath)             ← existing audio enhancement
```

The key function to reuse is `cutSilenceRegions(videoPath, keepSegments)` from `src/main/services/ffmpeg/silence-cut.ts` — it already accepts `{start, end}[]` segments.

### Gotchas
6. Export must bypass AssemblyAI — call cutSilenceRegions() directly with user's reviewed keep-segments

## Chunk 11/12: Export with Reviewed Segments

Depends on: Chunk 10 (bulk actions, segments finalized)

**Read these files first** (do NOT explore beyond this list):
- `src/main/services/ffmpeg/silence-cut.ts` — existing `cutSilenceRegions(videoPath, keepSegments)` to reuse
- `src/main/services/post-export.ts` — existing `processWithSilenceAndCaptions` flow to understand
- `src/main/ipc/file.ts` — existing `FILE_SAVE_RECORDING` handler
- `src/renderer/main/playback.ts` — existing export button handler
- `src/renderer/main/review/review-controller.ts` — getReviewSegments()

**Create:**
- None

**Modify:**
- `src/shared/channels.ts` — add `REVIEW_EXPORT: 'review:export'` channel
- `src/shared/types.ts` — add `exportWithSegments` to MainAPI
- `src/preload/main-preload.ts` — wire export IPC
- `src/main/ipc/review.ts` — add export handler
- `src/renderer/main/playback.ts` — modify export button to pass reviewed segments

**What to Build:**

**Export handler** (`review.ts`):
`exportWithSegments(filePath, buffer, keepSegments: {start, end}[])`:
1. Write buffer to temp file
2. If `keepSegments` covers full duration (no cuts): skip cutting, just post-process
3. Otherwise: call existing `cutSilenceRegions(tempPath, keepSegments)` — reuses the existing FFmpeg trim+concat logic
4. Call existing `postProcessRecording(tempPath)` for audio enhancement
5. Move result to user's chosen `filePath`
6. Clean up temp files

**Renderer side:**
- When export button is clicked, collect keep-segments from review controller:
  - Get all segments, filter to `enabled === true` (speech + kept silence/filler)
  - Map to `{start, end}` pairs
  - Merge adjacent segments (if a silence was re-enabled between two speech segments)
- Pass to `exportWithSegments` IPC along with the recording buffer

**Code to Adapt:**
[ADAPT] Reuse `cutSilenceRegions(videoPath, keepSegments)` from `src/main/services/ffmpeg/silence-cut.ts` directly. It already builds the FFmpeg filter_complex for trim+concat.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run build
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run build` passes. Exporting with some segments disabled produces a shorter video with silences removed. Exporting with all segments enabled produces the same video as skip-review export. FFmpeg process completes without errors.
CHUNK_11_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

run_chunk_12() {
  local log="$LOG_DIR/chunk-12.log"
  echo -e "${YELLOW}▶ Chunk 12/$TOTAL_CHUNKS: Skip Review Path, Graceful Degradation & Polish${NC}"

  local context_section=""
  if [[ -n "$PREV_CONTEXT" ]]; then
    context_section="
### Previous Chunk Changes (Summary)
\`\`\`
$PREV_CONTEXT_STAT
\`\`\`

### Previous Chunk Changes (Code)
\`\`\`
$PREV_CONTEXT
\`\`\`
Do NOT modify these files unless they're in YOUR file lists. Review this diff to understand what was already built — do NOT duplicate or contradict it."
  fi

  cd "$PROJECT_DIR"
  claude --dangerously-skip-permissions --max-turns 50 \
    -p "$(cat <<'CHUNK_12_PROMPT'
[Project] supahscreenrecordah at /mnt/e/Projects/Yaatuber
Stack: TypeScript, Electron 35, tsdown (IIFE), tsc, vitest, vanilla DOM (no React)
Check: npm run typecheck && npm run build

## Chunk 12/12: Skip Review Path, Graceful Degradation & Polish

Depends on: Chunk 11 (everything functional)

**Read these files first** (do NOT explore beyond this list):
- `src/renderer/main/review/review-controller.ts` — full flow
- `src/renderer/main/playback.ts` — existing exit/export flows
- `src/renderer/styles/main.css` — review styles

**Create:**
- None

**Modify:**
- `src/renderer/main/review/review-controller.ts` — loading states, whisper-missing state
- `src/renderer/styles/main.css` — polish animations, skeleton loader
- `src/renderer/main/playback.ts` — skip button handler, keyboard shortcuts

**What to Build:**

1. **"Skip" button**: bypasses review entirely, exports original blob as-is using existing export flow (no segments). Placed in bottom action bar.

2. **Loading states**:
   - "Analyzing audio..." text in processing overlay while whisper runs
   - Timeline area shows pulsing skeleton bars (CSS animation) until waveform loads
   - If analysis takes > 30s, show "Still working..." subtext

3. **Whisper not installed**:
   - If `findWhisper()` or `findWhisperModel()` returns null, show waveform-only timeline (no segments)
   - Show subtle banner: "Install Whisper for auto-trim" with a button
   - Button triggers whisper + model download with progress bar
   - After install, re-run analysis automatically

4. **Keyboard shortcuts** (on playback container when visible):
   - `Space` = play/pause toggle
   - `Left` / `Right` = seek +/-5s
   - `Escape` = exit review (same as Exit button)
   - `Enter` = export (same as Export button)

5. **Transition animations**:
   - Timeline slides up (transform translateY) when analysis completes
   - Segment overlays fade in (opacity 0→1 over 300ms)

**Code to Adapt:**
Follow existing processing overlay pattern for loading state. Keyboard: `document.addEventListener('keydown', ...)` guarded by `!playbackContainer.classList.contains('hidden')`.

**Rules:**
- Read ONLY the files listed above. Do NOT explore the codebase.
- Implement ONLY what is described. No extras, no refactoring.
- After implementing: npm run typecheck && npm run build
- Fix ALL errors before finishing.
- Do NOT ask questions.

**Gate:** `npm run typecheck && npm run build` passes. App works without whisper installed (shows playback with waveform, no segment suggestions). Skip button exports without review. Keyboard shortcuts work. No regressions in regular 16:9 or 9:16 recording flow. Full flow: record → stop → analyze → review timeline with segments → toggle/trim → export.
CHUNK_12_PROMPT
)$context_section" < /dev/null 2>&1 | tee "$log"
}

# ══════════════════════════════════════════════════════
# MAIN LOOP
# ══════════════════════════════════════════════════════

CHUNK_FUNCTIONS=( run_chunk_1 run_chunk_2 run_chunk_3 run_chunk_4 run_chunk_5 run_chunk_6 run_chunk_7 run_chunk_8 run_chunk_9 run_chunk_10 run_chunk_11 run_chunk_12 )
CHUNK_NAMES=( "Segment Model & Types" "Whisper Binary Download & Detection" "Whisper Transcription Service" "Audio Waveform Extraction" "Review Screen HTML + CSS Layout" "Timeline Canvas Renderer" "Review Screen Controller" "Timeline Interaction" "Trim Handle Dragging with Snap" "Bulk Actions & Preview Playback with Cuts" "Export with Reviewed Segments" "Skip Review Path, Graceful Degradation & Polish" )

for i in "${!CHUNK_FUNCTIONS[@]}"; do
  num=$((i + 1))

  if [[ "$num" -lt "$START_CHUNK" ]]; then
    echo -e "${YELLOW}  Skipping chunk $num${NC}"
    continue
  fi

  ${CHUNK_FUNCTIONS[$i]}
  run_quality_gate "$num"
  auto_commit "$num" "${CHUNK_NAMES[$i]}"
  capture_context

  ((CHUNKS_SINCE_CLEANUP++)) || true
  if [[ "$CLEANUP_EVERY" -gt 0 && "$CHUNKS_SINCE_CLEANUP" -ge "$CLEANUP_EVERY" ]]; then
    run_cleanup
    CHUNKS_SINCE_CLEANUP=0
  fi

  echo ""
done

echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  All chunks complete!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"

if [[ "$SKIP_FINAL_CHECK" != "true" ]]; then
  echo -e "${BLUE}Running final quality checks...${NC}"
  cd "$PROJECT_DIR"
  if eval "$CHECK_CMD"; then
    echo -e "${GREEN}✓ All checks passed${NC}"
  else
    echo -e "${RED}✗ Final checks failed — fix before committing${NC}"
    exit 1
  fi
fi

echo -e "${GREEN}Done! Review changes: git diff${NC}"
