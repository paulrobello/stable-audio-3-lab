# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stable Audio 3 Lab — a local Next.js 16 (App Router) dark-mode web app for testing Stability AI's Stable Audio 3 open-weight models on Apple Silicon. Generates music and sound effects via a Python bridge script, with in-browser playback, a library with metadata sidecars, waveform/spectrogram analysis, crop/export, and batch workflows.

## Commands

| Command | Purpose |
|---|---|
| `make dev` | Dev server on port 3007 |
| `make build` | Production build |
| `make test` | Vitest + Python unittest |
| `make typecheck` / `make lint` | `tsc --noEmit` (no separate linter) |
| `make checkall` | `test` + `build` |
| `npx vitest run lib/generation.test.ts` | Single TS test file |
| `python3 -m unittest tests.test_generate_audio` | Single Python test |

No formatter is configured (`make fmt` is a no-op).

## Architecture

**Single-page client app** — all UI components live in `app/page.tsx` (~1200 lines). The `components/` directory is unused.

**API routes** (all in `app/api/`):
- `POST /api/generate` — spawns Python subprocess for audio generation
- `GET/PATCH/DELETE /api/library` — CRUD for generated audio + metadata sidecars
- `GET /api/library/bundle` — ZIP export (single or batch)
- `POST /api/library/crop` — ffmpeg-based audio trimming

**Python bridge** (`scripts/generate_audio.py`) — handles both mock WAV synthesis (stdlib only) and real Stable Audio 3 inference via MLX or PyTorch. Runs in its own process group with timeout-based SIGTERM/SIGKILL escalation.

**Shared libraries** (`lib/`):
- `generation.ts` — Zod request schema, model options, presets, prompt tips, batch seed generation
- `generator-backend.ts` — MLX vs Torch backend routing, model-to-MLX mapping, CLI arg building
- `library.ts` — metadata sidecars, custom ZIP builder (no external zip lib), crop utilities, SVG screenshot cards
- `metadata-settings.ts` — deserializes metadata back into reusable UI settings ("Load config")

**Data flow**: Frontend → API route → `spawn(python, generate_audio.py)` → WAV/MP3 in `public/outputs/` + JSON sidecar → library panel reads sidecars.

**Vendored runtime** — `vendor/stable-audio-3/` contains the official Stability AI repo with MLX weights and inference code.

## Key Conventions

- Path alias: `@/` maps to project root (tsconfig + vitest config)
- Audio outputs live in `public/outputs/` (gitignored except `.gitkeep`)
- Every generated file gets a `.json` metadata sidecar with full generation settings, timing, batch/crop lineage, and annotations
- Models: `small-sfx`, `small-music`, `medium` — each has a max duration enforced by `normalizeGenerationRequest`
- Environment config via `.env.local` (see `.env.example` for all vars)
- Settings persisted in `localStorage` under `stable-audio-3-lab:settings:v1`
- Pre-commit hooks configured via `.pre-commit-config.yaml` (gitleaks, trailing whitespace, YAML/JSON validation)

## Claude Code Skill

A `stable-audio` skill is available at `skills/stable-audio/SKILL.md` and symlinked to `~/.claude/skills/stable-audio`. It enables any agent to generate SFX and music via the local API without knowing the project internals. The skill auto-starts the dev server if needed and uses sensible defaults (medium model / 60s for music, small-sfx / appropriate duration for SFX, steps 10, cfgScale 2).
