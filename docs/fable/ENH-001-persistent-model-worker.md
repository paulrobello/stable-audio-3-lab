# ENH-001 — Persistent Python model-worker pool

## Goal
Eliminate the dominant per-generation latency cost: reloading multi-GB MLX/Torch weights on every request. Replace the one-shot `spawn(python, generate_audio.py)`-per-request model with a long-lived worker process (one per model) that loads weights **once** and services many generation jobs over a line-delimited JSON protocol.

## Current-State Context
- `app/api/generate/route.ts` spawns a fresh Python process per request (`runProcess`, ~lines 54–70) and passes CLI args built by `lib/generator-backend.ts` (`buildGeneratorArgs`).
- `scripts/generate_audio.py` calls `StableAudioModel.from_pretrained(model_name)` (~line 84) on **every** run, then generates and writes the WAV/MP3.
- The radio queue (`app/api/radio/route.ts:518-534`) and assessments also spawn generation/inference processes.
- Model weights are the vendored MLX repo under `vendor/stable-audio-3/`; three models (`small-sfx`, `small-music`, `medium`).
- **Dependency**: this pairs with audit item **ARC-005** (a single generation-slot semaphore) — the worker pool is the natural owner of that slot. Land ARC-005's semaphore first or build it here.

## Implementation Steps
1. **Design the worker protocol** (`scripts/generate_worker.py`, new):
   - On start: read a `--model <id>` arg, call `StableAudioModel.from_pretrained` once, then print a `{"ready": true, "loadMs": N}` line to stdout.
   - Loop: read one JSON job per line from stdin (`{ id, prompt, seed, steps, cfgScale, duration, outputPath, format }`), run inference, write the file, print `{"id": ..., "ok": true, "path": ..., "elapsedMs": N}` (or `{"id":..., "ok":false, "error":"..."}`) as a single line.
   - Emit progress lines (`{"id":..., "step": k, "total": steps}`) if ENH-002 is being built concurrently — otherwise omit.
   - Handle SIGTERM: finish the in-flight job or abort cleanly, then exit.
   - Reuse the existing process-group/signal handling from `scripts/generate_audio.py:162-217`.
2. **Keep `generate_audio.py` working** as the single-shot fallback (do not delete it — the CLI/mock path and `npm run py:mock` depend on it). The worker imports the same generation function; refactor the core inference into a shared `scripts/sa3_infer.py` that both entry points call, so there is one inference implementation.
3. **Node-side worker manager** (`lib/server/model-worker.ts`, new):
   - A class holding at most one live worker **per model id**, keyed on `globalThis` (survives HMR, per ARC-005).
   - `generate(request)`: ensure the worker for `request.model` is spawned and `ready`; enqueue the job; correlate the response by `id`; resolve with the output path.
   - Idle eviction: terminate a worker after `MODEL_WORKER_IDLE_MS` (env, default e.g. 10 min) to free unified memory; respawn lazily.
   - Concurrency: one job in flight per worker (model inference is not reentrant on this hardware); the shared generation semaphore (ARC-005) enforces global limit.
   - Robust lifecycle: `child.on("error")`, timeout with SIGTERM→SIGKILL escalation (reuse `lib/server/subprocess.ts` from ARC-007 where possible).
4. **Wire `/api/generate`** to call `modelWorker.generate(...)` instead of spawning `generate_audio.py` directly. Keep the request/response contract identical.
5. **Wire the radio queue** (`app/api/radio/route.ts` refill) to the same worker manager so radio and user generation share the warm worker and the single slot.
6. **Config**: add `MODEL_WORKER_ENABLED` (default true), `MODEL_WORKER_IDLE_MS`, `MODEL_WORKER_MAX` (max distinct warm models, default 1 to bound memory) to `lib/server/config.ts` (ARC-016) and `.env.example`; document (DOC-002).
7. **Memory guard**: on Apple Silicon, more than one warm 7B-class model may exhaust unified memory — default `MODEL_WORKER_MAX=1` and evict the LRU model when a different model is requested.

## Files to Touch
- `scripts/generate_worker.py` (new), `scripts/sa3_infer.py` (new, shared core), `scripts/generate_audio.py` (refactor to call shared core; keep as fallback)
- `lib/server/model-worker.ts` (new)
- `app/api/generate/route.ts`, `app/api/radio/route.ts` (call the manager)
- `lib/server/config.ts` (ENH/ARC-016), `.env.example`, `tests/`

## Verification Commands
- `make test` (Python unittest + Vitest); add `tests/test_generate_worker.py` exercising the stdin/stdout protocol with the mock backend (`--mock`) so it runs without real weights.
- `make typecheck` + `make build`.
- Manual before/after: time two consecutive real generations with the same model. Before: each pays full model load. After: the second is inference-only (log `loadMs` once, `elapsedMs` per job via ENH-005).
- Memory: with `MODEL_WORKER_MAX=1`, requesting a second model evicts the first (watch RSS / unified memory).

## Rollback Considerations
- Gate the whole feature behind `MODEL_WORKER_ENABLED`; when false, `/api/generate` falls back to the existing single-shot spawn of `generate_audio.py`. This makes rollback a config flip.
- Because `generate_audio.py` is preserved as the fallback and the shared core keeps one inference implementation, disabling workers cannot change output correctness — only latency.
- Risk: a wedged worker holding stale GPU memory. Mitigate with idle eviction + the SIGKILL-escalating lifecycle, and expose a `POST /api/generate?action=restartWorkers` (auth-gated per SEC-001) to force-cycle.
