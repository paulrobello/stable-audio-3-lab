# Stable Audio 3 Lab

A local dark-mode Next.js lab for testing Stability AI's Stable Audio 3 open-weight models for music and sound-effect generation on Paul's M4 Max MacBook Pro.

The app gives you a browser UI for prompt iteration, model/settings control, in-browser playback, generated-audio history, sidecar metadata, and reproducible-ish seed workflows. Mock mode is included so the whole UI/API/Python/audio loop can be tested without waking the model goblin.

## What it does

- Generates music or sound effects through a Next.js API route and Python bridge.
- Supports Stable Audio 3 Small SFX, Small Music, and Medium model selections.
- Defaults to MP3 output, with WAV available for raw/editable renders.
- Provides controls for prompt, negative prompt, duration, steps, CFG, format, model, mock mode, and seed.
- Supports fixed seeds for repeatable iteration; blank seed means random generation.
- Persists UI settings in `localStorage` under `stable-audio-3-lab:settings:v1`.
- Writes sidecar metadata next to each output file, including prompt/settings, seed, Python output, and generation runtime.
- Lists previous renders in a Library with playback, download, metadata download, config reload, and confirmed delete.
- Deletes both audio and metadata sidecar files when a library item is removed.

## Project layout

```text
app/
  api/generate/route.ts    # POST endpoint that calls scripts/generate_audio.py
  api/library/route.ts     # GET/DELETE endpoint for generated audio library
  page.tsx                 # Main browser UI
lib/
  generation.ts            # Request schema, model metadata, prompt presets, tips
  library.ts               # Output/metadata sidecar helpers
  metadata-settings.ts     # Metadata → reusable UI settings parser
scripts/
  generate_audio.py        # Python bridge for mock and real Stable Audio 3 generation
public/outputs/            # Runtime audio + .json sidecars; ignored except .gitkeep
RESEARCH.md                # Research notes and M4 Max fit verdict
```

## Quick start

```bash
cd ~/Repos/stable-audio-3-lab
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3007>.

By default, `.env.example` sets `STABLE_AUDIO_MOCK=true`, which lets the UI produce simple generated audio with only Python stdlib. It is intentionally cheesy, but very useful for verifying the full browser → API → Python → file → playback loop.

## Real Stable Audio 3 inference

The standard Stable Audio 3 Hugging Face repos are gated. Accept the license terms first:

- <https://huggingface.co/stabilityai/stable-audio-3-small-sfx>
- <https://huggingface.co/stabilityai/stable-audio-3-small-music>
- <https://huggingface.co/stabilityai/stable-audio-3-medium>

Then install the official library in the vendored location used by this project:

```bash
cd ~/Repos/stable-audio-3-lab
git clone https://github.com/Stability-AI/stable-audio-3.git vendor/stable-audio-3
cd vendor/stable-audio-3
uv sync
uv run hf auth login
```

Download weights with Paul's preferred Hugging Face downloader:

```bash
hfdownloader download stabilityai/stable-audio-3-small-sfx
hfdownloader download stabilityai/stable-audio-3-small-music
# Optional / experimental on Mac:
hfdownloader download stabilityai/stable-audio-3-medium
```

Update `.env.local`:

```bash
STABLE_AUDIO_MOCK=false
STABLE_AUDIO_PYTHON=/Users/probello/Repos/stable-audio-3-lab/vendor/stable-audio-3/.venv/bin/python
STABLE_AUDIO_TIMEOUT_MS=900000
```

Then start the app and turn off **Mock mode** in the UI if needed.

## Reproducible seeds

The **Seed** field is optional:

- Leave it blank for random generation (`-1` is passed to Stable Audio 3).
- Set a number to reuse the same seed.
- Use **Random** to generate a seed and lock it into the settings.
- Use **Clear** to return to random generation.
- Use **Load config** on a library item to reload its prompt/settings/seed for another pass.

Diffusion reproducibility is best-effort: use the same model, prompt, negative prompt, duration, steps, CFG, seed, backend, and library version for the closest repeat.

## Output and metadata

Generated files live under `public/outputs/` and are intentionally ignored by git.

For each audio file, the app writes a JSON sidecar beside it:

```text
public/outputs/sa3-sfx-123.mp3
public/outputs/sa3-sfx-123.mp3.json
```

Metadata includes:

- output filename and URLs
- creation time
- generation runtime in milliseconds
- prompt and negative prompt
- mode, model, duration, steps, CFG, format, mock/real mode
- seed, when present
- Python process stdout/stderr tail

The Library UI can download the audio, download the JSON metadata, load metadata back into the settings panel, or delete both files after confirmation.

## Useful commands

```bash
npm run dev        # serve on port 3007
npm run test       # Vitest unit tests
npm run build      # production build + TypeScript check
npm run py:mock    # generate public/outputs/mock.wav from CLI

make checkall      # test + build
make typecheck     # TypeScript only
make pre-commit    # run pre-commit hooks on all files
make pre-commit-install # install pre-commit and pre-push git hooks
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `HF_TOKEN` | Optional Hugging Face token for gated repos / auth flows. |
| `STABLE_AUDIO_MOCK` | `true` to force mock generation; `false` for real model inference. |
| `STABLE_AUDIO_PYTHON` | Python executable with `stable-audio-3` installed. Defaults to `python3`. |
| `STABLE_AUDIO_TIMEOUT_MS` | Generation timeout for the API route. Defaults to 900000ms. |

## Git hygiene

This repo intentionally does **not** commit:

- `.env*` local config or tokens
- `node_modules/`
- `.next/`
- `vendor/` Stable Audio 3 clone and Python environment
- downloaded model weights (`*.safetensors`, `*.ckpt`, `*.pt`, `*.pth`, `*.onnx`, `*.gguf`)
- generated audio and metadata under `public/outputs/`
- local agent/editor state from the git/CI guide

## Research

See [`RESEARCH.md`](./RESEARCH.md) for the Stable Audio 3 model-family notes and M4 Max fit verdict.
