# Stable Audio 3 Lab

## Table of Contents

* [About](#about)
* [Features](#features)
  * [Core Capabilities](#core-capabilities)
  * [Model Backends](#model-backends)
  * [Library and Metadata](#library-and-metadata)
  * [Technical Excellence](#technical-excellence)
* [Screenshots](#screenshots)
* [Prerequisites for running](#prerequisites-for-running)
* [Prerequisites for dev](#prerequisites-for-dev)
* [Installing for dev mode](#installing-for-dev-mode)
* [Real Stable Audio 3 inference](#real-stable-audio-3-inference)
  * [Accept gated model terms](#accept-gated-model-terms)
  * [Install the official Stable Audio 3 repo](#install-the-official-stable-audio-3-repo)
  * [Install the MLX runtime](#install-the-mlx-runtime)
  * [Optional: pre-download MLX weights](#optional-pre-download-mlx-weights)
  * [Configure real inference](#configure-real-inference)
* [Environment Variables](#environment-variables)
* [Running Stable Audio 3 Lab](#running-stable-audio-3-lab)
* [Pardora iOS App](#pardora-ios-app)
* [Radio station](#radio-station)
* [Quick start music workflow](#quick-start-music-workflow)
* [Quick start SFX workflow](#quick-start-sfx-workflow)
* [Reproducible seeds](#reproducible-seeds)
* [Titles and auto-title](#titles-and-auto-title)
* [Output and metadata](#output-and-metadata)
* [Audio assessment](#audio-assessment)
* [Useful commands](#useful-commands)
* [Project layout](#project-layout)
* [Architecture](#architecture)
* [Research](#research)
* [Contributing](#contributing)
* [Troubleshooting](#troubleshooting)
* [FAQ](#faq)
* [Roadmap](#roadmap)
  * [Where we are](#where-we-are)
  * [Where we're going](#where-were-going)
* [What's new](#whats-new)

![Runs on MacOS](https://img.shields.io/badge/runs%20on-MacOS-blue)
![Arch AppleSilicon](https://img.shields.io/badge/arch-AppleSilicon-blue)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![Backend MLX](https://img.shields.io/badge/backend-MLX-8b5cf6)
![License MIT](https://img.shields.io/badge/license-MIT-green)

## About

Stable Audio 3 Lab is a local dark-mode Next.js application for testing Stability AI's Stable Audio 3 open-weight models for music and sound-effect generation on an Apple Silicon Mac.

The app was built for Paul's M4 Max MacBook Pro with 128GB unified memory and uses the official Stable Audio 3 MLX optimized runtime by default. It gives you a browser UI for prompt iteration, model/settings control, in-browser playback, generated-audio history, sidecar metadata, reproducible-ish seed workflows, and a mock mode for fast UI/API testing without waking the model goblin.

## Features

### Core Capabilities

- **Music and SFX Modes**: Switch between music prompts and sound-effect/Foley prompts with mode-specific presets.
- **Model Selection**: Test Stable Audio 3 Small Music, Small SFX, and Medium from one interface.
- **Generation Controls**: Adjust prompt, negative prompt, duration, steps, CFG, seed, format, and backend-backed mock/real behavior.
- **MP3 and WAV Output**: MP3 is the default for smaller shareable renders; WAV is available for raw/editable output.
- **Reference Track Prompting**: Drop MP3/WAV/M4P files, paste YouTube URLs, or drag browser links into the Reference track panel to analyze audible traits and turn them into a music prompt.
- **Persistent Settings**: UI settings are saved in `localStorage` under `stable-audio-3-lab:settings:v1`.
- **Global Playback Volume**: Every preview player and library waveform player uses one shared persisted volume setting, because surprise goblin volume is rude.

### Model Backends

- **Full MLX Path**: Real inference defaults to Apple's MLX backend for all supported UI models.
- **Official Optimized Weights**: Uses `stabilityai/stable-audio-3-optimized` MLX weights.
- **Backend Routing**: Maps UI model names to official MLX DiT/decoder pairs.
- **Torch Escape Hatch**: `STABLE_AUDIO_BACKEND=torch` remains available if you intentionally want to test the standard PyTorch path.
- **Timeout Safety**: MLX subprocesses run in their own process group and are terminated cleanly on timeout/interruption.

### Library and Metadata

- **Generated Audio Library**: Listen to previous generations directly in the browser.
- **Waveform and Spectrogram Views**: Inspect rendered audio visually with per-item Wave/Spec previews.
- **Favorite Keepers**: Star library items so the good goblins do not get lost in the noise pile.
- **Notes and Ratings**: Add optional per-render notes plus 1–5 star ratings for quick A/B judgment calls.
- **Download and Delete**: Download audio keepers or delete cursed renders with confirmation.
- **Export Bundles**: Download a `.bundle.zip` containing the audio file, metadata sidecar, analysis summary, and rendered screenshot card for sharing experiments.
- **Batch Run Bundles**: Multi-variation runs get a shared batch ID and one-click `Run ZIP` export for the entire variation set, including per-render screenshot cards.
- **Audio Cropping**: Trim any library item into a shorter MP3/WAV clip while preserving source metadata and crop provenance.
- **Metadata Sidecars**: Every output gets a `.json` sidecar with prompt, settings, backend, seed, runtime, favorite state, annotations, batch lineage, crop lineage, and Python output tails.
- **Load Config**: Restore prompt/settings/seed from an existing library item to iterate from a prior render.
- **Metadata Cleanup**: Deleting a library item removes both the audio file and sidecar metadata.

### Technical Excellence

- **Next.js App Router**: Browser UI plus API routes for generation and library management.
- **Typed Request Validation**: Zod schemas validate generation requests.
- **Python Bridge**: A small Python bridge handles mock generation, real Stable Audio invocation, MP3 conversion, and metadata-safe output.
- **Codex-Assisted YouTube Extraction**: YouTube reference links run through the repo-local `youtube-audio-extract` skill, which uses `yt-dlp` and `ffmpeg` to create a temporary MP3 for assessment.
- **Test Coverage**: Vitest tests cover UI/backend helpers; Python unittests cover process cleanup and backend normalization.
- **Pre-commit Hooks**: Formatting, linting, secret checks, and build/test gates are wired through the Makefile.

## Screenshots

Music mode with prompt controls, model tuning, playback volume, and generation library.

![Music Mode](https://raw.githubusercontent.com/paulrobello/stable-audio-3-lab/main/docs/music_mode.png)

Sound FX mode with SFX-focused prompts and the same local generation workflow.

![Sound FX Mode](https://raw.githubusercontent.com/paulrobello/stable-audio-3-lab/main/docs/sfx_mode.png)

## Prerequisites for running

* macOS on Apple Silicon is the intended target.
* Node.js 20 or newer.
* Python 3.11 or newer.
* `uv` for the vendored Stable Audio 3 Python environment.
* `ffmpeg` and `ffprobe` for MP3 conversion, crop rendering, and real media-duration validation.
* `codex`, `yt-dlp`, and `ffmpeg` if you want the Reference track panel to extract audio from YouTube URLs.
* Hugging Face CLI (`hf`) or `HF_TOKEN` if you want higher download limits.
* A Hugging Face account with Stability's gated model terms accepted only if you use the standard Torch checkpoints.

Mock mode does not require the Stable Audio 3 models and is useful for validating the browser → API → Python → output → playback loop.

## Prerequisites for dev

* Install Node.js and npm.
* Install Python 3.11+.
* Install uv:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

* Install pre-commit if you want local git hooks:

```bash
python3 -m pip install pre-commit
```

## Installing for dev mode

Clone the repo and install dependencies:

```bash
git clone https://github.com/paulrobello/stable-audio-3-lab
cd stable-audio-3-lab
npm install
cp .env.example .env.local
make pre-commit-install
```

Start the local dev server:

```bash
npm run dev
```

Open <http://localhost:3007>.

## Real Stable Audio 3 inference

This lab defaults to the official **Apple Silicon MLX backend** for real inference. Stability ships MLX weights for all three UI models:

| UI model | MLX DiT | Decoder | Notes |
| --- | --- | --- | --- |
| Small Music | `sm-music` | `same-s` | Fast music sketches. |
| Small SFX | `sm-sfx` | `same-s` | Sound effects, Foley, UI stings. |
| Medium | `medium` | `same-l` | Higher-quality music and longer forms. |

The MLX path uses `stabilityai/stable-audio-3-optimized`, which is the public optimized-weight repo with MLX, ONNX, and TensorRT assets. Hugging Face currently describes it as experimental and points standard checkpoint users back to the normal Small/Medium repos. For this Apple Silicon app, MLX still avoids the CUDA/FlashAttention requirements of the standard PyTorch Medium checkpoint.

### Accept gated model terms

Accept the gated license terms on Hugging Face first if you plan to use `STABLE_AUDIO_BACKEND=torch` or otherwise download the standard checkpoints:

* <https://huggingface.co/stabilityai/stable-audio-3-small-sfx>
* <https://huggingface.co/stabilityai/stable-audio-3-small-music>
* <https://huggingface.co/stabilityai/stable-audio-3-medium>

The optimized MLX repo is not currently gated, but it is still covered by the Stability AI Community License and Gemma terms.

### Install the official Stable Audio 3 repo

```bash
cd ~/Repos/stable-audio-3-lab
git clone https://github.com/Stability-AI/stable-audio-3.git vendor/stable-audio-3
cd vendor/stable-audio-3
uv sync
uv run hf auth login
```

`hf auth login` is optional for the default optimized MLX path, but it avoids anonymous Hugging Face download limits and is required for gated standard checkpoints after you accept their terms.

### Install the MLX runtime

```bash
cd ~/Repos/stable-audio-3-lab/vendor/stable-audio-3/optimized/mlx
./install.sh -y
```

The installer creates `optimized/mlx/.venv`, installs the MLX runtime dependencies, and offers to download the selected model bundles from `stabilityai/stable-audio-3-optimized`. If you skip weight selection, the `./sa3` wrapper downloads missing `.npz` files on first use and symlinks them into `models/mlx/` from the Hugging Face cache.

### Optional: pre-download MLX weights

The runtime can auto-download missing weights, so this step is optional. If you want to pre-warm only the MLX assets with the current Hugging Face CLI:

```bash
cd ~/Repos/stable-audio-3-lab/vendor/stable-audio-3/optimized/mlx
hf download stabilityai/stable-audio-3-optimized \
  --include 'MLX/*.npz' \
  --local-dir ./hf-optimized
```

Expose those files where the MLX runtime expects them. Run this from the repo root so `<REPO_ROOT>` resolves to your checkout:

```bash
python3 - <<'PY'
from pathlib import Path
mlx = Path.cwd() / 'vendor/stable-audio-3/optimized/mlx'
src = mlx / 'hf-optimized/MLX'
dst = mlx / 'models/mlx'
dst.mkdir(parents=True, exist_ok=True)
for p in src.glob('*.npz'):
    target = dst / p.name
    if target.exists() or target.is_symlink():
        target.unlink()
    target.symlink_to(p)
PY
```

### Configure real inference

Update `.env.local`. Replace `<REPO_ROOT>` with the absolute path to this checkout (e.g. `$(pwd)`):

```bash
STABLE_AUDIO_MOCK=false
STABLE_AUDIO_PYTHON=<REPO_ROOT>/vendor/stable-audio-3/.venv/bin/python
STABLE_AUDIO_BACKEND=mlx
STABLE_AUDIO_TIMEOUT_MS=900000
```

`STABLE_AUDIO_BACKEND=mlx` is the default when unset. Set `STABLE_AUDIO_BACKEND=torch` only if you intentionally want to test the standard PyTorch backend.

### Configure audio assessment

The Library and Pardora radio **Assess** buttons call `/api/assess`, which runs a local audio-language model against the selected generated song and saves the structured result into the audio sidecar metadata.

The first supported assessor is Qwen2.5-Omni-7B via `scripts/audio_assessor_qwen_omni.py`. Hugging Face's Transformers docs describe Qwen2.5-Omni as a multimodal model that accepts audio input, and the wrapper disables the speech-output talker when the lab only needs JSON attributes.

Update `.env.local`:

```bash
STABLE_AUDIO_ASSESSOR_COMMAND=uv run --with torch --with torchvision --with transformers --with accelerate --with soundfile --with librosa --with qwen-omni-utils python scripts/audio_assessor_qwen_omni.py
STABLE_AUDIO_ASSESSOR_TIMEOUT_MS=900000
QWEN_OMNI_MODEL=Qwen/Qwen2.5-Omni-7B
QWEN_OMNI_MAX_AUDIO_SECONDS=120
```

Restart the Next.js server after changing these values. The first assessment may take a while because `uv` resolves Python packages and Hugging Face downloads the model weights.

### Configure YouTube reference extraction

The Reference track panel can analyze YouTube audio without adding it to `public/outputs/`. Paste a YouTube URL, drag a browser link into the panel, or drop a supported local audio file. YouTube URLs call `/api/assess/youtube`, which runs a **deterministic `yt-dlp` + `ffmpeg` subprocess** (fixed argument array, no LLM/agent), writes a temporary MP3 under `.stable-audio-assessments/uploads/`, runs the configured audio assessor, builds a generation prompt, and deletes the temporary audio. This replaced an earlier autonomous Codex-based extraction that is no longer used.

Install the extraction tools if they are missing:

```bash
which yt-dlp >/dev/null 2>&1 || brew install yt-dlp
which ffmpeg >/dev/null 2>&1 || brew install ffmpeg
```

Optional `.env.local` overrides:

```bash
STABLE_AUDIO_YOUTUBE_YTDLP_BIN=yt-dlp          # yt-dlp binary (default yt-dlp)
STABLE_AUDIO_YOUTUBE_TIMEOUT_MS=300000         # extraction timeout (ms, default 300000)
# Legacy alias still honored for existing deployments:
# STABLE_AUDIO_YOUTUBE_CODEX_TIMEOUT_MS=300000
```

Only download and analyze media you have the rights to use.

## Environment Variables

This is the complete reference for every variable the app reads. Defaults are resolved centrally in `lib/server/config.ts` (TS) and in the Python scripts; `.env.example` mirrors this list with the same defaults.

### Variables are loaded in the following order, last one to set a var wins

* Host environment
* `.env.local`
* `.env.example` as documentation/default reference only
* UI settings for client-side persisted controls

### Generation core

| Variable | Default | Description |
| --- | --- | --- |
| `HF_TOKEN` | _(unset)_ | Optional Hugging Face token: higher optimized-MLX download limits; required for the gated standard Torch checkpoints after license acceptance. |
| `STABLE_AUDIO_MOCK` | `false` | `true` generates a fake WAV without loading the model (fast UI/API testing). Shipped as `true` in `.env.example` for safety. |
| `STABLE_AUDIO_PYTHON` | `python3` | Python interpreter for `scripts/generate_audio.py`. |
| `STABLE_AUDIO_BACKEND` | `mlx` | Real inference backend: `mlx` (recommended on Apple Silicon) or `torch`. |
| `STABLE_AUDIO_MLX_DIR` | `<REPO_ROOT>/vendor/stable-audio-3/optimized/mlx` | Optional override for the vendored MLX runtime directory. |
| `STABLE_AUDIO_TIMEOUT_MS` | `900000` (15m) | Generation/crop subprocess timeout, milliseconds. |
| `STABLE_AUDIO_MLX_TIMEOUT_MS` | `900000` | MLX-only timeout override; falls back to `STABLE_AUDIO_TIMEOUT_MS`. |

### Security, rate limit, and concurrency

| Variable | Default | Description |
| --- | --- | --- |
| `STABLE_AUDIO_ADMIN_TOKEN` | _(unset)_ | Optional shared-secret bearer token. When unset, all routes work unauthenticated (localhost/single-user mode). When set, mutating `/api/*` routes (POST/PUT/PATCH/DELETE) require `Authorization: Bearer <token>`; read-only GET routes (including `GET /api/radio` and `?stream=1`) are never gated. |
| `STABLE_AUDIO_MUTATING_RATE_PER_MINUTE` | `30` | Per-client token-bucket rate limit for mutating `/api/*` requests. `0` disables limiting. Fail-open on cold restart. |
| `STABLE_AUDIO_MAX_CONCURRENT` | `1` | Max heavy subprocesses (generation, crop, assessment) running at once. One shared generation slot is held across `/api/generate`, the radio queue, and assessments. |

### ffmpeg / ffprobe

| Variable | Default | Description |
| --- | --- | --- |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg binary path. Used for MP3 conversion, crop rendering, duration validation, radio transcoding, and as the `--ffmpeg-location` hint for yt-dlp when set to a real path. |
| `FFPROBE_PATH` | `ffprobe` | ffprobe binary path. Used for media-duration validation in crop and library flows. |

### Audio assessment

| Variable | Default | Description |
| --- | --- | --- |
| `STABLE_AUDIO_ASSESSOR_COMMAND` | Qwen2.5-Omni wrapper | Command that runs the audio-language assessor. |
| `STABLE_AUDIO_ASSESSOR_TIMEOUT_MS` | `300000` (5m) | Assessor subprocess timeout. Use `900000` for the first run (package + weight downloads). |
| `QWEN_OMNI_MODEL` | `Qwen/Qwen2.5-Omni-7B` | Hugging Face model id for the assessor. |
| `QWEN_OMNI_MAX_AUDIO_SECONDS` | `120` | Max audio duration (seconds) passed to the assessor after ffmpeg conversion. `0` sends the full file. |
| `QWEN_OMNI_MAX_NEW_TOKENS` | `768` | Max generated tokens from the assessor. |
| `QWEN_OMNI_DTYPE` | `auto` | Torch dtype override for the assessor. |
| `QWEN_OMNI_DEVICE_MAP` | `auto` | `device_map` passed to the assessor. |

### YouTube reference extraction

| Variable | Default | Description |
| --- | --- | --- |
| `STABLE_AUDIO_YOUTUBE_YTDLP_BIN` | `yt-dlp` | yt-dlp binary for deterministic extraction (no LLM/agent). |
| `STABLE_AUDIO_YOUTUBE_TIMEOUT_MS` | `300000` (5m) | Extraction timeout. Honors the legacy alias `STABLE_AUDIO_YOUTUBE_CODEX_TIMEOUT_MS` for existing deployments. |

### Ollama (auto-title + radio prompt drafting)

| Variable | Default | Description |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | _(unset)_ | Full Ollama base URL override. Wins over the HOST/PORT composition. Pinned to loopback by default. |
| `OLLAMA_HOST` | `127.0.0.1` | Ollama host (used when `OLLAMA_BASE_URL` is unset). |
| `OLLAMA_PORT` | `11434` | Ollama port (used when `OLLAMA_BASE_URL` is unset). |
| `OLLAMA_TITLE_MODEL` | `phi4-mini` | Model used for AI title generation via `/api/generate-title`. |

### Radio station

| Variable | Default | Description |
| --- | --- | --- |
| `RADIO_CODEX_BIN` | `codex` | Codex CLI used for taste distillation and style drafting. |
| `RADIO_CODEX_TASTE_MODEL` | _(unset)_ | Model override for taste distillation. |
| `RADIO_CODEX_STYLE_MODEL` | _(unset)_ | Model override for style drafting (falls back to the taste model). |
| `RADIO_CODEX_TASTE_TIMEOUT_MS` | `120000` (2m) | Timeout for a Codex taste/style run. |
| `RADIO_OLLAMA_TIMEOUT_MS` | `120000` | Timeout for the radio queue's Ollama prompt-draft call. |
| `RADIO_OLLAMA_MODELS_TIMEOUT_MS` | `1000` | Timeout for the Ollama `/api/tags` model-list probe in `GET /api/radio`. |
| `RADIO_QUEUE_AUTO_FILL` | _(runs)_ | Set to `false` to disable the background queue auto-fill loop. |
| `RADIO_LAN_HOST` | _(unset)_ | Explicit LAN host for stream/playlist URLs. Fallbacks: `RADIO_LAN_HOST` > `LAN_IP` > detected LAN IP. |
| `LAN_IP` | _(unset)_ | LAN IP fallback for stream URLs when `RADIO_LAN_HOST` is unset. |
| `RADIO_PUBLIC_ORIGIN` | _(unset)_ | Public origin (e.g. `https://radio.pardev.net`) advertised as a public stream URL in `GET /api/radio`. |

### Radio TTS (DJ announcements)

The TTS pipeline is provided by the local `par-tts-core-ts` package, which is **not** declared as a `package.json` dependency (it lives out-of-tree and is unpublished). Announcements are skipped (and the failure logged) when the module path is unset, so the stream never crashes on a missing module.

| Variable | Default | Description |
| --- | --- | --- |
| `RADIO_TTS_MODULE_PATH` | _(unset)_ | Path to the par-tts-core-ts CommonJS entry (provider TTS: openai / elevenlabs / deepgram / gemini). |
| `RADIO_TTS_NODE_MODULE_PATH` | _(unset)_ | Path to the Kokoro ONNX node entry. |
| `RADIO_TTS_MODEL` | _(unset)_ | Optional model id passed through to the TTS pipeline. |
| `PAR_TTS_CONFIG_PATH` | _(unset)_ | Optional path to a par-tts YAML config file (an alternative place for provider keys/voices). |

Provider TTS API keys are resolved from `.env.local` / the process environment **only** (resolution order: `PAR_TTS_CONFIG_PATH` file, then the env vars below). Kokoro needs no key.

| Variable | Description |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI TTS provider key. |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS provider key. |
| `DEEPGRAM_API_KEY` / `DG_API_KEY` | Deepgram TTS provider key (`DG_API_KEY` is an alias). |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Gemini TTS provider key (`GOOGLE_API_KEY` is an alias). |

> **Security:** Put provider keys in this app's own `.env.local`. Do not rely on shared developer credential files such as `~/.claude/.env`.

### Dev server

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3007` | Port the Next.js dev/app server listens on. |
| `DEV_SERVER_RESTART_DELAY_MS` | _(unset)_ | `scripts/dev-server.mjs`: delay before restarting after a crash. |

## Running Stable Audio 3 Lab

From the repo root:

```bash
npm run dev
```

Then open:

```text
http://localhost:3007
```

## Pardora iOS App

Pardora is the native iOS companion app for the radio stream. It lives in `apps/pardora-ios/` and uses the existing `/api/radio` JSON contract plus the MP3 stream URL. The app target includes a generated launch screen so it runs full screen on modern iPhones, and `make pardora-run` switches the booted Simulator to dark appearance before launch.

Useful commands:

```bash
make pardora-generate
make pardora-build
make pardora-test
make pardora-checkall
make pardora-run
```

## Radio station

Alongside the generation lab, the app runs a **continuous AI radio station**: an autonomous queue of generated tracks, DJ announcements, listener taste feedback, and a live MP3 stream consumed by the Pardora iOS/watchOS/CarPlay companion and any LAN music player. It is the reason Pardora exists.

Open the station UI at `http://localhost:3007/radio`. The page shows the current track, the live queue, station styles, the taste profile, and controls for skipping, rating, and drafting new tracks. The same data is available as JSON for clients via `GET /api/radio` (see [API reference](./docs/reference/api.md) for the full contract).

### Opening the station

The lab page (`/`) is the generation workspace; the station lives at `/radio`:

```text
http://localhost:3007/radio          # station UI (browser)
http://localhost:3007/api/radio      # JSON: queue, current track, stream URLs, taste profile, stats
http://localhost:3007/api/radio?stream=1   # continuous MP3/ICY stream (what players tune in to)
```

### Stream and playlist URLs

The station advertises two stream endpoints in `GET /api/radio`:

* **LAN stream** — the MP3 stream on your local network (`http://<lan-host>:3007/api/radio?stream=1`). The LAN host resolves via `RADIO_LAN_HOST` > `LAN_IP` > a detected LAN IP.
* **Public stream** — advertised only when `RADIO_PUBLIC_ORIGIN` is set (for example `https://radio.pardev.net`), so you can publish the station through a tunnel.

Playlist wrappers are served for players that prefer them:

```text
http://<host>:3007/radio.m3u         # audio/x-mpegurl playlist pointing at the stream
http://<host>:3007/radio.pls         # audio/x-scpls playlist pointing at the stream
```

### DJ announcements (multi-provider TTS)

Between tracks the station generates DJ announcements through a configurable TTS pipeline backed by the local `par-tts-core-ts` package (declared as an out-of-tree module, not a `package.json` dependency). Supported providers are `openai`, `elevenlabs`, `deepgram`, `gemini`, and `kokoro-onnx`. Configure it with `RADIO_TTS_MODULE_PATH` (or `RADIO_TTS_NODE_MODULE_PATH` for Kokoro) plus the relevant provider key. When the module path is unset the station runs without announcements — the stream never crashes on a missing module, the skip is logged.

> **Security:** Put provider TTS keys in this app's own `.env.local`, not in shared developer credential files such as `~/.claude/.env`. See the [Radio TTS](#radio-tts-dj-announcements) env-var table.

### Taste profile

Thumbs-up and thumbs-down ratings on tracks are batched into a `RadioTasteProfile`. Periodically that profile is distilled (via the Codex CLI) into guidance that rewrites future generation prompts, so the station slowly leans toward what you keep and away from what you skip. Set `RADIO_CODEX_BIN`, `RADIO_CODEX_TASTE_MODEL`, and `RADIO_CODEX_STYLE_MODEL` to control the distillation; `RADIO_CODEX_TASTE_TIMEOUT_MS` bounds each run.

### Queue and auto-fill model

The station keeps a queue of upcoming tracks in an atomic, locked state file (`.stable-audio-radio/state.json`) so concurrent requests and the background loop never tear a write. A background auto-fill loop keeps the queue stocked: when it runs low, the loop drafts a prompt (via Ollama), generates a fresh track (sharing the single generation slot with `/api/generate` and assessments), and enqueues it. If generation is unavailable or the slot is busy, it falls back to existing library tracks so the station never goes silent.

Tune the loop with:

* `RADIO_QUEUE_AUTO_FILL` — set to `false` to disable background auto-fill.
* `STABLE_AUDIO_MAX_CONCURRENT` — caps how many heavy subprocesses run at once (default `1`); the radio queue waits for the same slot generation uses.
* `RADIO_OLLAMA_TIMEOUT_MS` / `RADIO_OLLAMA_MODELS_TIMEOUT_MS` — timeouts for the prompt-draft call and the Ollama model-list probe.

### Station actions

Mutating controls (skip, rate, delete track, create/update/delete custom styles, configure TTS voice/provider, draft a track, clean up) are sent as `POST /api/radio` with an `{ action, ...payload }` envelope. When `STABLE_AUDIO_ADMIN_TOKEN` is set these mutating actions require the bearer token; the read-only `GET /api/radio` JSON and the `?stream=1` MP3 stream are always public so players and Pardora can tune in without credentials. See the [API reference](./docs/reference/api.md) for every action and its payload.

## Quick start music workflow

* Start Stable Audio 3 Lab.
* Select **Music** mode.
* Choose **Small Music** for fast sketches or **Medium** for higher-quality passes.
* Pick MP3 for shareable output or WAV for raw/editable output.
* Optionally drop an MP3/WAV/M4P reference track, paste a YouTube URL, or drag a browser link into the Reference track panel to populate the prompt from analyzed audio.
* Enter a musical prompt such as tempo, genre, instruments, mix style, and mood.
* Use the prompt template drawers for loops, ambience, trailer hits, or music beds when you want a fast starting point.
* Start around 8 steps and CFG 1–2.
* Set **Batch variations** above 1 to run multiple variations; with a fixed seed, each pass increments the seed and the whole run gets a shared batch ID.
* Click **Generate MP3** or **Generate WAV**.
* Preview the render in-browser and inspect the Wave/Spec audio analysis panel.
* Download the keeper, star it, add notes/ratings, export a single-file bundle, export the full `Run ZIP`, or use **Load config** from the Library to iterate.

## Quick start SFX workflow

* Start Stable Audio 3 Lab.
* Select **Sound FX** mode or click **Small SFX**.
* Describe the object, action, material, space, and tail.
* Use the Foley, UI Stings, Trailer Hits, or Ambience templates when you want a strong first draft.
* Keep duration short for Foley/UI sounds, usually 1–8 seconds.
* Start with 4–8 steps for quick drafts.
* Generate, preview, inspect Wave/Spec analysis, and download the result.
* Use the Library to compare variations, star keepers, add notes/ratings, export single items or whole variation-run bundles, and delete cursed noises before they multiply.

## Reproducible seeds

The **Seed** field is optional:

* Leave it blank for random generation (`-1` is passed to Stable Audio 3).
* Set a number to reuse the same seed.
* Use **Random** to generate a seed and lock it into the settings.
* Use **Clear** to return to random generation.
* Use **Load config** on a library item to reload its prompt/settings/seed for another pass.

Diffusion reproducibility is best-effort: use the same model, prompt, negative prompt, duration, steps, CFG, seed, backend, and library version for the closest repeat.

## Titles and auto-title

Every generation can carry a human-readable **title** that becomes the output filename, so your library fills up with `neon_pulse.mp3` instead of `sa3-music-1718123456.mp3`. Title resolution, in priority order:

1. **`title`** — an explicit title you type. It is slugified into the filename (e.g. `"Neon Pulse"` → `neon_pulse.mp3`). Duplicates get a `_2`, `_3` suffix so nothing is overwritten.
2. **`autoTitle`** — when no explicit title is given, the server asks a local **Ollama** model (phi4-mini by default) to invent a creative title from your prompt, then slugifies that.
3. **Fallback** — if neither is set (or Ollama is unavailable), the filename falls back to `sa3-{mode}-{timestamp}.{format}`.

This requires **Ollama running locally** (`OLLAMA_HOST`/`OLLAMA_PORT`, default `127.0.0.1:11434`). Tune the model with `OLLAMA_TITLE_MODEL`. The `/api/generate-title` endpoint exposes the same capability directly — send a prompt, get back a title. See the [API reference](./docs/reference/api.md) for the request shape.

Quick start with a title:

```bash
curl -X POST http://localhost:3007/api/generate \
  -H 'content-type: application/json' \
  -d '{"prompt":"lofi hip hop loop, dusty drums, 82 BPM","mode":"music","model":"medium","duration":60,"title":"Dusty Afternoon"}'
```

Or let the server name it:

```bash
curl -X POST http://localhost:3007/api/generate \
  -H 'content-type: application/json' \
  -d '{"prompt":"hydraulic spaceship door, metallic rumble","mode":"sfx","model":"small-sfx","duration":6,"autoTitle":true}'
```

## Output and metadata

Generated files live under `public/outputs/` and are intentionally ignored by git.

For each audio file, the app writes a JSON sidecar beside it:

```text
public/outputs/sa3-sfx-123.mp3
public/outputs/sa3-sfx-123.mp3.json
```

Metadata includes:

* output filename and URLs
* creation time
* generation runtime in milliseconds
* backend (`mlx` or `torch`)
* favorite/star state
* optional notes and 1–5 star rating annotations
* prompt and negative prompt
* mode, model, duration, steps, CFG, format, mock/real mode
* seed, when present
* batch run ID and variation index/count, when generated as a multi-variation run
* crop provenance, when a file was trimmed from another render
* Python process stdout/stderr tail

The Library UI can download the audio, download the JSON metadata, export an audio+metadata bundle, export a whole variation-run ZIP, star keepers, add notes/ratings, crop shorter clips, load metadata back into the settings panel, play and seek directly from the waveform, inspect waveform/spectrogram previews, or delete both files after confirmation.

### Waveform library player

Library rows hide the native browser audio chrome and use the Wave panel as the primary player surface. The player keeps listening and editing controls together:

* **Play/Pause** beside the crop controls.
* **Per-item volume** slider for A/B listening without changing global defaults.
* **Click-to-seek waveform** with clamped pointer-to-time mapping.
* **Cyan playback playhead** with a timestamp that follows the hidden `<audio>` element.
* **Orange crop selection** with dimmed out-of-range regions and live start/end labels.

Notes and ratings intentionally sit below this player/crop area so annotation does not interrupt playback or crop selection.

### Notes, ratings, and batch exports

Each library item has a **Notes & rating** panel. Notes are trimmed, capped at 1000 characters, and ratings are optional 1–5 star values. Saving annotations updates only the JSON sidecar; the source audio is untouched.

Batch generation assigns all variations in a single UI run the same `batch.batchRunId` plus `variationIndex` and `variationCount`. Any item from that run shows a **Run ZIP** button that downloads the entire variation set:

```bash
curl -L "http://localhost:3007/api/library/bundle?batchRunId=batch-20260521-abc123" \
  -o batch-20260521-abc123.variation-run.zip
```

The run ZIP contains every matching audio file, its `.json` sidecar, per-item analysis summaries, per-render `*.render-screenshot.svg` capture cards, and a `<batchRunId>.manifest.json` that lists variations in deterministic order.

Single-item bundles include the same visual capture card beside the audio, metadata, and analysis summary:

```text
sa3-music-123.mp3
sa3-music-123.mp3.json
sa3-music-123.analysis-summary.json
sa3-music-123.render-screenshot.svg
```

### Audio cropping

Every library item includes a **Crop audio** panel with start/end sliders. The native browser media chrome is hidden in the library; the waveform is the player. It includes Play/Pause, one global volume slider shared by all items, click-to-seek behavior, keyboard seeking with arrow keys/PageUp/PageDown/Home/End, surfaced playback-permission errors if the browser rejects `play()`, an orange selected-region overlay, dimmed out-of-crop audio, live start/end labels, and a cyan playback playhead. Notes and ratings sit below the waveform player so the listening/cropping controls stay together. Cropping never mutates the source file; it creates a new sibling clip plus metadata sidecar:

```text
public/outputs/sa3-sfx-123.mp3
public/outputs/sa3-sfx-123.crop-0p000-1p000.mp3
public/outputs/sa3-sfx-123.crop-0p000-1p000.mp3.json
```

The crop endpoint is available for automation and validates requested windows against the actual source media duration using `ffprobe` before calling `ffmpeg`:

```bash
curl -X POST http://localhost:3007/api/library/crop \
  -H 'content-type: application/json' \
  -d '{"filename":"sa3-sfx-123.mp3","start":0,"end":1}'
```

Crop metadata keeps source lineage (`sourceFilename`, source URLs, and `crop.start/end/duration`) and updates the reusable `settings.duration` to the trimmed clip length so follow-up crops stay inside the derived clip.

## Audio assessment

The **Assess** buttons (in the Library, on the radio page, and in the YouTube reference flow) run a local audio-language model over a track and store structured attributes — genre, mood, instrumentation, tempo, energy — in the metadata sidecar's `analysis` block. The first supported assessor is Qwen2.5-Omni-7B via `scripts/audio_assessor_qwen_omni.py`, configured by `STABLE_AUDIO_ASSESSOR_COMMAND`.

### Persisted, load-throttled queue

Assessment is expensive, so the lab runs it through a single shared queue that all three flows (Library, Radio, YouTube) submit jobs to:

* **Persisted** — the queue lives in `.stable-audio-assessments/queue.json`, so pending jobs survive dev-server restarts.
* **Load-throttled** — when the machine is busy (high load average), the processor waits rather than spawning the assessor. The threshold is a **code constant** (`AUDIO_ASSESSMENT_LOAD_THRESHOLD` in `lib/audio-assessment.ts`), not an environment variable — tune it in source, not `.env.local`.
* **Dead-letter on poison jobs** — a job that fails repeatedly is capped and dropped to a dead-letter state rather than re-queued forever, so one bad file cannot starve the queue.
* **Shared generation slot** — assessment subprocesses respect the same `STABLE_AUDIO_MAX_CONCURRENT` cap as generation, preventing memory exhaustion from concurrent model runs.

Assessment results are summarized into a sibling `*.analysis-summary.json` and included in export bundles.

## Useful commands

```bash
npm run dev        # serve on port 3007
npm run test       # Vitest unit tests
npm run build      # production build + TypeScript check
npm run typecheck  # TypeScript only
npm run py:mock    # generate public/outputs/mock.wav from CLI

make checkall      # test + build + Python unittest
make typecheck     # TypeScript only
make pre-commit    # run pre-commit hooks on all files
make pre-commit-install # install pre-commit and pre-push git hooks
```

## Project layout

```text
app/
  page.tsx                       # Generation lab UI (the "/" page)
  layout.tsx                     # Root layout
  radio/
    page.tsx                     # Radio station UI entry
    RadioStationClient.tsx       # Radio station client component
  api/
    generate/route.ts            # POST /api/generate → Python bridge
    generate-title/route.ts      # POST /api/generate-title → Ollama
    library/route.ts             # GET / PATCH / DELETE /api/library
    library/bundle/route.ts      # GET /api/library/bundle (single + batch ZIP)
    library/crop/route.ts        # POST /api/library/crop → ffmpeg
    assess/route.ts              # POST /api/assess → assessor subprocess
    assess/upload/route.ts       # POST /api/assess/upload (temp reference upload)
    assess/youtube/route.ts      # POST /api/assess/youtube → yt-dlp + ffmpeg
    radio/route.ts               # GET /api/radio (JSON + ?stream=1) and POST actions
  radio.m3u/route.ts             # M3U playlist for the stream
  radio.pls/route.ts             # PLS playlist for the stream
proxy.ts                    # Opt-in bearer-token auth (STABLE_AUDIO_ADMIN_TOKEN)
docs/                            # Documentation (style guide, reference, architecture, troubleshooting, specs)
  DOCUMENTATION_STYLE_GUIDE.md
  reference/api.md               # HTTP API reference
  architecture/system-overview.md
  troubleshooting/common-errors.md
  superpowers/                   # Historical design specs and plans
lib/
  generation.ts                  # Zod request schema, model metadata, GENERATION_LIMITS
  generation-batch.ts            # Batch/seed variation helpers
  generator-backend.ts           # MLX/Torch backend routing, model→MLX mapping
  library.ts                     # Metadata sidecars, slugification, ZIP builder, crop, SVG cards
  metadata-settings.ts           # Metadata → reusable UI settings ("Load config")
  audio-assessment.ts            # Shared assessor provider contract + persisted queue
  assessment-prompt.ts           # Assessor JSON attributes → music prompt
  radio-playlist-response.ts     # /api/radio playlist response shape
  ui-presets.ts                  # UI copy (control tips, prompt template groups)
  radio/                         # Pure radio domain (barrel: types, styles, state, prompts, tts, urls)
  server/                        # Impure orchestration (extracted from the radio route)
    radio-state-store.ts         # Atomic, locked radio state persistence
    radio-queue-service.ts       # Queue maintenance + auto-fill
    radio-stream.ts              # MP3/ICY stream serving
    radio-tts.ts                 # Multi-provider DJ announcements
    radio-actions.ts             # Zod schema for POST /api/radio actions
    codex-client.ts              # Codex subprocess for taste/style drafting
    ollama.ts                    # Ollama client + generateTitle/cleanTitle
    subprocess.ts                # Shared process runner (SIGTERM→SIGKILL)
    concurrency.ts               # Single generation-slot semaphore
    atomic-json-store.ts         # Temp-file + rename JSON store
    config.ts                    # Centralized env-var readers + defaults
    logger.ts
scripts/
  generate_audio.py              # Python bridge: mock WAV + real MLX/Torch inference
  audio_assessor_qwen_omni.py    # Qwen2.5-Omni-7B assessor subprocess
  dev-server.mjs                 # Dev-server watchdog/restart helper
tests/
  test_generate_audio.py         # Python unittests (process cleanup, backend normalize)
  test_audio_assessor_qwen_omni.py
skills/
  stable-audio/                  # Agent skill: generate SFX/music via the local API
  youtube-audio-extract/         # yt-dlp + ffmpeg extraction used by /api/assess/youtube
apps/
  pardora-ios/                   # Swift 6 iOS/watchOS/CarPlay companion (xcodegen)
vendor/stable-audio-3/           # Official Stability AI repo + MLX weights/runtime (gitignored)
public/outputs/                  # Runtime audio + .json sidecars (ignored except .gitkeep)
.stable-audio-radio/             # Radio state (queue/taste/styles) — atomic JSON (gitignored)
.stable-audio-assessments/       # Temp reference MP3s + persisted assessor queue (gitignored)
CHANGELOG.md                     # Release history (Keep a Changelog)
CONTRIBUTING.md                  # Contributor guide
RESEARCH.md                      # Model-family notes and M4 Max fit verdict
```

## Architecture

For a system-level overview with data-flow diagrams of the generation, assessment, and radio paths, see [`docs/architecture/system-overview.md`](./docs/architecture/system-overview.md). In short: a pure functional core (`lib/`) is driven by Next.js API routes and `lib/server/` services; generation and assessment spawn Python subprocesses that write audio and sidecars under `public/outputs/`; the radio station maintains an atomic state file and streams MP3 segments to Pardora and LAN listeners.

## Research

See [`RESEARCH.md`](./RESEARCH.md) for the Stable Audio 3 model-family notes and M4 Max fit verdict.

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full guide: environment setup, the `make checkall` / `make typecheck` / `make test` gates, the no-formatter/typecheck-only stance, Conventional Commits, pre-commit hooks, and the PR process. The short version: run the quality gates before committing.

```bash
make checkall
make pre-commit
```

## Troubleshooting

Common failure modes (gated-model 401s, missing `ffmpeg`/`ffprobe`/`yt-dlp`, Ollama down, assessor first-run timeouts, MLX download failures, port 3007 conflicts, auth-token misconfig, silent radio TTS) with diagnosis and fixes are in [`docs/troubleshooting/common-errors.md`](./docs/troubleshooting/common-errors.md).

## FAQ

* Q: Does this require Docker?
  * A: No. The intended local path is Next.js + Python + MLX on Apple Silicon.
* Q: Does this run without the gated models?
  * A: Yes. Mock mode works without downloaded weights and is useful for UI testing.
* Q: Which backend should I use on an M4 Max?
  * A: MLX. It is the default and supports Small Music, Small SFX, and Medium through Stability's optimized weights.
* Q: Why are generated files ignored by git?
  * A: Audio outputs and metadata are runtime artifacts. Keepers should be exported/downloaded, not committed by accident.
* Q: Are raw screenshot links supposed to work immediately?
  * A: They resolve after this repo is pushed to `github.com/paulrobello/stable-audio-3-lab` on the `main` branch.

## Roadmap

### Where we are

* **Waveform and Spectrogram Analysis** - Browser-side audio previews show Wave/Spec visualization panels for latest and library renders, with downloadable PNG snapshots and richer spectrogram bins.
* **Batch Variation Workflow** - Generate up to 8 variations from the same prompt; fixed seeds increment deterministically and selected renders can be compared side by side.
* **Favorite Keepers** - Starred library renders persist favorite state in metadata sidecars and can be filtered in the library.
* **Prompt Template Drawers** - Foley, UI stings, loops, trailer hits, ambience, and music bed templates are built into the prompt UI.
* **Reference Track Analysis** - Local audio drops, YouTube URL paste, and dragged browser links can be analyzed into reusable music prompts without adding source audio to the generated library.
* **Export Bundles** - Library rows can export a `.bundle.zip` with audio, metadata, an analysis summary, and a rendered screenshot card for sharing experiments.
* **Waveform Library Player** - Native media chrome is hidden in library rows; the waveform provides Play/Pause, global volume, click/keyboard seeking, crop markers, playback-error feedback, and a live cyan playhead.
* **Audio Cropping** - Library rows can trim clips into new audio files with metadata preserving source/crop lineage.
* **Notes, Ratings, and Batch Run ZIPs** - Library sidecars store annotations, and multi-variation runs export as deterministic bundle ZIPs with manifests.
* **Music and SFX Generation** - Local browser workflow for both music and sound effects.
* **Full MLX Backend** - All UI models route through the official Apple Silicon optimized runtime by default.
* **Library Management** - Playback, search, favorite filtering, comparison selection, download, metadata download, config reload, refresh, and delete.
* **Settings Persistence** - Mode, model, prompt, negative prompt, duration, steps, CFG, format, seed, mock mode, and volume persist locally.
* **Safety Controls** - Timeout handling and process-tree cleanup for MLX generation.
* **Testing and Git Hooks** - Unit tests, build checks, Python tests, and pre-commit hooks are wired.
* **Continuous AI Radio Station** - An autonomous station at `/radio` with a live queue, atomic locked state, DJ announcements (multi-provider TTS), listener taste-profile distillation, LAN + public MP3 streaming, and M3U/PLS playlists.
* **Pardora iOS/watchOS/CarPlay Companion** - A native Swift 6 app consuming the `/api/radio` JSON + MP3 stream, with a Live Activity extension and TestFlight workflow.
* **Audio Assessment** - A local audio-language model (Qwen2.5-Omni-7B) extracts structured track attributes into metadata sidecars via a persisted, load-throttled, dead-lettering queue shared by Library, Radio, and YouTube flows.
* **Security and Concurrency Hardening** - Opt-in bearer-token auth on mutating routes, a shared generation-slot concurrency cap, per-client rate limiting, and deterministic yt-dlp YouTube extraction.

### Where we're going

* **Reference streaming for many listeners** - Today the stream assumes a small number of LAN listeners; a single station "ticker" owning state advancement would make public streaming robust beyond a household.
* **Client component decomposition** - The lab and radio pages are large single-file components; splitting them into focused panel components and hooks will reduce re-render risk and merge friction.
* **Stricter validation across the radio RPC** - Promote the radio POST actions to a fully Zod-validated discriminated union surfaced as the shared Pardora contract.
* **CI pipeline** - Run `make checkall` in CI to catch environment-coupled regressions across machines.
* **Polish and ergonomics** - Lint/format adoption, expanded route/component test coverage, and continued documentation accuracy work.

## What's new

Release history lives in [`CHANGELOG.md`](./CHANGELOG.md) (Keep a Changelog format). The current unreleased work covers the radio subsystem (radio page, atomic state store, queue auto-fill, taste distillation, multi-provider TTS, LAN/public streaming, M3U/PLS playlists), the Pardora iOS companion, audio assessment, and the security/concurrency hardening pass. See the changelog for the per-version detail rather than duplicating it here.
