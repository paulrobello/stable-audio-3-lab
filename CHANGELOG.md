# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Releases:** Tag each release as `v<version>` (e.g. `v0.1.0`) and add a dated
> `## [0.1.0] - YYYY-MM-DD` heading below. Keep `[Unreleased]` for in-progress
> work and move entries down at release time. The README links here instead of
> duplicating release notes.

## [Unreleased]

### Added
- **Security boundary** — opt-in shared-secret bearer-token auth on mutating `/api/*` routes via `proxy.ts` (`STABLE_AUDIO_ADMIN_TOKEN`). Read-only GET routes, including `GET /api/radio` and the `?stream=1` MP3 stream, remain public. Unset by default for localhost/single-user mode.
- **Concurrency control** — a single shared generation-slot semaphore (`STABLE_AUDIO_MAX_CONCURRENT`, default 1) across `/api/generate`, the radio queue, and assessments, pinned to `globalThis` so it survives Next.js HMR.
- **Rate limiting** — per-client token-bucket rate limit on mutating routes (`STABLE_AUDIO_MUTATING_RATE_PER_MINUTE`, default 30; fail-open on cold restart).
- **Deterministic YouTube extraction** — `POST /api/assess/youtube` now runs a fixed-argument `yt-dlp` + `ffmpeg` subprocess (`STABLE_AUDIO_YOUTUBE_YTDLP_BIN` / `STABLE_AUDIO_YOUTUBE_TIMEOUT_MS`), replacing the autonomous Codex agent.
- **Centralized configuration** — `lib/server/config.ts` collects every `STABLE_AUDIO_*` / `RADIO_*` / `OLLAMA_*` / ffmpeg / port env read with typed, defaulted accessors.
- **Shared subprocess runner** — `lib/server/subprocess.ts` (`runCommand`) with SIGTERM→SIGKILL escalation and an `error` handler, used by generation, crop, assessment, and YouTube extraction.
- **Minimal logger** — `lib/server/logger.ts` for behavior-changing fallback paths (replaces silent empty catches on hot paths).
- **Documentation** — API reference (`docs/reference/api.md`), architecture overview (`docs/architecture/system-overview.md`), troubleshooting guide (`docs/troubleshooting/common-errors.md`), Pardora iOS README (`apps/pardora-ios/README.md`), `CONTRIBUTING.md`, a full environment-variable reference, a README Radio Station section, and JSDoc across `lib/radio/`, `lib/audio-assessment.ts`, and `lib/library.ts`.

### Changed
- **Radio state store** — `.stable-audio-radio/state.json` is now written atomically (temp file + rename) through a locked, re-read-inside-the-critical-section store (`lib/server/radio-state-store.ts`). Corrupt reads no longer silently wipe station state.
- **Radio route decomposed** — `app/api/radio/route.ts` is now parse + dispatch + handlers; services moved to `lib/server/` (`radio-queue-service.ts`, `radio-stream.ts`, `radio-tts.ts`, `codex-client.ts`, `ollama.ts`, `radio-actions.ts`).
- **`lib/radio.ts` split** — the radio domain is now a barrel under `lib/radio/` (`types.ts`, `styles.ts`, `state.ts`, `prompts.ts`, `tts.ts`, `urls.ts`). The `@/lib/radio` import path still works.
- **Ollama client consolidated** — `generateTitle` / `cleanTitle` and the Ollama URL builders moved into `lib/server/ollama.ts`; route files import from there.
- **TTS key resolution** — provider TTS keys resolve from the app's own `.env.local` / process env only (SEC-006); the app no longer reads `~/.claude/.env`.
- **Project layout & roadmap** — README layout, roadmap ("Where we are" / "Where we're going"), and project structure refreshed to reflect the post-refactor tree.

### Fixed
- **Assessment queue poison pill** — failing jobs are capped and dead-lettered instead of re-queued at the head forever, so one bad file can no longer starve the queue.
- **Generation hangs on missing Python** — `spawn` `error` handlers are attached everywhere (previously a missing binary could hang a request until `maxDuration`).
- **Radio stream pacing** — a single shared bitrate constant now drives both the ffmpeg transcode args and the stream pacing math, fixing announcement pacing and mid-track resume offsets.
- **Silent radio degradation** — TTS, taste distillation, queue refill, and Ollama draft fallbacks now log warnings instead of swallowing errors.
- **Vitest exclude** — `.claude/worktrees/**` is excluded so `make checkall` no longer runs stale duplicate test suites from worktrees.

## [0.1.0]

### Added
- **Stable Audio 3 Lab** — local Next.js (App Router) dark-mode app for testing Stable Audio 3 open-weight models on Apple Silicon, with mock mode and real MLX inference (Small Music, Small SFX, Medium).
- **Library and metadata** — in-browser playback, waveform/spectrogram previews, favorites, notes and 1–5 star ratings, download/delete, `.json` metadata sidecars, **Load config** from prior renders, and metadata cleanup on delete.
- **Generation controls** — prompt, negative prompt, duration, steps, CFG, seed, format, and backend-backed mock/real behavior; settings persist in `localStorage`.
- **Batch variation workflow** — up to 8 variations from one prompt with a shared batch ID, deterministic seed incrementing, comparison view, and one-click `Run ZIP` export with manifests.
- **Titles and auto-title** — explicit `title` or Ollama-generated `autoTitle` (phi4-mini) slugified into filenames, with duplicate suffixing and a timestamp fallback.
- **Waveform library player** — hidden native media chrome, click/keyboard seeking, per-item volume, crop markers, playback-error feedback, and a live cyan playhead.
- **Audio cropping** — trim any library item into a shorter clip via ffmpeg with source/crop lineage preserved in metadata.
- **Export bundles** — single-item `.bundle.zip` with audio, metadata, analysis summary, and rendered screenshot card.
- **Reference-track analysis** — local audio drops and YouTube links analyzed into reusable music prompts without adding source audio to the library.
- **Audio assessment** — local audio-language model (Qwen2.5-Omni-7B) extracts structured track attributes into sidecar metadata via a load-throttled, persisted queue.
- **Continuous AI radio station** — autonomous queue, DJ announcements (multi-provider TTS), listener taste-profile distillation, atomic locked state, and LAN + public MP3 streaming with M3U/PLS playlists.
- **Pardora iOS/watchOS/CarPlay companion** — native Swift 6 app consuming the `/api/radio` JSON + MP3 stream, with a Live Activity extension and TestFlight workflow.
- **Safety controls** — per-process-group timeout handling and SIGTERM→SIGKILL process-tree cleanup for MLX generation.
- **Testing and git hooks** — Vitest unit tests, Python unittests, production build checks, and pre-commit hooks (gitleaks, trailing whitespace, YAML/JSON validation).

[Unreleased]: https://github.com/paulrobello/stable-audio-3-lab/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/paulrobello/stable-audio-3-lab/releases/tag/v0.1.0
