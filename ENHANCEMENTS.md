# Enhancement Ideas

> Opportunities **beyond** the defect findings in `AUDIT.md` — performance, UX, and capability
> improvements. Each idea has a full implementation plan under `docs/fable/ENH-XXX-<slug>.md`,
> written so a smaller model can execute it without further analysis.
>
> Prioritized by impact-to-effort. IDs are stable; do not renumber.

| ID | Title | Impact | Effort | Priority |
|----|-------|--------|--------|:--------:|
| [ENH-001](docs/fable/ENH-001-persistent-model-worker.md) | Persistent Python model-worker pool | **Very High** — eliminates per-generation weight reload (the dominant latency cost) | High | 1 |
| [ENH-002](docs/fable/ENH-002-generation-progress-streaming.md) | Real-time generation progress streaming (SSE) | **High** — turns an opaque 30–900 s wait into a live progress bar | Medium | 2 |
| [ENH-003](docs/fable/ENH-003-precompute-waveform-spectrogram.md) | Precompute + cache waveform/spectrogram sidecars | **High** — removes client-side Web-Audio decode+FFT on every library open | Medium | 3 |
| [ENH-004](docs/fable/ENH-004-generation-result-cache.md) | Generation result cache / request-signature dedupe | **Medium** — instant return for identical (prompt, seed, model, steps, cfg) | Low | 4 |
| [ENH-005](docs/fable/ENH-005-observability.md) | Structured observability for radio + generation | **Medium** — makes the silent-degradation subsystems diagnosable and measurable | Medium | 5 |
| [ENH-006](docs/fable/ENH-006-library-search-index.md) | Server-side library search index | **Medium** — scales search past the in-memory client filter as the library grows | Medium | 6 |
| [ENH-007](docs/fable/ENH-007-output-quality-gate.md) | Automated output quality gate (silence/clipping) | **Medium** — auto-flags failed generations before they reach the library/radio | Low | 7 |

---

## Idea Summaries

### ENH-001 — Persistent Python model-worker pool
Today `scripts/generate_audio.py` calls `StableAudioModel.from_pretrained(model_name)` on **every** invocation, and each `/api/generate` request spawns a fresh process — so the multi-GB MLX/Torch weights are loaded from scratch for every single generation, often dwarfing the actual inference time. A long-lived worker process (one per model, or a small pool) that loads weights once and then services generation jobs over a simple line-delimited JSON protocol on stdin/stdout would cut the effective per-generation latency dramatically for the common case of repeated generations with the same model. **Impact: very high; Effort: high** (introduces a worker lifecycle the Node side must manage, but the audit's generation-slot semaphore (ARC-005) is a natural home for it).

### ENH-002 — Real-time generation progress streaming (SSE)
The UI currently shows only coarse batch progress ("Variation 1/3") and an indeterminate spinner during the actual diffusion, which can run tens of seconds to minutes. The Python bridge knows its step count (`steps`), so emitting per-step progress lines that the Node route forwards to the browser as Server-Sent Events would give a real progress bar and ETA. **Impact: high; Effort: medium.**

### ENH-003 — Precompute + cache waveform/spectrogram sidecars
`app/page.tsx` builds the waveform and spectrogram in the browser via `AudioContext.decodeAudioData` + `buildSpectrogramBins` every time an item is viewed. Precomputing downsampled peak arrays and spectrogram bins once at generation time (Python already has the audio) and storing them in the JSON sidecar lets the client render instantly from static data, removing repeated decode+FFT work that scales with library size and track length. **Impact: high; Effort: medium.**

### ENH-004 — Generation result cache / request-signature dedupe
Generation is deterministic given (prompt, seed, model, steps, cfgScale, duration). Hashing that tuple and short-circuiting to the existing output when a match is present avoids re-running inference for identical requests (common when tweaking unrelated UI settings or re-running a shared preset). **Impact: medium; Effort: low.**

### ENH-005 — Structured observability for radio + generation
Beyond the audit's minimal logger (QA-006), a small structured event stream (generation started/finished/failed, queue depth, TTS provider used/failed, assessment queue length, model load time) exposed at a `/api/metrics` (or JSON lines) surface would make the radio's silent-degradation paths measurable and give the generation pipeline real timing data — also the raw material for ENH-001's before/after. **Impact: medium; Effort: medium.**

### ENH-006 — Server-side library search index
Search/filter is currently `filterLibraryItems`/`libraryItemSearchText` in the client, which loads and scans all sidecars in memory. A lightweight server-side index (over title, prompt, and assessment attributes) served by `/api/library` with query params keeps search fast and paginated as the library grows into the thousands. **Impact: medium; Effort: medium.**

### ENH-007 — Automated output quality gate
The assessor already extracts structured attributes; adding a cheap post-generation check (all-silence, hard clipping, near-zero RMS, wrong duration) that flags or quarantines bad outputs before they enter the library or the radio queue improves the station's floor quality with little cost. **Impact: medium; Effort: low.**
