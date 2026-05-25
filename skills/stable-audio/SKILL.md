---
name: stable-audio
description: Generate SFX and music using the local Stable Audio 3 server. Trigger on requests to generate audio, create sound effects, make music, or anything involving Stable Audio, SFX, or sound generation.
---

# Stable Audio 3 — Local Audio Generation

Generate audio files (SFX and music) via the local Stable Audio 3 Next.js API.

## Prerequisites

The dev server must be running on `http://localhost:3007`. The skill will auto-start it if needed.

## 1. Ensure the server is running

```bash
curl -sf http://localhost:3007 > /dev/null 2>&1 && echo "OK" || echo "DOWN"
```

If `DOWN`, start it from the project root:

```bash
cd /Users/probello/Repos/stable-audio-3-lab && make dev
```

Run the above with `run_in_background`, then wait for it to be ready:

```bash
until curl -sf http://localhost:3007 > /dev/null 2>&1; do sleep 2; done && echo "READY"
```

If the server doesn't respond within 30 seconds, stop and tell the user.

## 2. Generate audio

`POST http://localhost:3007/api/generate` with JSON body.

### Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `prompt` | string | **yes** | — | Description of desired audio (8–1000 chars) |
| `mode` | `"sfx"` or `"music"` | **yes** | — | Generation mode. Determines defaults below. |
| `model` | string | no | `"medium"` (music) / `"small-sfx"` (sfx) | `"small-sfx"`, `"small-music"`, or `"medium"` |
| `duration` | number | **yes** | `60` (music) | Length in seconds. For SFX, choose an appropriate duration for the sound (1–10s for UI stings/impacts, 10–30s for ambience/atmospheres). Small models max 120s, medium max 380s. |
| `steps` | integer | no | 10 | Diffusion steps (4–50). Default 10. Use 20 if the user asks for high quality. |
| `cfgScale` | number | no | 2 | Prompt strength (0–12). Default 2. |
| `format` | `"mp3"` or `"wav"` | no | `"mp3"` | Output format |
| `seed` | integer | no | random | Reproducibility seed (0–2147483647). Same seed + same settings = same output. |
| `negativePrompt` | string | no | `""` | What to avoid (max 500 chars) |
| `mock` | boolean | no | `false` | Fast fake audio for testing without model inference |

### Model guide

| Model | Best for | Max duration |
|---|---|---|
| `small-sfx` | Sound effects, Foley, UI stings | 120s |
| `small-music` | Fast local full-song sketches | 120s |
| `medium` | Higher musicality, long-form up to ~6:20 | 380s |

### Example: SFX

```bash
curl -s -X POST http://localhost:3007/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "cinematic spaceship door opening, hydraulic hiss, low metallic rumble, clean tail",
    "mode": "sfx",
    "model": "small-sfx",
    "duration": 6,
    "steps": 10,
    "cfgScale": 2,
    "format": "mp3"
  }'
```

### Defaults by mode

- **Music:** use `"model": "medium"`, `"duration": 60` unless the user specifies otherwise.
- **SFX:** use `"model": "small-sfx"`. The agent MUST choose a `duration` appropriate for the requested sound — short for transient effects (2–6s), longer for evolving/atmospheric sounds (10–30s). Never default to 60s for SFX.

### Example: Music

```bash
curl -s -X POST http://localhost:3007/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "lofi hip hop loop, dusty drums, mellow rhodes chords, vinyl texture, 82 BPM",
    "mode": "music",
    "model": "medium",
    "duration": 60,
    "steps": 10,
    "cfgScale": 2,
    "format": "mp3"
  }'
```

## 3. Handle the response

**Success:**

```json
{
  "ok": true,
  "audioUrl": "/outputs/sa3-sfx-1700000000000.mp3",
  "metadataUrl": "/outputs/sa3-sfx-1700000000000.json",
  "filename": "sa3-sfx-1700000000000.mp3",
  "meta": { "generationSettings": { ... }, "timing": { ... } }
}
```

Report to the user:
- The filename: `sa3-sfx-1700000000000.mp3`
- The local file path: `/Users/probello/Repos/stable-audio-3-lab/public/outputs/sa3-sfx-1700000000000.mp3`
- The browser URL: `http://localhost:3007/outputs/sa3-sfx-1700000000000.mp3`

**Failure:**

```json
{ "ok": false, "error": "Python generator failed", "detail": { ... } }
```

Surface the `error` field to the user. If the error mentions Python or model loading, the user may need to check their Stable Audio 3 setup (MLX weights, Python environment).
