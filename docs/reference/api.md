# Stable Audio 3 Lab API Reference

Complete HTTP reference for every route exposed by the Stable Audio 3 Lab dev server (Next.js 16 App Router). The API drives audio generation, the library, the continuous radio station, reference-track analysis, and local audio assessment. All request and response bodies are JSON unless noted otherwise. This document covers only the HTTP surface; see the [README](../../README.md) for the full environment-variable reference and setup.

## Table of Contents

- [Authentication](#authentication)
- [Conventions](#conventions)
- [Generation](#generation)
  - [POST /api/generate](#post-apigenerate)
  - [POST /api/generate-title](#post-apigenerate-title)
- [Library](#library)
  - [GET /api/library](#get-apilibrary)
  - [PATCH /api/library](#patch-apilibrary)
  - [DELETE /api/library](#delete-apilibrary)
- [Library Bundles](#library-bundles)
  - [GET /api/library/bundle](#get-apilibrarybundle)
- [Library Crop](#library-crop)
  - [POST /api/library/crop](#post-apilibrarycrop)
- [Assessment](#assessment)
  - [POST /api/assess](#post-apiassess)
- [Assessment Uploads](#assessment-uploads)
  - [POST /api/assess/upload](#post-apiassessupload)
- [YouTube Reference](#youtube-reference)
  - [POST /api/assess/youtube](#post-apiassessyoutube)
- [Radio](#radio)
  - [GET /api/radio](#get-apiradio)
  - [GET /api/radio?stream=1](#get-apiradiostream1)
  - [POST /api/radio](#post-apiradio)
- [Radio Playlists](#radio-playlists)
  - [GET /radio.m3u](#get-radiom3u)
  - [GET /radio.pls](#get-radiopls)
- [Historical Specs](#historical-specs)
- [Related Documentation](#related-documentation)

## Authentication

Authentication is **opt-in** and activates only when the `STABLE_AUDIO_ADMIN_TOKEN` environment variable is set to a non-empty value. The token is never generated or hardcoded by the app; it comes solely from the operator environment.

- **Unset (default localhost/single-user mode):** all routes work with no authentication, exactly as before.
- **Set:** every mutating request under `/api/*` (`POST`, `PUT`, `PATCH`, `DELETE`) must carry an `Authorization: Bearer <token>` header. A missing or mismatched token returns `401 Unauthorized` with a `WWW-Authenticate: Bearer realm="stable-audio-3-lab"` header. Comparison is constant-time.
- **Read-only routes are never gated.** All `GET` routes, including the public `GET /api/radio` JSON contract, `GET /api/radio?stream=1` MP3 stream, and the playlist endpoints, remain open regardless of token configuration.
- A per-client rate limit (fail-open) runs on mutating routes before the token check; throttled requests return `429` with a `Retry-After` header.

See the [README](../../README.md) and `.env.example` for how to configure `STABLE_AUDIO_ADMIN_TOKEN` and the other environment variables referenced below.

## Conventions

- **Base URL:** the dev server runs on `http://localhost:3007` (see `make dev`).
- **Content type:** JSON request bodies must be `application/json`, except `POST /api/assess/upload` which is `multipart/form-data`.
- **Envelope:** every JSON response carries a boolean `ok`. Successful responses set `ok: true` plus the documented payload; error responses set `ok: false` plus an `error` string (and sometimes a `detail` object).
- **Subprocess detail is never echoed.** Python/ffmpeg/yt-dlp stdout, stderr, and absolute host paths are logged server-side only; client-facing error messages are generic.
- **Auth column meaning:**
  - "Not required" — the route is a `GET` and is never gated.
  - "Required when `STABLE_AUDIO_ADMIN_TOKEN` is set" — the route is mutating and requires the bearer token when that env var is configured.

## Generation

### POST /api/generate

Generates audio by spawning the Python bridge script (`scripts/generate_audio.py`) over a real Stable Audio 3 backend (MLX or Torch) or mock WAV synthesis. Writes the audio file plus a JSON metadata sidecar to `public/outputs/`. When `title` is omitted and `autoTitle` is true, a title is generated via Ollama and used to derive the filename.

**Method:** `POST`
**Path:** `/api/generate`
**Authentication:** Required when `STABLE_AUDIO_ADMIN_TOKEN` is set

The request is validated by the Zod schema in `lib/generation.ts` (`normalizeGenerationRequest`), which accepts oversized `duration` input and then clamps it to the selected model's maximum.

#### Request Body

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `prompt` | string | Yes | | 8-1000 characters |
| `mode` | `"sfx"` \| `"music"` | Yes | | |
| `model` | `"small-sfx"` \| `"small-music"` \| `"medium"` | Yes | | Model max durations: `small-sfx` 120s, `small-music` 120s, `medium` 380s |
| `duration` | number | Yes | | Accepted range 1-3600; clamped to the model's max |
| `negativePrompt` | string | No | `""` | Max 500 characters |
| `steps` | integer | No | `8` | 4-50 |
| `cfgScale` | number | No | `1` | 0-12 |
| `format` | `"mp3"` \| `"wav"` | No | `"mp3"` | |
| `seed` | integer | No | | 0-2147483647 |
| `mock` | boolean | No | `false` | Force mock output instead of inference |
| `title` | string | No | | Explicit title; max 200 characters. Used to derive the filename |
| `autoTitle` | boolean | No | `false` | Generate a title via Ollama when `title` is absent |
| `batchRunId` | string | No | | Required together with `variationIndex` and `variationCount` |
| `variationIndex` | integer | No | | 0-99; requires `batchRunId`; must be less than `variationCount` |
| `variationCount` | integer | No | | 1-99; requires `batchRunId` |

```json
{
  "prompt": "uplifting synthwave instrumental, warm analog bass, shimmering pads, 118 BPM",
  "mode": "music",
  "model": "medium",
  "duration": 60,
  "steps": 10,
  "cfgScale": 2,
  "format": "mp3",
  "title": "Neon Pulse"
}
```

#### Success Response

**Status:** `200 OK`

```json
{
  "ok": true,
  "audioUrl": "/outputs/neon_pulse.mp3",
  "metadataUrl": "/outputs/neon_pulse.json",
  "filename": "neon_pulse.mp3",
  "title": "Neon Pulse",
  "meta": {
    "filename": "neon_pulse.mp3",
    "audioUrl": "/outputs/neon_pulse.mp3",
    "metadataUrl": "/outputs/neon_pulse.json",
    "title": "Neon Pulse"
  }
}
```

The `meta` object is the full library metadata sidecar written to disk (generation settings, timing, backend, batch/crop lineage, title).

#### Error Responses

| Status | Cause | Response |
| --- | --- | --- |
| `400 Bad Request` | Zod validation failed (bad prompt length, unknown model, malformed batch fields) | `{ "ok": false, "error": "<Zod message>" }` |
| `500 Internal Server Error` | Python generator exited non-zero | `{ "ok": false, "error": "Generation failed", "generationDurationMs": 12345 }` |
| `500 Internal Server Error` | Unexpected failure (filesystem, spawn) | `{ "ok": false, "error": "Generation request failed" }` |
| `401 Unauthorized` | Token required but missing/mismatched | `{ "ok": false, "error": "Unauthorized" }` |
| `429 Too Many Requests` | Per-client rate limit exceeded | `{ "ok": false, "error": "Too many requests" }` |

#### Example

```bash
curl -X POST http://localhost:3007/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"lofi hip hop loop, dusty drums, mellow rhodes, 82 BPM","mode":"music","model":"medium","duration":60,"steps":10,"cfgScale":2}'
```

### POST /api/generate-title

Generates a short creative title from an audio prompt using a local Ollama model (default `phi4-mini`, configurable via `OLLAMA_TITLE_MODEL`). Logic lives in `lib/server/ollama.ts`. On any Ollama failure the route returns a successful HTTP status with `ok: false` so callers can fall back to a slug.

**Method:** `POST`
**Path:** `/api/generate-title`
**Authentication:** Required when `STABLE_AUDIO_ADMIN_TOKEN` is set

#### Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `prompt` | string | Yes | Audio description to title |
| `mode` | `"sfx"` \| `"music"` | No | Defaults to `"music"` |

```json
{
  "prompt": "rain on a neon city window, distant thunder, soft traffic below",
  "mode": "sfx"
}
```

#### Success Response

**Status:** `200 OK`

```json
{
  "ok": true,
  "title": "Midnight Rain Drift"
}
```

#### Error Responses

| Status | Cause | Response |
| --- | --- | --- |
| `200 OK` | Ollama reachable but returned an empty title | `{ "ok": false, "error": "Empty title generated" }` |
| `400 Bad Request` | Missing or non-string `prompt`; or Ollama request threw | `{ "ok": false, "error": "<message>" }` |

#### Example

```bash
curl -X POST http://localhost:3007/api/generate-title \
  -H "Content-Type: application/json" \
  -d '{"prompt":"dark cinematic orchestral trailer cue, taiko hits, brass swells","mode":"music"}'
```

## Library

### GET /api/library

Lists every audio file in `public/outputs/`, newest first, each enriched with its metadata sidecar (if present).

**Method:** `GET`
**Path:** `/api/library`
**Authentication:** Not required

#### Success Response

**Status:** `200 OK`

```json
{
  "ok": true,
  "items": [
    {
      "filename": "neon_pulse.mp3",
      "audioUrl": "/outputs/neon_pulse.mp3",
      "downloadUrl": "/outputs/neon_pulse.mp3",
      "metadataUrl": "/outputs/neon_pulse.json",
      "format": "mp3",
      "bytes": 1920000,
      "createdAt": "2026-07-10T12:00:00.000Z",
      "favorite": false,
      "notes": "string, when set",
      "rating": 5,
      "title": "Neon Pulse",
      "bundleUrl": "/api/library/bundle?filename=neon_pulse.mp3",
      "batchRunId": "batch-2026-07-10",
      "batchBundleUrl": "/api/library/bundle?batchRunId=batch-2026-07-10",
      "meta": { "filename": "neon_pulse.mp3" }
    }
  ]
}
```

`notes`, `rating`, `title`, `batchRunId`, `batchBundleUrl`, and `meta` are optional and present only when the sidecar carries them.

#### Error Responses

| Status | Cause | Response |
| --- | --- | --- |
| `500 Internal Server Error` | Filesystem read failure | `{ "ok": false, "error": "<message>" }` |

#### Example

```bash
curl http://localhost:3007/api/library
```

### PATCH /api/library

Updates a library item's metadata sidecar. Supports toggling favorite, setting annotations (`notes` and/or `rating`), and renaming the title. At least one of `favorite`, `notes`, `rating`, or `title` must be present alongside `filename`.

**Method:** `PATCH`
**Path:** `/api/library`
**Authentication:** Required when `STABLE_AUDIO_ADMIN_TOKEN` is set

#### Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `filename` | string | Yes | Must be a safe audio filename |
| `favorite` | boolean | No | Toggle favorite |
| `notes` | string | No | Free-text annotation |
| `rating` | number \| string \| null | No | Numeric rating |
| `title` | string | No | Renames the track title in the sidecar (whitespace-only clears it) |

```json
{
  "filename": "neon_pulse.mp3",
  "favorite": true,
  "rating": 5,
  "notes": "Best seed so far"
}
```

#### Success Response

**Status:** `200 OK`

```json
{
  "ok": true,
  "meta": {
    "filename": "neon_pulse.mp3",
    "favorite": true,
    "rating": 5,
    "notes": "Best seed so far"
  }
}
```

#### Error Responses

| Status | Cause | Response |
| --- | --- | --- |
| `400 Bad Request` | Missing/invalid `filename`, or no annotation field provided | `{ "ok": false, "error": "Invalid library metadata request" }` |
| `404 Not Found` | Audio file does not exist | `{ "ok": false, "error": "<message>" }` |
| `500 Internal Server Error` | Other filesystem error | `{ "ok": false, "error": "<message>" }` |

#### Example

```bash
curl -X PATCH http://localhost:3007/api/library \
  -H "Content-Type: application/json" \
  -d '{"filename":"neon_pulse.mp3","favorite":true}'
```

### DELETE /api/library

Deletes an audio file and its metadata sidecar from `public/outputs/`.

**Method:** `DELETE`
**Path:** `/api/library`
**Authentication:** Required when `STABLE_AUDIO_ADMIN_TOKEN` is set

#### Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `filename` | string | Yes | Must be a safe audio filename |

```json
{ "filename": "neon_pulse.mp3" }
```

#### Success Response

**Status:** `200 OK`

```json
{ "ok": true }
```

#### Error Responses

| Status | Cause | Response |
| --- | --- | --- |
| `400 Bad Request` | Missing or invalid `filename` | `{ "ok": false, "error": "Invalid filename" }` |
| `500 Internal Server Error` | File deletion failure | `{ "ok": false, "error": "<message>" }` |

#### Example

```bash
curl -X DELETE http://localhost:3007/api/library \
  -H "Content-Type: application/json" \
  -d '{"filename":"neon_pulse.mp3"}'
```

## Library Bundles

### GET /api/library/bundle

Downloads a ZIP bundle. With `?filename=` it bundles a single track (audio, metadata sidecar, analysis summary, SVG screenshot). With `?batchRunId=` it bundles every track whose sidecar carries that batch run id, plus a `<batchRunId>.manifest.json`.

**Method:** `GET`
**Path:** `/api/library/bundle`
**Authentication:** Not required

#### Query Parameters

| Parameter | Type | Notes |
| --- | --- | --- |
| `filename` | string | Single-track bundle. Must be a safe audio filename |
| `batchRunId` | string | Batch bundle. Takes precedence over `filename` when both are present |

One of the two is required. Provide `filename` for a single track or `batchRunId` for a batch.

#### Success Response

**Status:** `200 OK`
**Content-Type:** `application/zip`
**Content-Disposition:** `attachment; filename="<bundle-name>.zip"`

The body is the binary ZIP archive. No JSON is returned on success.

#### Error Responses

| Status | Cause | Response |
| --- | --- | --- |
| `400 Bad Request` | Invalid `filename` or `batchRunId` | `{ "ok": false, "error": "Invalid filename" }` or `"Invalid batch run id"` |
| `404 Not Found` | Single track missing, or no artifacts match the batch run | `{ "ok": false, "error": "<message>" }` or `"No artifacts found for batch run"` |
| `500 Internal Server Error` | Other failure | `{ "ok": false, "error": "<message>" }` |

#### Example

```bash
# Single track
curl -OJ "http://localhost:3007/api/library/bundle?filename=neon_pulse.mp3"

# Whole batch
curl -OJ "http://localhost:3007/api/library/bundle?batchRunId=batch-2026-07-10"
```

## Library Crop

### POST /api/library/crop

Crops a region of an existing library track using ffmpeg. Probes the source duration via ffprobe first, then writes a new cropped file and metadata sidecar derived from the source. The crop codec matches the source format (MP3 uses `libmp3lame`, WAV uses `pcm_s16le`).

**Method:** `POST`
**Path:** `/api/library/crop`
**Authentication:** Required when `STABLE_AUDIO_ADMIN_TOKEN` is set

#### Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `filename` | string | Yes | Source audio in `public/outputs/`; must be a safe filename |
| `start` | number | Yes | Crop start seconds |
| `end` | number | Yes | Crop end seconds; must be within source duration |

```json
{
  "filename": "neon_pulse.mp3",
  "start": 10,
  "end": 40
}
```

#### Success Response

**Status:** `200 OK`

```json
{
  "ok": true,
  "filename": "neon_pulse__010.000-040.000.mp3",
  "audioUrl": "/outputs/neon_pulse__010.000-040.000.mp3",
  "metadataUrl": "/outputs/neon_pulse__010.000-040.000.json",
  "meta": {
    "filename": "neon_pulse__010.000-040.000.mp3",
    "sourceFilename": "neon_pulse.mp3"
  }
}
```

#### Error Responses

| Status | Cause | Response |
| --- | --- | --- |
| `400 Bad Request` | Invalid `filename` or crop window | `{ "ok": false, "error": "<message>" }` |
| `404 Not Found` | Source audio missing | `{ "ok": false, "error": "Source audio not found" }` |
| `500 Internal Server Error` | ffmpeg exited non-zero or unexpected failure | `{ "ok": false, "error": "Crop failed" }` or `"Crop request failed"` |

#### Example

```bash
curl -X POST http://localhost:3007/api/library/crop \
  -H "Content-Type: application/json" \
  -d '{"filename":"neon_pulse.mp3","start":10,"end":40}'
```

## Assessment

### POST /api/assess

Runs the configured local audio-language model (Qwen2.5-Omni-7B by default via `STABLE_AUDIO_ASSESSOR_COMMAND`) over a library or radio track and writes the structured `analysis` block into its metadata sidecar. Synchronous (subject to load throttling outside this route).

**Method:** `POST`
**Path:** `/api/assess`
**Authentication:** Required when `STABLE_AUDIO_ADMIN_TOKEN` is set

#### Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `filename` | string | Yes | Track in `public/outputs/`; must be a safe filename |
| `source` | `"library"` \| `"radio"` | No | Defaults to `"library"` |
| `title` | string | No | Overrides/fills the assessment title |
| `prompt` | string | No | Original generation prompt |
| `styleId` | string | No | Radio style id |
| `rating` | string \| number | No | Known user rating |

```json
{
  "filename": "neon_pulse.mp3",
  "source": "library",
  "rating": "up"
}
```

#### Success Response

**Status:** `200 OK`

```json
{
  "ok": true,
  "assessment": {
    "assessedAt": "2026-07-10T12:00:00.000Z",
    "provider": "local-command",
    "model": "Qwen/Qwen2.5-Omni-7B",
    "summary": "Warm synthwave with steady four-on-the-floor...",
    "source": {
      "filename": "neon_pulse.mp3",
      "audioUrl": "/outputs/neon_pulse.mp3",
      "metadataUrl": "/outputs/neon_pulse.json",
      "source": "library",
      "title": "Neon Pulse",
      "rating": "up"
    },
    "attributes": {
      "genre": ["synthwave"],
      "instruments": ["analog synth", "drum machine"],
      "mood": ["uplifting"],
      "production": ["reverb", "wide stereo"],
      "positives": ["clean low end"],
      "negatives": ["slight harshness in highs"],
      "rhythm": "four-on-the-floor",
      "tempoBpm": 118,
      "key": "A minor"
    }
  },
  "meta": { "filename": "neon_pulse.mp3", "latestAssessment": {} }
}
```

#### Error Responses

| Status | Cause | Response |
| --- | --- | --- |
| `400 Bad Request` | Invalid filename or assessor command parse error | `{ "ok": false, "error": "<message>", "detail": {} }` |
| `404 Not Found` | Audio file missing | `{ "ok": false, "error": "<message>" }` |
| `500 Internal Server Error` | Assessor exited non-zero or unexpected failure | `{ "ok": false, "error": "Local audio assessor failed", "detail": {} }` |
| `503 Service Unavailable` | `STABLE_AUDIO_ASSESSOR_COMMAND` not configured | `{ "ok": false, "error": "Set STABLE_AUDIO_ASSESSOR_COMMAND to a local audio assessment command." }` |

When the error is an `AudioAssessmentError`, the response also includes a `detail` object with subprocess diagnostics.

#### Example

```bash
curl -X POST http://localhost:3007/api/assess \
  -H "Content-Type: application/json" \
  -d '{"filename":"neon_pulse.mp3","source":"library"}'
```

## Assessment Uploads

### POST /api/assess/upload

Accepts a temporary uploaded reference audio file, assesses it, and returns the assessment plus a synthesized music generation prompt. The uploaded audio is never added to the library; it is deleted after the request. Allowed extensions are `.mp3`, `.wav`, and `.m4p`.

**Method:** `POST`
**Path:** `/api/assess/upload`
**Authentication:** Required when `STABLE_AUDIO_ADMIN_TOKEN` is set
**Content-Type:** `multipart/form-data`

#### Request Body (multipart)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `file` | file | Yes | The audio file to assess |
| `title` | string | No | Display title; defaults to the uploaded filename without extension |

#### Success Response

**Status:** `200 OK`

```json
{
  "ok": true,
  "assessment": {
    "assessedAt": "2026-07-10T12:00:00.000Z",
    "provider": "local-command",
    "model": "Qwen/Qwen2.5-Omni-7B",
    "summary": "Reference track summary...",
    "source": {
      "filename": "uploaded-audio.mp3",
      "audioUrl": "",
      "metadataUrl": "",
      "source": "upload",
      "title": "uploaded-audio"
    },
    "attributes": { "genre": [], "instruments": [], "mood": [], "production": [], "positives": [], "negatives": [] }
  },
  "prompt": "Instrumental music matching the analyzed reference track.\nGenre: ...",
  "negativePrompt": "low quality, distorted, clipping, harsh noise"
}
```

The `prompt` and `negativePrompt` fields are derived from the assessment by `buildGenerationPromptFromAssessment` and are ready to feed back into `POST /api/generate`.

#### Error Responses

| Status | Cause | Response |
| --- | --- | --- |
| `400 Bad Request` | Missing `file` field, or unsupported extension | `{ "ok": false, "error": "Missing audio file" }` or `"Upload an MP3, WAV, or M4P file"` |
| `500 Internal Server Error` | Assessor failure or unexpected error | `{ "ok": false, "error": "<message>" }` |
| `503 Service Unavailable` | Assessor command not configured | `{ "ok": false, "error": "Set STABLE_AUDIO_ASSESSOR_COMMAND to a local audio assessment command." }` |

#### Example

```bash
curl -X POST http://localhost:3007/api/assess/upload \
  -F "file=@/path/to/reference.mp3" \
  -F "title=Demo Reference"
```

## YouTube Reference

### POST /api/assess/youtube

Extracts audio from a YouTube URL using a **deterministic `yt-dlp` + `ffmpeg` subprocess** (no LLM, no autonomous agent), assesses the resulting temp MP3, and returns the assessment plus a generation prompt. The temp file lives under `.stable-audio-assessments/uploads/` and is removed after the request; the source audio is never added to the library.

> **Note:** This route previously used an autonomous `codex exec` agent. It was replaced with fixed-argument `yt-dlp` + `ffmpeg` to remove the prompt-injection surface. Requires the `yt-dlp` binary on `PATH` (or `STABLE_AUDIO_YOUTUBE_YTDLP_BIN`) and `ffmpeg` (or `FFMPEG_PATH`).

**Method:** `POST`
**Path:** `/api/assess/youtube`
**Authentication:** Required when `STABLE_AUDIO_ADMIN_TOKEN` is set

#### Accepted Hosts

`youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be` (over `http` or `https`).

#### Request Body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `url` | string | Yes | A YouTube URL on one of the accepted hosts |

```json
{ "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
```

#### Success Response

**Status:** `200 OK`

```json
{
  "ok": true,
  "filename": "youtube-reference-<uuid>.mp3",
  "title": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "assessment": {
    "assessedAt": "2026-07-10T12:00:00.000Z",
    "provider": "local-command",
    "model": "Qwen/Qwen2.5-Omni-7B",
    "summary": "Reference track summary...",
    "source": {
      "filename": "youtube-reference-<uuid>.mp3",
      "audioUrl": "",
      "metadataUrl": "",
      "source": "upload",
      "title": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    },
    "attributes": { "genre": [], "instruments": [], "mood": [], "production": [], "positives": [], "negatives": [] }
  },
  "prompt": "Instrumental music matching the analyzed reference track.\nGenre: ...",
  "negativePrompt": "low quality, distorted, clipping, harsh noise"
}
```

#### Error Responses

| Status | Cause | Response |
| --- | --- | --- |
| `400 Bad Request` | Missing, malformed, or non-YouTube URL | `{ "ok": false, "error": "Enter a YouTube URL" }` |
| `500 Internal Server Error` | yt-dlp extraction or assessment failure | `{ "ok": false, "error": "YouTube audio extraction failed" }` |
| `503 Service Unavailable` | Assessor command not configured | `{ "ok": false, "error": "Set STABLE_AUDIO_ASSESSOR_COMMAND to a local audio assessment command." }` |

#### Example

```bash
curl -X POST http://localhost:3007/api/assess/youtube \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

## Radio

### GET /api/radio

Returns the full radio station state: the live queue, current and history tracks, DJ/taste profile, styles, stats, assessment-queue status, and stream URLs (LAN and public). This is the JSON contract consumed by the Pardora companion app. It is public and never gated.

The route also kicks off background queue maintenance (track generation, cleanup). Optional query params select a playlist format, the stream, or restrict the returned prompt-model list.

**Method:** `GET`
**Path:** `/api/radio`
**Authentication:** Not required

#### Query Parameters

| Parameter | Values | Effect |
| --- | --- | --- |
| `stream` | `1` | Switches to the continuous MP3/ICY stream (see [GET /api/radio?stream=1](#get-apiradiostream1)) |
| `playlist` | `m3u` \| `pls` | Returns a playlist file instead of JSON |
| `style` / `styleId` | string | Scope the stream/playlist to a radio style |
| `promptModels` | `0` | Omits the `promptModels` list from the JSON response |

#### Success Response

**Status:** `200 OK`

```json
{
  "ok": true,
  "state": {
    "currentTrack": { "filename": "radio-track.mp3", "title": "...", "prompt": "..." },
    "history": [],
    "stats": { "queueAheadCount": 3, "queueTarget": 5, "audioDiskBytes": 12345678 },
    "assessmentQueue": {
      "pendingCount": 1,
      "status": "queued",
      "loadRatio": 0.1,
      "loadThreshold": 0.25,
      "nextFilename": "radio-track.mp3",
      "nextRating": "up"
    },
    "queueGeneration": { "active": false },
    "streamUrl": "https://radio.example.com/api/radio?stream=1",
    "lanStreamUrl": "http://192.168.1.10:3007/api/radio?stream=1",
    "publicPlaylistUrls": { "m3u": "...", "pls": "..." },
    "lanPlaylistUrls": { "m3u": "...", "pls": "..." }
  },
  "promptModels": ["phi4-mini", "llama3.1:8b"]
}
```

`streamUrl`, `lanStreamUrl`, `publicPlaylistUrls`, and `lanPlaylistUrls` are present only when resolvable from the request host and LAN address. `promptModels` is omitted when `?promptModels=0` is passed or the Ollama model list is unreachable.

#### Error Responses

| Status | Cause | Response |
| --- | --- | --- |
| `500 Internal Server Error` | State read or maintenance failure | `{ "ok": false, "error": "<message>" }` |

#### Example

```bash
curl http://localhost:3007/api/radio
```

### GET /api/radio?stream=1

The continuous radio MP3 stream. Streams the current track (plus optional DJ announcement) as an `audio/mpeg` response with optional ICY metadata. It is the endpoint embedded in the `.m3u`/`.pls` playlists and consumed by Pardora. It is public and never gated, even when `STABLE_AUDIO_ADMIN_TOKEN` is set.

**Method:** `GET`
**Path:** `/api/radio?stream=1`
**Authentication:** Not required

#### Query Parameters

| Parameter | Values | Effect |
| --- | --- | --- |
| `icy` | `1` | Force ICY metadata on and metadata-only behavior |
| `metadataOnly` | `1` | Return only stream metadata, no audio body |
| `skipAnnouncement` | `1` | Skip the DJ announcement before the current track |
| `style` / `styleId` | string | Scope the stream to a radio style |
| `icy-metadata` | header `1` | Enable ICY metadata via request header |

#### Success Response

**Status:** `200 OK`
**Content-Type:** `audio/mpeg` (or metadata-only when requested)

The body is the live MP3 stream. No JSON is returned.

#### Example

```bash
# Play the stream with ffplay
ffplay "http://localhost:3007/api/radio?stream=1"
```

### POST /api/radio

A 16-action dispatcher that mutates the radio station: styles, configuration, drafts, track registration, playback control, ratings, feedback, and cleanup. The request body is a shared envelope validated by a Zod discriminated union on the `action` field (`lib/server/radio-actions.ts`). An unknown or missing action is rejected with `400 Unknown radio action`.

**Method:** `POST`
**Path:** `/api/radio`
**Authentication:** Required when `STABLE_AUDIO_ADMIN_TOKEN` is set

#### Request Envelope

Every POST carries an `action` string plus that action's payload fields. Actions that change station state return the updated `state` object (the same shape as `GET /api/radio`'s `state`) alongside any action-specific fields.

```json
{ "action": "<action>", "...payload fields": "..." }
```

#### Actions

| Action | Payload fields | Description |
| --- | --- | --- |
| `createStyle` | `label`, `seedPrompt`, `negativePrompt` | Create a custom radio style. Returns `style` and `state`; `400` if name/prompt missing |
| `draftStyle` | `request` | Draft a music style via Codex from a natural-language request. Returns `styleDraft`; `500` if drafting fails |
| `updateStyle` | `styleId`, `label`, `seedPrompt`, `negativePrompt` | Update a custom style. Returns `style` and `state`; `400` if not found or invalid |
| `deleteStyle` | `styleId` | Delete a custom style. Returns `deletedStyle` and `state`; `404` if not found |
| `configure` | `styleId`, `promptModel`, `announceEnabled`, `songLengthMinutes`, `unlikedTrackExpirationHours`, `ttsProvider`, `ttsVoice`, `announcementPrefix`, `announcementSuffix` | Select the active style and set station options. Returns `state` |
| `testVoice` | `ttsProvider`, `ttsVoice`, `announcementPrefix`, `announcementSuffix` | Generate a test DJ voice sample. Returns `audioUrl` |
| `ttsVoices` | `ttsProvider`, `ttsVoice` | List available TTS voices for the provider. Returns `voices` |
| `draft` | `styleId`, `promptModel` | Draft the next track prompt via Ollama. Returns `draft` and `state` |
| `track` | `filename`, `title`, `prompt`, `styleId`, `promptProvider`, `promptModel`, `announce`, `durationSeconds` | Register a generated audio file as a radio track (optionally with announcement). Returns `track` and `state`; `400` on invalid filename |
| `fallbackTrack` | `reason` | Register a starred-library MP3 as a fallback track. Returns `fallbackTrack` and `state`; `404` if none available |
| `selectTrack` | `filename` | Make a queued track the current track. Returns `track` and `state`; `404` if not in lineup |
| `skipTrack` | (none) | Advance to the next track. Returns optional `skippedTrack` and `state` |
| `deleteTrack` | `filename` | Delete a track and its audio from the lineup. Returns `deletedTrack` and `state`; `404` if not in lineup |
| `rating` | `filename`, `styleId`, `phrase`, `rating` | Record a thumbs-up/down, optionally reject the current track on a down-vote, enqueue assessment, and distill the taste profile. Returns optional `rejectedTrack` and `state` |
| `deleteFeedback` | `rating`, `phrase`, `styleId` | Remove a previously recorded like/dislike. Returns `state`; `400` if rating or phrase missing |
| `cleanup` | (none) | Remove expired and duplicate tracks. Returns `cleanedTracks` and `state` |

`rating` values are `"up"` or `"down"`. `promptProvider` values are `"ollama"` or `"fallback"`.

#### Success Response

**Status:** `200 OK`

The shape varies by action. State-mutating actions return the updated `state`; example for `createStyle`:

```json
{
  "ok": true,
  "style": { "id": "style-<uuid>", "label": "Deep House", "seedPrompt": "..." },
  "state": { "currentTrack": {}, "history": [], "stats": {} }
}
```

#### Error Responses

| Status | Cause | Response |
| --- | --- | --- |
| `400 Bad Request` | Unknown/missing action, or per-action validation (e.g. missing style name, invalid track filename, missing feedback fields) | `{ "ok": false, "error": "<message>" }` |
| `404 Not Found` | Style/track not found, or no fallback available | `{ "ok": false, "error": "<message>" }` |
| `500 Internal Server Error` | Drafting/taste-distillation failure or unexpected error | `{ "ok": false, "error": "<message>" }` |

#### Example

```bash
# Record a thumbs-up
curl -X POST http://localhost:3007/api/radio \
  -H "Content-Type: application/json" \
  -d '{"action":"rating","filename":"radio-track.mp3","rating":"up"}'

# Skip the current track
curl -X POST http://localhost:3007/api/radio \
  -H "Content-Type: application/json" \
  -d '{"action":"skipTrack"}'
```

## Radio Playlists

### GET /radio.m3u

Returns an M3U playlist pointing at the public radio stream URL, resolved from the request host. Consumed by media players and Pardora. Not under `/api/*`, so it is not matched by the auth middleware and is never gated.

**Method:** `GET`
**Path:** `/radio.m3u`
**Authentication:** Not required

#### Query Parameters

| Parameter | Values | Effect |
| --- | --- | --- |
| `style` / `styleId` | string | Scope the playlist stream URL to a radio style |

#### Success Response

**Status:** `200 OK`
**Content-Type:** `audio/x-mpegurl; charset=utf-8`
**Cache-Control:** `no-store`

The body is the M3U playlist text.

#### Error Responses

| Status | Cause | Response |
| --- | --- | --- |
| `400 Bad Request` | Request host could not be resolved to a stream URL | `{ "ok": false, "error": "Radio playlist origin is unavailable" }` |

#### Example

```bash
curl http://localhost:3007/radio.m3u
```

### GET /radio.pls

Returns a PLS playlist pointing at the public radio stream URL. Same resolution behavior as the M3U variant.

**Method:** `GET`
**Path:** `/radio.pls`
**Authentication:** Not required

#### Query Parameters

| Parameter | Values | Effect |
| --- | --- | --- |
| `style` / `styleId` | string | Scope the playlist stream URL to a radio style |

#### Success Response

**Status:** `200 OK`
**Content-Type:** `audio/x-scpls; charset=utf-8`
**Cache-Control:** `no-store`

The body is the PLS playlist text.

#### Error Responses

| Status | Cause | Response |
| --- | --- | --- |
| `400 Bad Request` | Request host could not be resolved to a stream URL | `{ "ok": false, "error": "Radio playlist origin is unavailable" }` |

#### Example

```bash
curl http://localhost:3007/radio.pls
```

## Historical Specs

The design document at [`docs/superpowers/specs/2026-05-27-pardora-ios-design.md`](../superpowers/specs/2026-05-27-pardora-ios-design.md) is retained for historical context. It captures the Pardora iOS app design as originally scoped, and its Non-Goals explicitly exclude features that have since shipped (for example, the continuous radio station, the assessment subsystem, and reference-track analysis). Treat it as a snapshot of the original design intent, not a current specification. This API reference and the [README](../../README.md) are the current sources of truth.

## Related Documentation

- [README](../../README.md) - Feature overview and full environment-variable reference
- [Documentation Style Guide](../DOCUMENTATION_STYLE_GUIDE.md) - Conventions used in this document
