# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stable Audio 3 Lab — a local Next.js 16 (App Router) dark-mode web app for testing Stability AI's Stable Audio 3 open-weight models on Apple Silicon. Generates music and sound effects via a Python bridge script, with in-browser playback, a library with metadata sidecars, waveform/spectrogram analysis, crop/export, and batch workflows. It also runs a **continuous AI radio station** (streamed to the native **Pardora iOS/watchOS/CarPlay** companion app), **audio assessment** of generated tracks via a local audio-language model, and **reference-track analysis** (local file drop or YouTube URL via Codex). README.md is the current source of truth for full feature detail.

## Commands

| Command | Purpose |
|---|---|
| `make dev` / `make dev-stop` / `make dev-restart` | Dev server lifecycle on port 3007 |
| `make build` | Production build |
| `make test` | Vitest + Python unittest |
| `make typecheck` / `make lint` | `tsc --noEmit` (no separate linter) |
| `make checkall` | `test` + `build` |
| `npx vitest run lib/generation.test.ts` | Single TS test file |
| `python3 -m unittest tests.test_generate_audio` | Single Python test |
| `npm run py:mock` | Generate `public/outputs/mock.wav` from the CLI |

No formatter is configured (`make fmt` is a no-op).

**Pardora iOS app** (`apps/pardora-ios/`, xcodegen via `project.yml`): `make pardora-generate`, `make pardora-build`, `make pardora-test`, `make pardora-checkall`, `make pardora-run` (boots Simulator, dark mode), `make pardora-archive-testflight` / `make pardora-upload-testflight`.

## Architecture

**Single-page client app** — all UI components live in `app/page.tsx` (~1200 lines). The `components/` directory is unused.

**API routes** (all in `app/api/`):
- `POST /api/generate` — spawns Python subprocess for audio generation; accepts `title` (explicit) or `autoTitle` (AI-generated via Ollama) to derive the output filename from a human-readable title
- `POST /api/generate-title` — calls local Ollama (phi4-mini by default) to generate a creative title from a prompt; also used internally by the generate route
- `GET/PATCH/DELETE /api/library` — CRUD for generated audio + metadata sidecars (PATCH supports `title`, `favorite`, `notes`, `rating`)
- `GET /api/library/bundle` — ZIP export (single or batch)
- `POST /api/library/crop` — ffmpeg-based audio trimming
- `POST /api/assess` — runs the configured local audio-language model against a generated track; writes the structured `analysis` result into its metadata sidecar
- `POST /api/assess/upload` — temporary local reference-track upload → analyze → return a music prompt (audio not added to the library)
- `POST /api/assess/youtube` — Codex/`yt-dlp`-backed YouTube reference extraction → analyze → prompt (temp MP3 under `.stable-audio-assessments/uploads/`)
- `GET /api/radio` — continuous AI radio station: live queue, LAN + public MP3 stream URLs, DJ announcements, taste profile, and stats (consumed by Pardora)

**Python bridge** (`scripts/generate_audio.py`) — handles both mock WAV synthesis (stdlib only) and real Stable Audio 3 inference via MLX or PyTorch. Runs in its own process group with timeout-based SIGTERM/SIGKILL escalation.

**Audio assessor** (`scripts/audio_assessor_qwen_omni.py`) — a second subprocess invoked by `/api/assess*`. Runs Qwen2.5-Omni-7B (speech-output talker disabled) to extract structured JSON attributes from a track. Configured via `STABLE_AUDIO_ASSESSOR_COMMAND` / `STABLE_AUDIO_ASSESSOR_TIMEOUT_MS`; supports load-throttling and a persisted queue (`.stable-audio-assessments/queue.json`) shared across Library, Radio, and YouTube flows.

**Shared libraries** (`lib/`):
- `generation.ts` — Zod request schema, model options, presets, prompt tips, batch seed generation
- `generator-backend.ts` — MLX vs Torch backend routing, model-to-MLX mapping, CLI arg building
- `library.ts` — metadata sidecars, title-to-filename slugification with duplicate detection, custom ZIP builder (no external zip lib), crop utilities, SVG screenshot cards
- `metadata-settings.ts` — deserializes metadata back into reusable UI settings ("Load config")
- `radio.ts` (~1481 LOC, largest source file) — radio station: state machine, styles, queue management, taste-distillation prompt builder (thumbs up/down batched into a `RadioTasteProfile` that rewrites future prompts), multi-provider TTS announcements (`openai`/`elevenlabs`/`deepgram`/`gemini`/`kokoro-onnx`), and LAN/public stream-URL builders
- `audio-assessment.ts` — shared assessor-subprocess provider contract; load-throttled (`AUDIO_ASSESSMENT_LOAD_THRESHOLD`) persisted queue backing Library/Radio/YouTube assessment
- `assessment-prompt.ts` — converts assessor JSON attributes into a music prompt
- `radio-playlist-response.ts` — `/api/radio` response shape

**Data flow**: Frontend → API route → `spawn(python, generate_audio.py)` → WAV/MP3 in `public/outputs/` + JSON sidecar → library panel reads sidecars.

**Vendored runtime** — `vendor/stable-audio-3/` contains the official Stability AI repo with MLX weights and inference code.

## Subsystems beyond generation

- **Radio station** — A continuous, generative station served from `/api/radio`. It builds the live queue, exposes a LAN (`*.m3u`/`.pls`) and public MP3 stream URL, generates DJ announcements via configurable TTS providers, and distills the listener's thumbs up/down into a `RadioTasteProfile` (via `codex exec`) that rewrites future generation prompts. TTS API keys fall back to `~/.claude/.env`.
- **Audio assessment** — The Assess buttons run a local audio-language model (Qwen2.5-Omni-7B by default) over a track and store structured attributes in the sidecar. One load-throttled, persisted queue (`.stable-audio-assessments/queue.json`) serves Library, Radio, and YouTube flows through a single subprocess-provider contract; it survives dev-server restarts.
- **Reference tracks** — Drop an audio file, paste a YouTube URL, or drag a browser link into the Reference panel. YouTube extraction runs `codex exec` against the repo-local `youtube-audio-extract` skill (`yt-dlp` + `ffmpeg`) into a temp MP3, which is assessed and converted to a prompt; the source audio is never added to `public/outputs/`.

## Pardora iOS App

`apps/pardora-ios/` is a native Swift 6 companion (iOS 17+ / watchOS / CarPlay / Live Activities), generated by xcodegen from `project.yml`. It consumes the station through the plain `/api/radio` JSON contract + stream URL — no app-specific API coupling. See the Commands section for `make pardora-*` targets; design/spec notes live under `docs/superpowers/`.

## Key Conventions

- Path alias: `@/` maps to project root (tsconfig + vitest config)
- Audio outputs live in `public/outputs/` (gitignored except `.gitkeep`)
- Every generated file gets a `.json` metadata sidecar with full generation settings, timing, batch/crop lineage, title, annotations, and (when assessed) an `analysis` block; bundles add a sibling `*.analysis-summary.json`
- `.stable-audio-assessments/` (gitignored) holds temp YouTube/upload MP3s and the persisted assessment queue (`queue.json`)
- Filenames are derived from the title when provided/auto-generated (e.g. `"Neon Pulse"` → `neon_pulse.mp3`), with `_2`, `_3` suffix for duplicates; falls back to `sa3-{mode}-{timestamp}` when no title
- Models: `small-sfx`, `small-music`, `medium` — each has a max duration enforced by `normalizeGenerationRequest`
- Environment config via `.env.local` (see `.env.example` for all vars)
- Settings persisted in `localStorage` under `stable-audio-3-lab:settings:v1`
- Pre-commit hooks configured via `.pre-commit-config.yaml` (gitleaks, trailing whitespace, YAML/JSON validation)

## Claude Code Skills

- `skills/stable-audio/` (symlinked to `~/.claude/skills/stable-audio`) — lets any agent generate SFX and music via the local API without knowing the project internals. Auto-starts the dev server if needed; sensible defaults (medium model / 60s for music, small-sfx / appropriate duration for SFX, steps 10, cfgScale 2). Supports `title` (explicit) and `autoTitle` (Ollama-generated) for named output files.
- `skills/youtube-audio-extract/` — invoked by `/api/assess/youtube` via `codex exec`; wraps `yt-dlp` + `ffmpeg` to produce a temp MP3 for reference-track assessment.
