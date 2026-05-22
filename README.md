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
  * [Download MLX weights](#download-mlx-weights)
  * [Configure real inference](#configure-real-inference)
* [Environment Variables](#environment-variables)
* [Running Stable Audio 3 Lab](#running-stable-audio-3-lab)
* [Quick start music workflow](#quick-start-music-workflow)
* [Quick start SFX workflow](#quick-start-sfx-workflow)
* [Reproducible seeds](#reproducible-seeds)
* [Output and metadata](#output-and-metadata)
* [Useful commands](#useful-commands)
* [Project layout](#project-layout)
* [Research](#research)
* [Contributing](#contributing)
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
* `hfdownloader` for Hugging Face model downloads.
* A Hugging Face account with Stability's gated model terms accepted for real inference.

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

The MLX path uses `stabilityai/stable-audio-3-optimized` and avoids the CUDA/FlashAttention requirements of the standard PyTorch Medium checkpoint. On Paul's M4 Max, this is the happy path.

### Accept gated model terms

Accept the license terms on Hugging Face first:

* <https://huggingface.co/stabilityai/stable-audio-3-small-sfx>
* <https://huggingface.co/stabilityai/stable-audio-3-small-music>
* <https://huggingface.co/stabilityai/stable-audio-3-medium>
* <https://huggingface.co/stabilityai/stable-audio-3-optimized>

### Install the official Stable Audio 3 repo

```bash
cd ~/Repos/stable-audio-3-lab
git clone https://github.com/Stability-AI/stable-audio-3.git vendor/stable-audio-3
cd vendor/stable-audio-3
uv sync
uv run hf auth login
```

### Install the MLX runtime

```bash
cd ~/Repos/stable-audio-3-lab/vendor/stable-audio-3/optimized/mlx
./install.sh -y --download ''
```

### Download MLX weights

Use Paul's preferred Hugging Face downloader:

```bash
cd ~/Repos/stable-audio-3-lab/vendor/stable-audio-3/optimized/mlx
hfdownloader download stabilityai/stable-audio-3-optimized \
  --local-dir ./hf-optimized \
  --max-active 4 \
  -c 8 \
  -F MLX \
  -E onnx,tensorRT,Thumbnail
```

Expose those files where the MLX runtime expects them:

```bash
python3 - <<'PY'
from pathlib import Path
mlx = Path('/Users/probello/Repos/stable-audio-3-lab/vendor/stable-audio-3/optimized/mlx')
src = mlx / 'hf-optimized/stabilityai/stable-audio-3-optimized/MLX'
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

Update `.env.local`:

```bash
STABLE_AUDIO_MOCK=false
STABLE_AUDIO_PYTHON=/Users/probello/Repos/stable-audio-3-lab/vendor/stable-audio-3/.venv/bin/python
STABLE_AUDIO_BACKEND=mlx
STABLE_AUDIO_TIMEOUT_MS=900000
```

`STABLE_AUDIO_BACKEND=mlx` is the default when unset. Set `STABLE_AUDIO_BACKEND=torch` only if you intentionally want to test the standard PyTorch backend.

## Environment Variables

### Variables are loaded in the following order, last one to set a var wins

* Host environment
* `.env.local`
* `.env.example` as documentation/default reference only
* UI settings for client-side persisted controls

### Environment Variables for Stable Audio 3 Lab configuration

* `HF_TOKEN` - Optional Hugging Face token for gated repos/auth flows.
* `STABLE_AUDIO_MOCK` - `true` to force mock generation; `false` for real model inference.
* `STABLE_AUDIO_PYTHON` - Python executable for the bridge script. Defaults to `python3`.
* `STABLE_AUDIO_BACKEND` - Real inference backend: `mlx` by default/recommended, or `torch` for the standard PyTorch path.
* `STABLE_AUDIO_MLX_DIR` - Optional override for the vendored MLX runtime directory.
* `STABLE_AUDIO_TIMEOUT_MS` - Generation timeout for the API route. Defaults to `900000` ms.

## Running Stable Audio 3 Lab

From the repo root:

```bash
npm run dev
```

Then open:

```text
http://localhost:3007
```

## Quick start music workflow

* Start Stable Audio 3 Lab.
* Select **Music** mode.
* Choose **Small Music** for fast sketches or **Medium** for higher-quality passes.
* Pick MP3 for shareable output or WAV for raw/editable output.
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
  api/generate/route.ts    # POST endpoint that calls scripts/generate_audio.py
  api/library/route.ts     # GET/PATCH/DELETE endpoint for generated audio library
  api/library/bundle/route.ts # Single-item and batch-run ZIP exports
  api/library/crop/route.ts   # FFmpeg crop endpoint
  page.tsx                 # Main browser UI
docs/
  music_mode.png           # README screenshot for Music mode
  sfx_mode.png             # README screenshot for Sound FX mode
lib/
  generation.ts            # Request schema, model metadata, prompt presets, tips
  generator-backend.ts     # Backend/model routing for MLX/Torch invocation
  library.ts               # Output/metadata sidecar helpers
  metadata-settings.ts     # Metadata → reusable UI settings parser
scripts/
  generate_audio.py        # Python bridge for mock and real Stable Audio 3 generation
public/outputs/            # Runtime audio + .json sidecars; ignored except .gitkeep
RESEARCH.md                # Research notes and M4 Max fit verdict
```

## Research

See [`RESEARCH.md`](./RESEARCH.md) for the Stable Audio 3 model-family notes and M4 Max fit verdict.

## Contributing

Use conventional commits and run the quality gates before committing:

```bash
make checkall
make pre-commit
```

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

### Where we're going

* Optional PNG export for the server-generated SVG render capture cards.

## What's new

### v0.1.0

* Initial Stable Audio 3 Lab app with Next.js UI, mock mode, real MLX inference, library management, metadata sidecars, seed controls, global playback volume, waveform/spectrogram previews, waveform-as-player library rows, keyboard seeking, playback-error feedback, stale playback-state pruning after refresh/delete, batch variations, comparison view, prompt templates, favorites, notes/ratings, crop controls, rendered screenshot cards in bundles, single-item bundles, batch-run ZIP exports, and README screenshots.
