# Audit Remediation Playbook

> **Companion to `AUDIT.md`.** One entry per issue, ordered to match the Remediation Plan phases.
> Written so a smaller model (e.g. sonnet running `/fix-audit`) can execute each fix without
> re-deriving the analysis. Line numbers are from the 2026-07-10 audit and **drift as edits land** —
> always `Read` the current file before editing, and re-`grep` for the symbol.
>
> **Global rules for every entry:**
> - The project gate is `make checkall` (= `make test` + `make build`). `make test` runs Vitest + Python unittest; `make typecheck` = `tsc --noEmit`; there is no separate linter.
> - Conflict files (see AUDIT.md File Conflict Map) must be re-read before every edit — a prior phase may have moved the code.
> - Do not commit security changes (SEC-*, ARC-001) silently inside a larger change; flag them for manual review.
> - Match existing style: pure helpers in `lib/`, typed JSON readers, no `any`, argument-array `spawn` (never `shell:true`).

---

## Phase 0 — Verification Gate (do first)

### [ARC-004] Exclude `.claude/worktrees/**` from vitest
- **Files**: `vitest.config.ts` (~line 15, the `exclude` array); also clean `.claude/worktrees/agent-a8b0d1d5559ec388d/` and `.worktrees/pardora-ios/`
- **Steps**:
  1. `Read` `vitest.config.ts`. Find the `test.exclude` array (currently includes `**/.worktrees/**`, `**/node_modules/**`, etc.).
  2. Add the string `"**/.claude/worktrees/**"` to that array.
  3. Verify no stale suite is collected: `npx vitest list 2>&1 | grep -c worktrees` should print `0`.
  4. (Optional hygiene, ARC-015) remove the abandoned worktree dirs: `git worktree remove .claude/worktrees/agent-a8b0d1d5559ec388d --force 2>/dev/null || rm -rf .claude/worktrees/agent-a8b0d1d5559ec388d`. Only do this if `git worktree list` confirms they are not active checkouts you need.
- **Method**: The existing glob `**/.worktrees/**` does not match `.claude/worktrees/` because the leading segment differs. This is a pure config addition — it cannot break real tests, only stop collecting a divergent copy whose `page.tsx` is 1,602 vs 1,721 lines. Do this first because until it lands, every later `make checkall` may fail for reasons unrelated to the fix under test.
- **Verify**: `npx vitest list 2>&1 | grep worktrees` returns nothing; then `make test` passes with a lower test count than before.

---

## Phase 1 — Critical Security (sequential, blocking)

### [SEC-001] Authentication boundary for mutating / subprocess-spawning routes
- **Files**: `middleware.ts` (new, project root), `package.json` (dev/start scripts), `next.config.ts` (rewrites), all `app/api/**/route.ts`
- **Steps**:
  1. Decide the boundary with the user if possible; default recommendation: **bind to loopback + shared-secret bearer token** so LAN/public clients must authenticate.
  2. In `package.json`, change `next dev -H 0.0.0.0` / `next start -H 0.0.0.0` to `-H 127.0.0.1` **only if** the LAN stream is no longer needed directly; otherwise keep the bind and rely on the token (below). Flag this change — it affects Pardora LAN discovery (`RadioEndpointResolver.swift`).
  3. Add `middleware.ts` at the repo root:
     - Export `const config = { matcher: ["/api/:path*"] }`.
     - In `middleware(req)`: allow unauthenticated **GET** to the read-only radio surface (`/api/radio` without a mutating action, and `/api/radio?stream=1`); require `Authorization: Bearer ${process.env.STABLE_AUDIO_API_TOKEN}` for everything else (all POST/PATCH/DELETE and `/api/generate`, `/api/assess/*`, `/api/library` writes).
     - Return `new NextResponse("Unauthorized", { status: 401 })` on mismatch. Use a constant-time compare (`crypto.timingSafeEqual`) on equal-length buffers.
  4. Add `STABLE_AUDIO_API_TOKEN` to `.env.example` (empty) and document in README env section (coordinate with DOC-002).
  5. In `next.config.ts`, ensure the `radio.pardev.net` rewrite forwards **only** the read-only stream/state path publicly, not the mutating POST surface. If the tunnel currently forwards all `/api/*`, restrict it.
- **Method**: Next.js middleware runs before route handlers and is the single choke point — do not add per-route checks (they drift). The read/write split matters: the public stream must stay open for listeners, but `deleteTrack`/`configure`/`DELETE /api/library` must not. Do not auto-generate the token; leave it for the user to set (security convention: never auto-create secrets).
- **Pitfalls**: Middleware runs on the Edge runtime by default — `crypto.timingSafeEqual` needs the Node runtime; add `export const runtime = "nodejs"` if needed, or use a Web Crypto constant-time compare. The Pardora app will need the token too; note this in the handoff, don't silently break it.
- **Verify**: `make typecheck` passes; manual: `curl -X POST localhost:3007/api/radio -d '{"action":"deleteTrack","filename":"x.mp3"}'` returns 401 without the header and proceeds with it; `curl localhost:3007/api/radio` (GET) still returns 200. Add a route test asserting 401 without the header.

### [SEC-002] Replace the Codex YouTube agent with deterministic yt-dlp/ffmpeg
- **Files**: `app/api/assess/youtube/route.ts` (`runCodexYouTubeExtraction` / `buildCodexExtractionPrompt`, ~lines 63–137)
- **Steps**:
  1. `Read` the whole route. Note the existing URL validation (`~lines 47–61`: http(s) + host allowlist) — **keep it**.
  2. Delete `buildCodexExtractionPrompt` and the `codex exec` spawn in `runCodexYouTubeExtraction`.
  3. Replace with a direct two-step subprocess (argument arrays, no shell): `yt-dlp -x --audio-format mp3 -o <outputPath> --no-playlist <url>` (or `yt-dlp -f bestaudio -o - <url>` piped to `ffmpeg`). Reuse the repo's `youtube-audio-extract` skill logic but call the binaries directly, not through an LLM agent.
  4. Resolve binary paths from env (`process.env.YT_DLP_PATH ?? "yt-dlp"`, `FFMPEG_PATH ?? "ffmpeg"`); pass the URL only as a positional argument (never interpolated into a shell string).
  5. Use the consolidated `runCommand` runner from ARC-007 if Phase 3b has landed; otherwise a local `spawn` with an `error` handler and SIGKILL escalation (see QA-002/ARC-007).
- **Method**: The task is deterministic extraction — an autonomous `workspace-write` agent with `approval_policy=never` is both unnecessary and the injection vector. `yt-dlp` already parses the page; no attacker text reaches an instruction-following model. Keep the host allowlist so SSRF surface stays bounded.
- **Pitfalls**: `yt-dlp` writes to `.stable-audio-assessments/uploads/` — keep that temp location and cleanup. Do not add the extracted MP3 to `public/outputs/` (existing behavior).
- **Verify**: `make typecheck` + `make test`; manual: a valid YouTube URL still produces a temp MP3 and a prompt; `grep -rn "codex" app/api/assess/youtube/route.ts` returns nothing.

### [SEC-004] Strip subprocess stdout/stderr from responses and persisted sidecars
- **Files**: `app/api/generate/route.ts:44`, `app/api/library/crop/route.ts:32`, `lib/library.ts:29,116` (persists Python `ProcessResult`)
- **Steps**:
  1. In `app/api/generate/route.ts`, change the error response from `detail: { ...result }` to a generic message (`error: "Generation failed"`); `console.error` the full `result` server-side (use the QA-006 logger once it exists).
  2. Same for `app/api/library/crop/route.ts:32` (`detail: result` → generic).
  3. In `lib/library.ts`, find where the `ProcessResult` is written into the sidecar (`~lines 29, 116`). Before persisting, drop `stdout`/`stderr` (and any absolute paths) from the metadata object. Keep exit code / timing if useful.
  4. Grep every catch block returning `error.message` to clients (`grep -rn "error.message" app/api`) and replace client-facing ones with generic strings; keep server-side logging.
- **Method**: This changes the `GenerationMetadata` shape read by `app/api/library`, bundle export, and tests — that is why it is sequenced early (blocks DOC-005 library docs and QA library edits). Do it before documenting or refactoring that contract.
- **Pitfalls**: Tests may assert on the sidecar shape (`lib/*.test.ts`, `app/api/library` tests). Update them to the new shape; do not weaken an assertion just to pass — confirm the field is genuinely removed.
- **Verify**: `make test` passes; `grep -rn "stderr\|stdout" lib/library.ts` shows they are no longer persisted; a failing generation returns a generic error with no host path.

### [SEC-003] Rate limiting + concurrency cap on subprocess-spawning routes
- **Files**: `app/api/generate/route.ts:41`, `app/api/radio/route.ts:302`, `app/api/assess/*`, `app/api/library/crop/route.ts`
- **Steps**:
  1. Create `lib/server/rate-limit.ts`: a simple in-memory token-bucket / fixed-window limiter keyed by client IP (from `x-forwarded-for` or the request), plus a global counter of in-flight subprocess jobs.
  2. Create (or reuse from ARC-005) a `lib/server/generation-semaphore.ts` exposing `acquire()/release()` with a max concurrency of 1–2.
  3. In each spawn route, `await` the semaphore before spawning and `release()` in `finally`; reject with 429 when the rate limit is exceeded.
  4. This overlaps ARC-005 (the semaphore); if ARC-005 lands first, reuse its semaphore here and only add the per-client rate limit.
- **Method**: Even with auth (SEC-001), a single trusted-but-buggy client can fan out N 900s inferences and exhaust unified memory. The semaphore is the correctness fix; the rate limit is defense-in-depth. Keep concurrency at 1 for model inference on Apple Silicon.
- **Pitfalls**: Do not deadlock the radio queue loop against user generation — they must share the **same** semaphore (see ARC-005 blocking note). Release in `finally` even on error/timeout.
- **Verify**: `make typecheck` + `make test`; manual: two concurrent `POST /api/generate` calls serialize (second waits) rather than both spawning Python.

---

## Phase 2 — Critical & Structural Architecture (sequential, blocking)

### [ARC-002] Locked, atomic-write radio state store (also fixes QA-003)
- **Files**: `app/api/radio/route.ts:998-1022` (`readRadioState`/`writeRadioState`), `:518-534`, `:827`; new `lib/server/radio-state-store.ts`; same pattern in `lib/audio-assessment.ts:388-400`
- **Steps**:
  1. Create `lib/server/radio-state-store.ts` exporting `readState()`, `mutateState(fn)`, and `defaultRadioState()` re-export.
  2. `mutateState(fn)` serializes through a module-level promise chain: `writeLock = writeLock.then(async () => { const s = await readFreshFromDisk(); const next = fn(s); await atomicWrite(next); return next; })`. Re-read inside the critical section — never pass a snapshot in.
  3. `atomicWrite`: write to `state.json.tmp` then `await fs.rename(tmp, "state.json")` (atomic on the same filesystem).
  4. `readFreshFromDisk`: on `ENOENT` return `defaultRadioState()`; on **parse error**, copy the corrupt file to `state.json.corrupt-<timestamp>` (timestamp passed in, since `Date.now()` — use a monotonic counter or the request time), `console.error`, and **throw** (do not silently return defaults).
  5. Replace all `readRadioState`/`writeRadioState` call sites in the route (POST handlers, `maintainRadioQueue`, `advanceStreamStateAfterTrack`) with `mutateState`. The queue loop must call `mutateState` at the moment it writes, not thread a snapshot across the multi-minute generation.
  6. Apply the same pattern to the assessment queue file in `lib/audio-assessment.ts:388-400` (or reuse a generic `atomicJsonStore` helper).
- **Method**: The app is single-process, so an in-process promise-chain mutex is sufficient — no file locks needed. The two bugs are independent: (a) lost updates from concurrent RMW, fixed by serialization + re-read; (b) total data loss from a torn read returning defaults then being overwritten, fixed by distinguishing ENOENT from parse errors + atomic writes. Fix both together.
- **Pitfalls**: Do this **before** any fix that adds new `writeRadioState` writers (QA-004, QA-007, QA-011, QA-014) or they widen the race. HMR re-evaluates the module and resets `writeLock` — pin it to `globalThis` (coordinate with ARC-005). The corrupt-file backup needs a timestamp; `Date.now()` is fine in app code (only workflow scripts forbid it).
- **Verify**: `make test` (existing radio route tests must still pass); add a test that a concurrent thumbs-up + queue write don't lose the rating, and that a truncated `state.json` throws + backs up rather than wiping. Manual: corrupt `state.json` by hand, hit `/api/radio`, confirm a `.corrupt-*` backup appears and state is not reset.

### [ARC-001] Declare the TTS dependency; remove `new Function` + hardcoded path (fixes QA-005, SEC-007)
- **Files**: `app/api/radio/route.ts:1478-1479, 1533-1538`; `package.json`; `next.config.ts`
- **Steps**:
  1. `Read` `resolveRadioTtsModulePath` (~1533) and the `new Function("createRequireFn", ...)` loader (~1478).
  2. In `package.json` dependencies, add the TTS core as a real dependency: `"par-tts-core-ts": "file:../par-tts-core-ts"` (or the published package name if one exists). Confirm the path with the user — do not assume the sibling repo layout.
  3. Replace the `new Function` loader with a normal top-level or dynamic `import("par-tts-core-ts")` (dynamic `import()` keeps it optional). Delete the hardcoded `/Users/probello/...` default path.
  4. If it must remain optional (not always installed), require `RADIO_TTS_MODULE_PATH` to be set explicitly and **throw a clear config error** if TTS is enabled but the module can't load — do not default to a personal path or silently no-op.
  5. Add `par-tts-core-ts` to `serverExternalPackages` in `next.config.ts` if the bundler tries to trace it.
  6. Keep the `TtsModule` structural type but align it with the real module's exports (import its types if available).
- **Method**: `new Function` existed only to defeat the bundler's static analysis of an undeclared dependency — declaring it removes the need. The eval indirection also hides the dep from `next build`, type checking, and audits.
- **Pitfalls**: **Manual review required (security convention)**: this touches module loading and sits next to `providerApiKey`/`readLocalEnvApiKey` (`~1503-1568`). The fix must **not** change how TTS API keys resolve — leave the `~/.claude/.env` fallback behavior exactly as-is (its own hardening is SEC-006, a separate Phase 3a issue). Flag this change; do not fold it into an unrelated commit.
- **Verify**: `make build` (Next build traces the import) + `make typecheck`; `grep -n "new Function\|/Users/probello" app/api/radio/route.ts` returns nothing; announcements still synthesize when the dep is present.

### [ARC-003] Extract the radio route into `lib/server/` services (fixes QA-008)
- **Files**: `app/api/radio/route.ts` → new `lib/server/radio-queue-service.ts`, `radio-stream.ts`, `radio-tts.ts`, `codex-client.ts`, `ollama-client.ts` (state store already extracted in ARC-002)
- **Steps**:
  1. Land ARC-002 (state store) and SEC-001 (auth middleware) **first** — both restructure this file.
  2. Extract in this order, running `make checkall` after each extraction (each is a self-contained move):
     - `codex-client.ts` — the `runCodexCli` invocation (read-only agents at `~894-945`).
     - `ollama-client.ts` — `ollamaGenerateUrl`/`ollamaTagsUrl`/request handling (`~453-501`); coordinate with ARC-006 which also touches Ollama (do ARC-006's `lib/server/ollama.ts` and reuse it here — same file).
     - `radio-tts.ts` — TTS provider/API-key resolution + synthesis (the `ensureMp3File`/`transcode*` helpers, `~1345-1442`).
     - `radio-stream.ts` — `streamCurrentTrack`, `readRadioStreamSegment`, ICY/MP3 helpers (`~620-834`).
     - `radio-queue-service.ts` — `maintainRadioQueue` + refill logic (`~518-534`).
  3. The route file keeps only: request parsing, the auth-gated action dispatch (convert the if-chain to a handler map — see ARC-009), and thin calls into the services.
- **Method**: This is the structural change most other radio fixes depend on. Extract before line-level fixes (QA-004, QA-006, QA-007, QA-011, QA-014) so those fixes land in the new modules, not in code about to move. Follow the phased-execution rule: one service per step, `make checkall` between.
- **Pitfalls**: The 1,535-line route test file references internal behavior; keep the public route contract identical so tests still pass, or move tests alongside the extracted modules. Do not change behavior during the move — extraction and bug-fixing are separate commits.
- **Verify**: `make checkall` after each extraction; the route file shrinks substantially; `wc -l app/api/radio/route.ts` well under 500.

### [ARC-006] Move `generateTitle` / Ollama client into `lib/server/ollama.ts` (fixes QA-013)
- **Files**: `app/api/generate/route.ts:8`, `app/api/generate-title/route.ts:19-50`, `app/api/radio/route.ts:453-501`; new `lib/server/ollama.ts`
- **Steps**:
  1. Create `lib/server/ollama.ts`; move `generateTitle`, `cleanTitle`, and the URL builders (`ollamaGenerateUrl`, `ollamaTagsUrl`) there.
  2. `app/api/generate-title/route.ts` imports from `lib/server/ollama.ts` and exports only its handler + route config.
  3. `app/api/generate/route.ts:8` changes `import { generateTitle } from "@/app/api/generate-title/route"` → `from "@/lib/server/ollama"`.
  4. `app/api/radio/route.ts` (or the `ollama-client.ts` from ARC-003) imports the shared builders instead of re-implementing them.
- **Method**: Route files are framework entry points; importing across them breaks under typed-routes validation and couples handlers. One Ollama client removes the drift between two `OLLAMA_BASE_URL` resolvers.
- **Pitfalls**: Coordinate with ARC-003 (`ollama-client.ts`) — they target the same radio code; do them as one unit or sequence ARC-006 first and have ARC-003 reuse `lib/server/ollama.ts`.
- **Verify**: `make typecheck`; `grep -rn "api/generate-title/route" app` shows no cross-route import remains; `make test`.

---

## Phase 3a — Security (remaining, parallel)

### [SEC-005] Security headers / CSP + origin check
- **Files**: `next.config.ts` (add `headers()`), `middleware.ts` (origin check)
- **Steps**:
  1. Add an async `headers()` to `next.config.ts` returning, for all routes: `Content-Security-Policy` (start report-only if unsure), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `Referrer-Policy: no-referrer`.
  2. In `middleware.ts` (from SEC-001), for mutating methods add an `Origin`/`Referer` same-origin check; reject cross-origin state-changing requests with 403.
- **Method**: The app is public via the tunnel and has no anti-CSRF; an origin check plus a token (SEC-001) covers it. Keep CSP report-only first to avoid breaking the SPA, then enforce.
- **Verify**: `make build`; `curl -I localhost:3007/` shows the headers; a cross-origin POST is rejected.

### [SEC-006] Stop reading `~/.claude/.env` for provider keys
- **Files**: `app/api/radio/route.ts:1503-1568` (`readLocalEnvApiKey`, `parTtsConfigPaths`)
- **Steps**:
  1. Change `providerApiKey` to read TTS keys only from `process.env` / the app's own `.env.local`.
  2. Remove or gate the `~/.claude/.env` and `~/Library/Application Support/par-tts/config.yaml` reads behind an explicit opt-in env flag; default off for a network-facing service.
  3. Add the provider keys (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY`) to `.env.example` (coordinate with DOC-002).
- **Method**: A network-facing app should not reach into global developer credentials; it broadens blast radius under SEC-001. Do this **after** ARC-001 (which touches the adjacent TTS loader) to avoid two edits colliding in the same tail of the file.
- **Verify**: `make typecheck` + `make test`; TTS still works when keys are in the app env; `grep -n ".claude/.env" app/api/radio/route.ts` shows the read is gated/removed.

### [SEC-008] Pin the Ollama base URL to loopback
- **Files**: `app/api/generate-title/route.ts:47-50`, `app/api/radio/route.ts:475-500` (or `lib/server/ollama.ts` after ARC-006)
- **Steps**:
  1. Default `OLLAMA_BASE_URL`/`OLLAMA_HOST` to `http://127.0.0.1:11434` when unset.
  2. Assert the resolved base URL host is loopback (or an explicit operator allowlist); never let any request field influence it.
- **Method**: Operator-controlled today (low risk), but there is no allowlist; pinning to loopback closes the SSRF door pre-emptively. Best done inside `lib/server/ollama.ts` after ARC-006 so it's fixed in one place.
- **Verify**: `make test`; title generation still works against local Ollama.

### [SEC-009] Prefer mDNS/config over LAN HTTP subnet scan
- **Files**: `apps/pardora-ios/Pardora/Services/RadioEndpointResolver.swift:84-96` (`lanCandidateOrigins`)
- **Steps**:
  1. Replace the `1..254` brute-force `http://` scan with either explicit server-address configuration or Bonjour/mDNS (`NWBrowser`) discovery of the advertised service.
  2. If keeping the scan as a fallback, bound concurrency and log that it runs.
- **Method**: Low severity — ATS is correct (`NSAllowsLocalNetworking`), so it's a design smell not a vuln. Deprioritize behind the server-side auth work; note it needs Pardora rebuild + simulator verification.
- **Verify**: `make pardora-checkall`; app still discovers the LAN server.

---

## Phase 3b — Architecture (remaining, parallel)

### [ARC-005] Generation-slot semaphore; globalThis-pinned singletons
- **Files**: `app/api/generate/route.ts`, `app/api/radio/route.ts:87`, `lib/audio-assessment.ts:74-75`; new `lib/server/generation-semaphore.ts`
- **Steps**:
  1. Create `lib/server/generation-semaphore.ts` with a max-concurrency-1 async semaphore, pinned to `globalThis` (`globalThis.__saGenSemaphore ??= createSemaphore(1)`).
  2. Wrap the Python spawn in `/api/generate`, the radio queue-refill generation, and the assessment processor in `acquire()`/`release()` (share the **same** semaphore).
  3. Pin `radioQueueMaintenance` (route.ts:87) and `queueProcessor`/`retryTimer` (audio-assessment.ts:74-75) to `globalThis` keyed by name so HMR doesn't spawn duplicates.
- **Method**: Module-scope singletons don't survive Next.js HMR re-evaluation; `globalThis` pinning does. A shared semaphore prevents two 7B inferences from exhausting unified memory. Reuse the semaphore from SEC-003 if that landed first — they're the same object.
- **Verify**: `make test`; manual: overlapping user-generate + radio-refill serialize; HMR reload doesn't produce two maintenance loops (add a log guard).

### [ARC-007] Unify subprocess runners into `lib/server/subprocess.ts` (fixes QA-010)
- **Files**: `app/api/generate/route.ts:54-70`, `app/api/radio/route.ts:602-618, 947-950`, `app/api/assess/youtube/route.ts:122-124`, `app/api/library/crop/route.ts:68`, `lib/audio-assessment.ts:466`; new `lib/server/subprocess.ts`
- **Steps**:
  1. Create `lib/server/subprocess.ts` exporting `runCommand(cmd, args, { timeoutMs, killGraceMs, cwd, env })` returning `{ code, stdout, stderr, timedOut }`.
  2. Implement the correct lifecycle: `spawn` with an argument array; `child.on("error", ...)` (fixes QA-002) that clears the timer and resolves with a non-zero code; on timeout send SIGTERM, then SIGKILL after `killGraceMs` (mirror `scripts/generate_audio.py:162-217`).
  3. Replace all six call sites with `runCommand`. Delete `runProcess`, `runStableAudioGeneratorProcess`, both `spawnRuntimeProcess` copies, and the crop/assessment variants.
- **Method**: Fix QA-002 and QA-010 **together** — patching the missing `error` handler in two places without consolidating recreates the divergence. The Python side already does SIGKILL escalation; the TS side must match so a hung ffmpeg/codex/python child can't wedge a route forever.
- **Verify**: `make test`; `grep -rn "spawn(" app lib | grep -v subprocess.ts` shows only the shared runner spawns; a missing-binary case resolves (not hangs).

### [ARC-008] Single authoritative model contract
- **Files**: `lib/generator-backend.ts:20-24`, `scripts/generate_audio.py:23-33`, `lib/generation.ts:3-7`
- **Steps**:
  1. Choose TS as authoritative: in `buildGeneratorArgs`, pass explicit `--dit`/`--decoder` derived from `stableAudioModelToMlx`, and delete `MODEL_MAP`/`MLX_MODEL_MAP` from the Python script (it just consumes the passed args).
  2. Keep the model id list in one place (the Zod enum) and derive `modelOptions` + any argparse `choices` from it, or drop the Python `choices` and validate server-side.
- **Method**: Two parallel sources of truth mean adding a model needs synchronized edits in 3+ places and fails at runtime, not compile time. Making TS authoritative moves the failure to type-check time.
- **Pitfalls**: The Python argparse currently rejects unknown models — if you remove `choices`, ensure TS validation is airtight first. Update `tests/test_generate_audio.py` accordingly.
- **Verify**: `make test` (both Vitest and Python unittest); a real generation still routes to the correct MLX dit/decoder.

### [ARC-009] Zod discriminated union for `/api/radio` POST
- **Files**: `app/api/radio/route.ts:116-343`, `lib/radio-playlist-response.ts` (export contract)
- **Steps**:
  1. Define a Zod discriminated union on `action` (one schema per action: `configure`, `createStyle`, `updateStyle`, `draftStyle`, `deleteStyle`, `deleteTrack`, `deleteFeedback`, `selectTrack`, `skipTrack`, `rating`, ...).
  2. Parse the body once at the top of POST; branch on the parsed, typed result via a handler map (combines with ARC-003's dispatch cleanup).
  3. Export the inferred request types alongside `radio-playlist-response.ts` as the shared Pardora contract.
- **Method**: Mirrors the well-designed `/api/generate` Zod schema. Best done during/after ARC-003's extraction so the handler map and validation land together.
- **Verify**: `make typecheck` + `make test`; malformed actions return 400 with a clear error; Pardora payloads still parse.

### [ARC-011] Split `lib/radio.ts` into `lib/radio/`
- **Files**: `lib/radio.ts` (1,481 lines) → `lib/radio/{types,styles,state,prompts,tts,urls}.ts` + `lib/radio/index.ts`
- **Steps**:
  1. Create `lib/radio/index.ts` re-exporting everything so the 60+ import sites (`@/lib/radio`) keep working unchanged.
  2. Move by concern: `types.ts` (interfaces/contracts), `styles.ts` (static style + TTS-voice catalogs), `state.ts` (queue/playback state machine), `prompts.ts` (template builders), `tts.ts` (voice helpers), `urls.ts` (playlist/stream builders).
  3. Keep functions byte-identical during the move (pure reorganization); run `make test` after each file split.
- **Method**: The code is already well-factored pure functions — this is packaging/cohesion only. The index re-export avoids a churny 60-site import rewrite.
- **Verify**: `make checkall`; `radio.test.ts` (~993 lines) passes unchanged; no import site outside `lib/radio/` changed.

### [ARC-012] Single station ticker; stream via file handles
- **Files**: `app/api/radio/route.ts:620-834` (or `lib/server/radio-stream.ts` after ARC-003)
- **Steps**:
  1. Introduce one station "ticker" (a single timer/loop) that owns track advancement and writes state; listeners become read-only subscribers.
  2. Replace whole-file `readFile` + `concatenateBytes` buffering with `createReadStream`/file handles so memory doesn't scale with track size × listeners.
- **Method**: Fine for single-household LAN today; becomes a memory + consistency problem for the public stream at >a few listeners (N buffered copies, N racing state-advancers compounding ARC-002). If the user confirms single-listener is the design, instead just **document that assumption** and downgrade this to a comment.
- **Pitfalls**: Depends on ARC-002 (state store) landing first, since the ticker centralizes the writes ARC-002 serializes.
- **Verify**: `make test`; manual: two simultaneous listeners don't double-advance the queue; memory stays flat with large tracks.

### [ARC-013] Add ESLint/Biome (fixes QA-018)
- **Files**: `package.json`, `Makefile:21-25`, new lint config
- **Steps**:
  1. Add Biome (covers lint + format in one tool) or ESLint + Prettier. Biome is the lighter choice given "no formatter configured."
  2. Wire `make lint` to run it (currently just `tsc --noEmit` — keep typecheck separate) and make `make fmt` actually format.
  3. Fix or baseline the initial findings; enable rules that would have caught QA-002 (`no-floating-promises`, a spawn/error rule) and unused exports.
- **Method**: 10k+ lines of TS with no linter; the QA-002-style inconsistencies are exactly what a rule catches. Introduce with a non-blocking baseline so it doesn't fail the gate on day one.
- **Verify**: `make lint` runs the linter and passes; `make fmt` reformats idempotently.

### [ARC-014] CI workflow running `make checkall`
- **Files**: `.github/workflows/ci.yml` (new)
- **Steps**:
  1. Add a workflow (Node + Python setup) running `make checkall` on push/PR.
  2. Pin action versions to exact tags (per git-ci guidance); do not use floating majors.
- **Method**: The only gates today are local; CI would catch env-coupled regressions like ARC-001 (the hardcoded path). Keep it minimal — one job.
- **Verify**: The workflow file is valid YAML (`make test` pre-commit YAML check); it runs green once dependencies install.

### [ARC-015] Repository hygiene
- **Files**: `output/playwright/audio-assessment-radio.png`, `.worktrees/`, `.claude/worktrees/`, `components/`
- **Steps**:
  1. `git rm --cached output/playwright/audio-assessment-radio.png` and add the path to `.gitignore`.
  2. Remove abandoned worktrees (see ARC-004 step 4).
  3. Either populate `components/` (with QA-009's extractions) or remove the empty dir.
- **Method**: Tracked artifacts and empty structural dirs mislead; the worktrees are the ARC-004 root cause.
- **Verify**: `git status` clean of the artifact; `make test` unaffected.

### [ARC-016] Centralize env config; move UI copy out of the schema
- **Files**: new `lib/server/config.ts`, `lib/generation.ts`
- **Steps**:
  1. Create `lib/server/config.ts` resolving the ~15 `STABLE_AUDIO_*`/`RADIO_*`/`OLLAMA_*` vars once, with typed getters and defaults.
  2. Move UI copy (`controlTips`, `promptTemplateGroups`) out of `lib/generation.ts` (which holds the server Zod schema) into a client-only module so routes don't drag UI strings into the server bundle.
- **Method**: Scattered `process.env` reads and mixed server/UI concerns; a config module is the single source. Coordinate with DOC-002 (env-var docs read from the same list).
- **Verify**: `make build` + `make test`; `grep -rn "process.env" app lib | wc -l` drops substantially.

---

## Phase 3c — Code Quality (all remaining, parallel)

### [QA-001] Cap assessment retries; dead-letter poison jobs
- **Files**: `lib/audio-assessment.ts:205-221`
- **Steps**:
  1. In the failure path, compare `job.attempts` against a cap (e.g. `MAX_ASSESSMENT_ATTEMPTS = 3`).
  2. Under the cap: requeue at the **tail** (`[...remaining, { ...job, attempts: job.attempts + 1 }]`), not the head, and schedule the next tick (return `deferred: true` or equivalent so the processor continues).
  3. At/over the cap: drop the job (or write it to a `dead-letter` list in the queue file) and continue with the rest.
- **Method**: The `attempts` counter is already incremented but never read; one consistently-failing track currently starves the whole queue forever across restarts. Tail-requeue + cap fixes both the ordering and the infinite loop.
- **Verify**: `make test`; add a test where a job fails 3× and confirm it's dead-lettered and later jobs process.

### [QA-002] Add `spawn` error handlers
- **Files**: `app/api/generate/route.ts:54-70`, `app/api/radio/route.ts:602-618`
- **Steps**: Fixed by **ARC-007** (consolidated `runCommand` with `child.on("error")`). If ARC-007 hasn't landed, add `child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e) }); })` to both runners now.
- **Method**: Do not fix in isolation from QA-010/ARC-007 — see the blocking note. A missing Python binary emits `error` without `close`, hanging the request 900s.
- **Verify**: `make test`; a bogus `STABLE_AUDIO_PYTHON` path resolves the request quickly instead of hanging.

### [QA-004] Verify segment with `stat` before push
- **Files**: `app/api/radio/route.ts:741-750` (or `lib/server/radio-stream.ts` after ARC-003)
- **Steps**:
  1. Move `segmentFiles.push({...})` to **after** a successful `await fs.stat(path)` (not a full read).
  2. On a missing non-primary segment, `continue` without pushing.
  3. Remove the discard-read used only for existence (it double-reads each segment).
- **Method**: Currently the missing file is pushed before the existence probe, so `readRadioStreamSegment` still tries it. Depends on ARC-002/ARC-003 (new writers/moved code) — do after.
- **Verify**: `make test`; a stream with a missing announcement plays the primary track without erroring.

### [QA-006] Minimal logger; warn in behavior-changing fallbacks
- **Files**: `app/api/radio/route.ts` (18 empty catches) + others; new `lib/server/logger.ts`
- **Steps**:
  1. Add a tiny `lib/server/logger.ts` (`warn`/`error` wrapping `console`, optionally gated by `DEBUG`).
  2. In each catch that changes behavior — TTS failure (`~1345-1347`), Codex distillation (`~855-857`), queue-refill (`~527-531`), Ollama draft (`~468`) — log a warning with context.
  3. Leave genuinely-benign parse-or-default catches empty (or log at debug).
- **Method**: There is currently zero logging in server code, so the radio degrades invisibly. Distinguish behavior-changing failures (log) from parse-or-default (silent). Do after ARC-003 so logs land in the new modules.
- **Verify**: `make test`; manual: force a TTS failure and confirm a warning is emitted.

### [QA-007] `stat` for existence; validate MP3 once, not re-transcode
- **Files**: `app/api/radio/route.ts:1374-1383` (`ensureMp3File`), `:1494-1501` (`fileExists`)
- **Steps**:
  1. Replace `fileExists`'s full read with `await fs.stat(path).then(() => true, () => false)`.
  2. Replace `ensureMp3File`'s ffmpeg re-transcode + byte-compare with a one-time MP3 validation (check header bytes / magic, or record `isMp3: true` in the sidecar after first transcode) so unchanged files aren't re-transcoded on every stream start.
- **Method**: The current code pays a full ffmpeg transcode of an unchanged file on every announcement check, and transcoding isn't byte-idempotent so it likely rewrites each time. Depends on ARC-002/ARC-003.
- **Verify**: `make test`; manual: repeated stream starts don't re-transcode existing MP3s (check mtime stability).

### [QA-009] Split God components into `components/` (≡ ARC-010)
- **Files**: `app/page.tsx` (1,721 lines), `app/radio/RadioStationClient.tsx` (1,531 lines) → `components/*`
- **Steps**:
  1. Extract the inline components (`LibraryPanel`, `ReferenceTrackDropZone`, comparison, generator form) into `components/`.
  2. Group related `useState` into `useReducer` slices or custom hooks (`useLibrary`, `useReferenceAnalysis`, `useRadioQueueing`).
  3. Extract `generate()`'s 283-line batch loop into a `lib/` function (pure where possible) and unit-test it.
- **Method**: Both files are near the 2,000-line read budget and re-render everything on any state change. Extract incrementally, keeping behavior identical; add tests for the extracted batch logic (QA-012 overlap).
- **Verify**: `make build` + `make test`; the app renders identically (manual smoke test of generate + library + radio panels).

### [QA-011] Single shared bitrate constant
- **Files**: `app/api/radio/route.ts:84` (`RADIO_STREAM_BYTES_PER_SECOND`), `:1387`, `:1423` (ffmpeg `-b:a`), `:756` (resume offset)
- **Steps**:
  1. Define one constant pair (e.g. `RADIO_STREAM_KBPS = 128` and derive `RADIO_STREAM_BYTES_PER_SECOND = 128_000 / 8 = 16_000`).
  2. Use it for both the ffmpeg `-b:a ${RADIO_STREAM_KBPS}k` argument and the pacing/resume math.
- **Method**: The constant claims 192 kbps (24,000 B/s) but ffmpeg outputs 128 kbps, so announcement segments pace ~1.5× real-time and resume offsets land wrong. Pick one bitrate everywhere. Depends on ARC-002/ARC-003 (moved code).
- **Verify**: `make test`; manual: announcements play at correct speed; mid-track resume lands at the right position.

### [QA-012] Route/component tests for the generation path
- **Files**: `app/api/generate`, `app/api/generate-title`, `app/api/library/route.ts`, `app/api/library/bundle/route.ts`, `app/api/library/crop/route.ts`, `app/radio/RadioStationClient.tsx`
- **Steps**:
  1. Mirror the existing `app/api/assess/route.test.ts` pattern (temp cwd + env-var isolation) for each untested route: assert status codes, error mapping, and the QA-002 non-hang.
  2. Add at least smoke tests for `RadioStationClient.tsx`'s 12 fetch sites.
- **Method**: The primary product path has zero handler-level tests. Use the established isolation harness; don't mock away the behavior under test.
- **Verify**: `make test` with new tests passing; coverage of the routes visibly increases.

### [QA-014] Delete rethrow; fix dedupe/id mismatch
- **Files**: `app/api/radio/route.ts:761-763`, `lib/audio-assessment.ts:148 vs 157`
- **Steps**:
  1. Delete the `catch (error) { throw error; }` wrapper (pure noise).
  2. Decide whether `rating` participates in job identity. The id is `${filename}:${rating}` but dedupe checks `filename` only — so a re-rated track can never re-queue. Either make dedupe key on the full id, or make the id `filename`-only. Match the intended behavior (likely: a new rating **should** re-queue → dedupe on full id).
- **Method**: The mismatch silently drops legitimate re-assessments. Confirm intended semantics before choosing.
- **Verify**: `make test`; add a test that re-rating a track re-enqueues it (if that's the chosen behavior).

### [QA-015] Reserve filename with `wx` flag (TOCTOU)
- **Files**: `lib/library.ts:46-56` (`titleToFilename`)
- **Steps**:
  1. Between choosing a free slug (`readdir`) and the eventual write, atomically reserve it: create the sidecar or a placeholder with `fs.open(path, "wx")` (fails if it exists), retrying the next suffix on `EEXIST`.
- **Method**: The radio refill and a user generation can both claim the same slug between `readdir` and write, overwriting one output+sidecar. The `wx` flag makes reservation atomic.
- **Verify**: `make test`; add a test simulating two concurrent `titleToFilename` calls for the same title getting distinct names.

### [QA-016] Rename/fold `experiment-features.test.ts` (≡ DOC-018)
- **Files**: `lib/experiment-features.test.ts`
- **Steps**: Split its cases into `lib/generation.test.ts` and `lib/library.test.ts` (matching the modules it actually tests), or rename to a name that reflects its content. **Code Quality owns this — documentation agents must not do it.**
- **Method**: No `lib/experiment-features.ts` exists; the name causes coverage miscounts.
- **Verify**: `make test`; the referenced cases still run under their new home.

### [QA-017] Guard Swift force unwrap on settings URL
- **Files**: `apps/pardora-ios/Pardora/Services/RadioAppModel.swift:42`
- **Steps**: Replace `URL(string: serverOrigin)!` with a `guard let url = URL(string: serverOrigin) else { /* fallback */ }` defaulting to `RadioEndpointResolver.defaultPublicOrigin`.
- **Method**: An empty persisted `serverOrigin` returns nil and crashes at model init. The static-constant force unwraps elsewhere are acceptable.
- **Verify**: `make pardora-checkall`; add/adjust a test with an empty origin that doesn't crash.

### [QA-019] Export clamp limits from `lib/generation.ts`
- **Files**: `app/page.tsx:94-96`, `lib/generation.ts`
- **Steps**: Export the duration/steps/cfg bounds (380/50/12) from `lib/generation.ts` (where `normalizeGenerationRequest` enforces them) and import them into `page.tsx` instead of hardcoding.
- **Method**: The magic numbers must mirror server clamping; exporting one source prevents drift.
- **Verify**: `make typecheck` + `make test`.

### [QA-020] Faster `bytesEqual` / `crc32` / `write_mock_wav`
- **Files**: `app/api/radio/route.ts:1442`, `lib/library.ts:440`, `scripts/generate_audio.py:54-67`
- **Steps**: Use `Buffer.compare` for `bytesEqual`; use a table-driven CRC32 in `lib/library.ts`; batch `write_mock_wav` frames into one buffer + a single `writeframes`.
- **Method**: Micro-perf; the crc32 is ~8× slower on multi-MB bundle exports. Low priority.
- **Verify**: `make test` (crc32 output must be identical — it's a checksum; verify against a known value).

### [QA-021] Rename `prepared_audio_path` class
- **Files**: `scripts/audio_assessor_qwen_omni.py:178`
- **Steps**: Rename the snake_case context-manager class to `PreparedAudioPath` (or convert to `@contextmanager`); update references.
- **Method**: PEP 8 — classes are CapWords. Grep for the name first.
- **Verify**: `python3 -m unittest discover -s tests` passes.

### [QA-022] Comment / globalThis-pin module singletons
- **Files**: `app/api/radio/route.ts:87`, `lib/audio-assessment.ts:74-75`
- **Steps**: Covered by **ARC-005** (globalThis pinning). If ARC-005 isn't taken, at minimum add a comment documenting the single-process assumption.
- **Method**: See ARC-005.
- **Verify**: `make test`.

---

## Phase 3d — Documentation (all, parallel)

> Documentation agents modify only docs/README/docstrings — never core logic. DOC-004 and DOC-005 depend on ARC-003 (radio refactor) landing first (shapes/signatures move); sequence them after Phase 2 or write against the post-refactor code.

### [DOC-001] README Radio Station section
- **Files**: `README.md`
- **Steps**: Add a "Radio Station" section: what it is, opening `/radio`, LAN (`.m3u`/`.pls`) + public MP3 stream URLs, TTS provider config (`openai`/`elevenlabs`/`deepgram`/`gemini`/`kokoro-onnx`) and API-key fallback (`~/.claude/.env`), taste-profile behavior, queue/auto-fill model. Update the TOC and Roadmap.
- **Verify**: Section renders; links resolve; env vars referenced match DOC-002.

### [DOC-002] Full environment-variable reference
- **Files**: `README.md`, `.env.example`
- **Steps**: `grep -rn "process.env\.\|os.environ" app lib scripts` to enumerate every var; add each to `.env.example` (comment + default) and mirror in the README grouped by subsystem (generation / radio / TTS / Ollama / assessor). Include the ~26 vars listed in AUDIT.md DOC-002.
- **Verify**: `grep -o "process.env.[A-Z_]*" -r app lib | sort -u` every entry appears in `.env.example`.

### [DOC-003] Regenerate Project layout
- **Files**: `README.md`
- **Steps**: Rebuild the tree from the current repo (include `app/radio/`, `app/api/radio/`, `app/api/generate-title/`, all `lib/*`, `scripts/*`, `tests/`, `apps/pardora-ios/`, `skills/`, `CHANGELOG.md`, `docs/`), one-line purpose per entry.
- **Verify**: Every listed path exists (`while read p; do test -e "$p"; done`).

### [DOC-004] API reference for all routes
- **Files**: `docs/reference/api.md` (new); mark `docs/superpowers/specs/2026-05-27-pardora-ios-design.md` historical
- **Steps**: Document `/api/generate`, `/api/generate-title`, `/api/library` (GET/PATCH/DELETE), `/api/library/bundle`, `/api/library/crop`, `/api/assess`, `/api/assess/upload`, `/api/assess/youtube`, `/api/radio` (GET/stream/POST actions) with request/response JSON and error tables. **Write against the post-ARC-003/ARC-009 shapes.**
- **Verify**: Examples match the current route code (spot-check request bodies against handlers).

### [DOC-005] JSDoc on `lib/` exports
- **Files**: `lib/radio.ts` (or `lib/radio/*` after ARC-011), `lib/audio-assessment.ts`, `lib/library.ts` first; then the rest
- **Steps**: Add a module-level header per file and one-line JSDoc per export (param/return notes where non-obvious — units on timeouts, load ratios, invariants of the queue state machine). **Write against post-refactor signatures (ARC-003/ARC-011).**
- **Verify**: `make typecheck` (JSDoc doesn't break types); spot-check that the three large modules have headers + per-export docs.

### [DOC-006] Backfill CHANGELOG history + tags
- **Files**: `CHANGELOG.md`
- **Steps**: Add a `[0.1.0]` entry (source: README "What's new — v0.1.0"); record radio/assessment/Pardora under `[Unreleased]` or a cut `0.2.0`; make the README link to CHANGELOG.md instead of duplicating. (Tagging is a git action — recommend, don't perform, unless asked.)
- **Verify**: Keep-a-Changelog format intact; README no longer duplicates the changelog.

### [DOC-007] Pardora iOS README
- **Files**: `apps/pardora-ios/README.md` (new)
- **Steps**: Prerequisites (xcodegen, Xcode version), the `make pardora-*` workflow, target overview (iOS/watchOS/CarPlay/Live Activity), signing (Team ID `QMLVG482FY`), and the `/api/radio` contract pointer (with SEC-001's token note).
- **Verify**: Commands match the root Makefile `pardora-*` targets.

### [DOC-008] Document title/autoTitle
- **Files**: `README.md`
- **Steps**: Document `title`/`autoTitle`, `/api/generate-title` (Ollama phi4-mini), and title-derived filenames (`"Neon Pulse"` → `neon_pulse.mp3`, `_2` duplicate suffix, `_sfx` for SFX) in the quick-start and Output-and-metadata sections, noting the Ollama prerequisite.
- **Verify**: Filename examples match `titleToFilename` in `lib/library.ts` (uses `_N`, not `-N`).

### [DOC-009] Populate/remove Roadmap
- **Files**: `README.md`
- **Steps**: Fill "Where we're going" or remove the empty heading; refresh "Where we are" to include radio/assessment/Pardora.
- **Verify**: No empty headings remain.

### [DOC-010] Document assessment queue; fix threshold-as-env claim
- **Files**: `README.md`, `CLAUDE.md`
- **Steps**: Document the persisted load-throttled queue (`.stable-audio-assessments/queue.json`, pause at load ratio, survives restarts) in the README; in `CLAUDE.md` clarify that `AUDIO_ASSESSMENT_LOAD_THRESHOLD` is a hardcoded exported constant, not an env var.
- **Verify**: `grep -n AUDIO_ASSESSMENT_LOAD_THRESHOLD lib/audio-assessment.ts` confirms it's a `const`, and CLAUDE.md no longer implies it's configurable.

### [DOC-011] Fix skill doc inaccuracies
- **Files**: `skills/stable-audio/SKILL.md`
- **Steps**: Change documented duplicate suffix `-2`/`-3` → `_2`/`_3`; rewrite the self-contradictory `autoTitle` description ("used only when `title` is absent"); document the `_sfx` slug suffix.
- **Verify**: Descriptions match `titleToFilename` behavior in `lib/library.ts`.

### [DOC-012] Troubleshooting guide
- **Files**: `docs/troubleshooting/common-errors.md` (new)
- **Steps**: symptom/cause/fix/verify entries for: gated-model 401s, missing ffmpeg/ffprobe, Ollama not running, assessor first-run timeouts, MLX weight download failures, port 3007 conflicts, `codex`/`yt-dlp` absent. Link from README.
- **Verify**: Each entry names the real env var / binary involved.

### [DOC-013] CONTRIBUTING.md
- **Files**: `CONTRIBUTING.md` (new)
- **Steps**: Dev setup, verification gates (`make checkall`, `make pre-commit`), conventional commits, the no-formatter/typecheck-only stance (note this changes if ARC-013 lands — coordinate).
- **Verify**: Commands match the Makefile.

### [DOC-014] Fix drifted CLAUDE.md size claims
- **Files**: `CLAUDE.md`
- **Steps**: Drop the "~1200 lines" and "largest source file" claims (actuals: `page.tsx` 1,721, `app/api/radio/route.ts` 1,568, `lib/radio.ts` 1,481) or make them qualitative.
- **Verify**: No brittle line counts remain.

### [DOC-015] Python function docstrings
- **Files**: `scripts/generate_audio.py`, `scripts/audio_assessor_qwen_omni.py`
- **Steps**: One-line docstrings on `terminate_process_tree`, `trim_generated_ids`, `sequence_has_prompt_prefix`, `normalize_assessment` (and peers).
- **Verify**: `python3 -m unittest discover -s tests` still passes.

### [DOC-016] Replace hardcoded home paths in setup
- **Files**: `README.md`, `.env.example`
- **Steps**: Replace `/Users/probello/...` in the MLX symlink script and `.env.local` example with `$(pwd)` or `<REPO_ROOT>`.
- **Verify**: `grep -rn "/Users/probello" README.md .env.example` returns nothing.

### [DOC-017] Architecture diagram
- **Files**: `docs/architecture/system-overview.md` (new)
- **Steps**: One Mermaid component/data-flow diagram (browser UI → API groups → Python bridges → assessment queue → streaming → Pardora). Use the dark-mode colors from global prefs.
- **Verify**: Mermaid renders (no syntax error).
