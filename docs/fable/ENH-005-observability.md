# ENH-005 — Structured observability for radio + generation

## Goal
Make the silent-degradation subsystems (radio TTS, taste distillation, queue refill) measurable and give the generation pipeline real timing data. Provide a small structured event stream and a metrics snapshot endpoint — also the raw material for measuring ENH-001's before/after.

## Current-State Context
- Audit finding QA-006: there is **zero** logging in server code; 44 empty `catch {}` blocks swallow operationally significant failures.
- The audit's QA-006 fix adds a minimal `lib/server/logger.ts`; this enhancement builds structured events on top of it.
- Hot paths worth instrumenting: `/api/generate` (start/finish/fail + model load + inference ms), radio queue refill (`app/api/radio/route.ts:518-534`), TTS synthesis (`~1345`), taste distillation (`~855`), the assessment queue (`lib/audio-assessment.ts`).

## Implementation Steps
1. **Event schema** (`lib/server/metrics.ts`, new): a typed `recordEvent(name, fields)` where `name` is a small enum (`generation.start|finish|fail`, `radio.queue.refill`, `tts.synth.ok|fail`, `taste.distill.ok|fail`, `assessment.enqueue|finish|fail`, `model.load`). Fields carry ms durations, model id, queue depth, provider name, etc.
2. **In-memory counters + ring buffer**: keep monotonic counters (totals, failures) and a bounded ring buffer of recent events (e.g. last 500) in a `globalThis`-pinned singleton (survives HMR, per ARC-005). No external DB.
3. **Instrument the hot paths**: call `recordEvent` at each site. In the audit's QA-006 fallback catches, emit a `*.fail` event instead of (or alongside) a log line — this turns silent degradation into a counter.
4. **Snapshot endpoint**: `GET /api/metrics` (auth-gated per SEC-001) returns the counters + a summary (p50/p95 generation ms, TTS failure rate, current radio queue depth, assessment queue length). Optionally a `?format=prom` for Prometheus text exposition if the user wants scraping.
5. **Timing helper**: a `time(name, fn)` wrapper that records duration around an async op; wrap the Python spawn / worker call, TTS synth, and ffmpeg transcode.
6. **Optional UI**: a tiny "Station health" panel in the radio page reading `/api/metrics` (queue depth, last TTS status, recent failures) — high value for the operator, low cost.

## Files to Touch
- `lib/server/metrics.ts` (new), builds on `lib/server/logger.ts` (QA-006)
- `app/api/generate/route.ts`, `app/api/radio/route.ts`, `lib/audio-assessment.ts` (instrumentation)
- `app/api/metrics/route.ts` (new, auth-gated)
- `app/radio/RadioStationClient.tsx` (optional health panel), `tests/`

## Verification Commands
- `make test`: unit-test `recordEvent` counter/ring-buffer behavior and the `/api/metrics` snapshot shape; assert a forced TTS failure increments `tts.synth.fail`.
- `make typecheck` + `make build`.
- Manual: run a generation and a radio cycle, then `curl -H "Authorization: Bearer $TOKEN" localhost:3007/api/metrics` and confirm timings and queue depths are populated; force a TTS failure and watch the failure counter rise.

## Rollback Considerations
- Additive and side-effect-free: metrics recording is fire-and-forget and must never throw into the caller (wrap `recordEvent` in its own try/catch). If it fails, generation/radio are unaffected.
- No persistence beyond in-memory buffers → nothing to migrate or clean up; a restart resets counters (acceptable for a local lab).
- Rollback = remove the `/api/metrics` route and the instrumentation calls; the logger (QA-006) remains.
- Keep `/api/metrics` behind auth so the event stream (which names models, providers, file counts) isn't a public information-disclosure surface (relates to SEC-004).
