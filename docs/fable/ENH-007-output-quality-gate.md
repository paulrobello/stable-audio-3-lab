# ENH-007 — Automated output quality gate (silence / clipping)

## Goal
Auto-flag or quarantine failed generations (all-silence, hard clipping, near-zero RMS, wrong duration) before they enter the library or the radio queue, raising the station's floor quality at low cost.

## Current-State Context
- Generation writes audio + sidecar to `public/outputs/`; nothing validates the audio content itself today — a silent or clipped output is indistinguishable from a good one until a human listens.
- The radio queue (`app/api/radio/route.ts:518-534`) pulls generated tracks into rotation automatically, so a bad generation can reach listeners.
- The assessor (`scripts/audio_assessor_qwen_omni.py`, invoked via `/api/assess*`) already extracts structured attributes — but it's heavyweight (a 7B model) and load-throttled; the quality gate should be a **cheap** signal-processing check, not the assessor.
- Python already has numpy in the inference stack.

## Implementation Steps
1. **Cheap DSP check** (`scripts/audio_quality.py`, new, or a function in the shared `sa3_infer.py`): after writing the audio, load the samples and compute: peak amplitude, RMS, fraction of samples at/near full-scale (clipping), fraction below a silence floor, and actual vs requested duration. Return a small verdict object `{ ok, reasons: string[], metrics: {...} }`.
2. **Thresholds**: flag if RMS < silence floor (effectively silent), clipped fraction > e.g. 1%, or duration off by > a tolerance. Make thresholds config-driven (`QUALITY_GATE_*` env) with sane defaults; document (DOC-002).
3. **Record the verdict**: write the `qualityGate` object into the sidecar metadata (`lib/library.ts` type addition, optional field). Do **not** delete audio automatically — quarantine by marking, so the user decides.
4. **Wire into generation**: run the check inline after generation (it's milliseconds). If it fails, still return the item but set a `flagged: true` / `qualityGate.ok=false` so the UI can badge it.
5. **Gate the radio queue**: in the refill path, skip (or de-prioritize) tracks whose `qualityGate.ok === false` so bad outputs don't auto-enter rotation. Make this behavior configurable (`RADIO_SKIP_FLAGGED`, default true).
6. **UI surface**: badge flagged items in the library (`app/page.tsx`) with the reasons; optionally a "regenerate" shortcut.
7. **Backfill (optional)**: a one-shot pass to score existing outputs.

## Files to Touch
- `scripts/audio_quality.py` (new) or shared `scripts/sa3_infer.py`
- `scripts/generate_audio.py` / bridge (invoke the check, add verdict to output)
- `lib/library.ts` (optional `qualityGate` metadata field)
- `app/api/radio/route.ts` (skip flagged in refill)
- `app/page.tsx` (badge), `lib/server/config.ts` (ARC-016), `.env.example`, `tests/`

## Verification Commands
- `make test`: Python unit tests feeding synthetic buffers (pure silence → flagged; a clipped square wave → flagged; a normal sine at target duration → ok); a Vitest asserting the radio refill skips a `qualityGate.ok=false` item.
- `make typecheck` + `make build`.
- Manual: force a degenerate generation (or hand-craft a silent WAV in `public/outputs/` with a matching sidecar) and confirm it's badged in the library and skipped by the radio.

## Rollback Considerations
- Non-destructive by design: the gate only annotates; it never deletes audio. Worst case a false-positive flag is cosmetic and the user can still play the track.
- `qualityGate` is an optional metadata field → old sidecars load unchanged; rollback = stop reading it (UI badge disappears) and set `RADIO_SKIP_FLAGGED=false`.
- Thresholds are config-driven, so a too-aggressive gate is tuned via env without a code change.
- Keep the check cheap and inline; if it ever adds meaningful latency, gate it behind `QUALITY_GATE_ENABLED` (default true) so it can be disabled instantly.
