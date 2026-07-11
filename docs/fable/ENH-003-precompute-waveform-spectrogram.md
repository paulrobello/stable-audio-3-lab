# ENH-003 — Precompute + cache waveform/spectrogram sidecars

## Goal
Stop recomputing the waveform and spectrogram in the browser on every library view. Precompute downsampled peak arrays and spectrogram bins once (at generation time, where the audio already exists) and store them in the JSON sidecar so the client renders instantly from static data.

## Current-State Context
- `app/page.tsx` computes analysis client-side: `AudioContext` + `decodeAudioData` (~1056–1058) and `buildSpectrogramBins(data, columns, frequencyBins)` (exported, ~1001), rendered by the `AudioPreview` component with a `"waveform" | "spectrogram"` mode toggle (~1024–1030).
- This runs on every open/preview and scales with track length and library size.
- Sidecars are JSON files written next to each audio file by `lib/library.ts`; the metadata contract is `GenerationMetadata`.
- `buildSpectrogramBins` is pure and already unit-tested (`app/page.test.tsx:533`), so its logic can be shared/ported.

## Implementation Steps
1. **Decide compute location**:
   - **Option A (preferred)**: compute in Python at generation time. Add a `--analysis` step to the bridge that, after writing the audio, computes (a) a downsampled peak array (e.g. 1,000 min/max pairs) and (b) spectrogram bins matching `buildSpectrogramBins`'s columns×frequencyBins shape, and writes them into the sidecar under an `analysisPreview` key. Use numpy (already a dependency of the inference stack).
   - **Option B**: compute once client-side on first view, then `PATCH /api/library` to persist `analysisPreview` back to the sidecar (reuses the existing PATCH route; no Python change). Lower effort, but the first view still pays the cost.
2. **Extend the metadata type** (`lib/library.ts`): add an optional `analysisPreview?: { peaks: number[]; spectrogram: number[][]; sampleRate: number; durationSec: number }`. Keep it optional so old sidecars still load.
3. **Match the client shape exactly**: whichever side computes it, produce the same normalized values `buildSpectrogramBins` produces today, so the renderer is unchanged. Port/verify the algorithm against the existing test vectors in `app/page.test.tsx`.
4. **Client fast path**: in `AudioPreview`, if `item.analysisPreview` exists, render directly from it and skip `AudioContext`/`decodeAudioData` entirely. If absent (legacy items), fall back to the current client compute (and optionally persist via Option B).
5. **Backfill**: add a one-shot script (or a library route action) to compute previews for existing outputs lacking `analysisPreview`.
6. **Bundle export**: include `analysisPreview` in exported sidecars (already automatic if it's part of the metadata object).

## Files to Touch
- `scripts/generate_audio.py` / `scripts/sa3_infer.py` (Option A: `--analysis` compute) **or** `app/api/library/route.ts` PATCH (Option B persist)
- `lib/library.ts` (metadata type + read/write)
- `app/page.tsx` (`AudioPreview` fast path; keep `buildSpectrogramBins` as fallback)
- `tests/`, `app/page.test.tsx` (assert fast path renders identical bins to the client compute)

## Verification Commands
- `make test`: assert that a precomputed `analysisPreview` produces the same rendered bins as `buildSpectrogramBins` on the same audio (reuse existing test vectors); assert legacy sidecars (no `analysisPreview`) still render via the fallback.
- `make typecheck` + `make build`.
- Manual: open a freshly generated item and confirm no `AudioContext` is created (breakpoint/log), while a legacy item still decodes client-side.

## Rollback Considerations
- Fully backward compatible: `analysisPreview` is optional; absence triggers the existing client path, so nothing breaks for old files.
- Rollback = stop reading `analysisPreview` in `AudioPreview` (client reverts to always-compute); the extra sidecar field is harmless if left in place.
- Storage cost is small (a few KB per sidecar); if unwanted, the backfill/compute step can be disabled by config without affecting playback.
