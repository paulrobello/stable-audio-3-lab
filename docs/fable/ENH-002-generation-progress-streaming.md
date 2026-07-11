# ENH-002 — Real-time generation progress streaming (SSE)

## Goal
Replace the opaque spinner during the 30–900 s diffusion with a live progress bar and ETA, by streaming per-step progress from the Python bridge through the Node route to the browser via Server-Sent Events (SSE).

## Current-State Context
- `app/page.tsx` shows only coarse batch progress (`batchProgress` state, ~lines 53/391/402) — e.g. "Variation 1/3" — plus an indeterminate spinner (`busy`).
- `app/api/generate/route.ts` awaits the whole Python process and returns a single JSON response at the end (`runProcess`, ~54–70).
- The Python side runs a known number of diffusion `steps` (passed via `buildGeneratorArgs`), so step index → percentage is well-defined.
- If ENH-001 (worker) is built, progress lines ride the same stdout protocol; if not, `generate_audio.py` prints progress lines to stdout/stderr.

## Implementation Steps
1. **Emit progress from Python**: in the generation loop (`scripts/generate_audio.py` or `scripts/sa3_infer.py` from ENH-001), print one JSON line per step (or every N steps) to stdout: `{"progress": {"step": k, "total": steps}}`. Keep the final result line distinct (`{"result": {...}}`). Guard behind a `--progress` flag so the CLI/mock path stays quiet.
2. **Stream from Node**: add a streaming variant of the generate route (either `GET /api/generate/stream` with query params, or accept `Accept: text/event-stream` on the existing route). Return a `ReadableStream` response with `Content-Type: text/event-stream`. As the child emits stdout lines, parse them and `enqueue` SSE `data:` events (`event: progress` / `event: done` / `event: error`).
3. **Parse robustly**: buffer stdout and split on newlines; JSON-parse each complete line; ignore non-JSON lines (model libraries print noise). Forward only recognized `progress`/`result`/`error` shapes.
4. **Client consumption**: in `app/page.tsx`'s `generate()`, when a single (non-batch) generation runs, open an `EventSource` (or `fetch` + `ReadableStream` reader for POST bodies) and update a determinate progress bar + ETA from `step/total`. Fall back to the current spinner if the stream errors.
5. **Batch mode**: keep the existing per-variation counter, but nest the per-generation bar inside it.
6. **Auth**: SSE requests must carry the SEC-001 token; `EventSource` can't set headers, so use `fetch`-based streaming with an `Authorization` header, or pass a short-lived token as a query param validated by middleware.

## Files to Touch
- `scripts/generate_audio.py` / `scripts/sa3_infer.py` (progress lines behind `--progress`)
- `app/api/generate/route.ts` (or new `app/api/generate/stream/route.ts`)
- `app/page.tsx` (progress bar UI + stream reader)
- `middleware.ts` (token handling for the stream), `.env.example`/README if a new var appears
- `tests/` and `app/page.test.tsx`

## Verification Commands
- `make test`: add a Vitest for the SSE parser (feed synthetic stdout lines → assert emitted events) and a Python test asserting progress lines are emitted with `--progress` and suppressed without it.
- `make typecheck` + `make build`.
- Manual: run a real generation and confirm the bar advances smoothly to 100% and the final audio matches; kill the process mid-stream and confirm the client shows an error, not a hang.

## Rollback Considerations
- Purely additive: the non-streaming JSON path stays as the default/fallback. If the stream fails or `--progress` is off, behavior is identical to today.
- Gate the UI behind a feature check (stream endpoint responds 200) so an older server without the endpoint degrades gracefully.
- No data model changes → no migration; rollback is deleting the stream endpoint and reverting the client to the spinner.
