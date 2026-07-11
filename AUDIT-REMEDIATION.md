# Audit Remediation Report

> **Project**: Stable Audio 3 Lab
> **Audit Date**: 2026-07-10
> **Remediation Date**: 2026-07-10
> **Severity Filter Applied**: `all`
> **Branch**: `fix/audit-remediation` (base `2af79c5`, 13 commits)

---

## Execution Summary

| Phase | Status | Agent | Issues Targeted | Resolved | Partial | Manual/Deferred |
|-------|--------|-------|-----------------|----------|---------|-----------------|
| 0 — Verification gate | ✅ | inline | ARC-004 | 1 | 0 | 0 |
| 1 — Critical Security | ✅ | fix-security | SEC-001/002/003/004 | 4 | 0 | 0 |
| 2a — Critical Architecture | ✅ | fix-architecture | ARC-002/001 | 2 | 0 | ARC-001 manual-review flag |
| 2b — Structural Architecture | ✅ | fix-architecture | ARC-003/006 | 2 | 0 | 0 |
| 3b-A — Architecture (code) | ✅ | fix-architecture | ARC-005/007/008/009/016 | 5 | 0 | 0 |
| 3b-B — Architecture (structural) | ✅ | fix-architecture | ARC-011/012 | 1 | 1 | ARC-012 ticker redesign deferred |
| 3b-C — Architecture (tooling) | ✅ | inline + agent | ARC-013/014/015 | 2 | 1 | ARC-015 worktree pruning deferred |
| 3c-A — Code Quality (bounded) | ✅ | fix-code-quality | 11 QA issues | 11 | 0 | 0 |
| 3c-B — Code Quality (logger/batch) | ✅ | fix-code-quality | QA-006/009 | 1 | 1 | QA-009 panel split deferred |
| 3a — Security (remaining) | ✅ | fix-security | SEC-005/006/008/009 | 4 | 0 | SEC-006 migration; iOS verify |
| 3d — Documentation (all) | ✅ | fix-documentation | DOC-001…017 | 17 | 0 | 0 |
| 4 — Verification | ✅ | inline | — | — | — | — |

**Overall**: of 65 audited issues, **~60 fully resolved**, **4 partial** (delivered subset + documented remainder), **1 deferred** (QA-012 additive route tests). All Critical and High issues are resolved. The full `make checkall` gate (build + tests + typecheck) is green.

> Note: Phase 3 was run **sequentially in dependency order** rather than 4-way parallel. The radio service files (`lib/server/radio-*.ts`, `lib/audio-assessment.ts`, `lib/library.ts`) are touched by three of the four domains, so parallel agents would have clobbered shared files — the audit orchestrator's own guidance for heavy overlap is to serialize. The two genuinely file-disjoint lanes (3a security + 3d docs) were run in parallel at the end.

---

## Resolved Issues ✅

### Security (9/9)
- **[SEC-001]** Unauthenticated mutating API surface — `middleware.ts` (new) + all `app/api/**`. Opt-in bearer-token gate (`STABLE_AUDIO_ADMIN_TOKEN`); activates only when the token is set, GET + public radio stream left open.
- **[SEC-002]** Autonomous `codex exec` YouTube extraction — `app/api/assess/youtube/route.ts` rewritten to a deterministic `yt-dlp` + `ffmpeg` subprocess (fixed args, no LLM/agent surface).
- **[SEC-003]** Unbounded DoS via subprocess spawning — `lib/server/concurrency.ts` (globalThis-pinned generation slot, `STABLE_AUDIO_MAX_CONCURRENT`) across generate/radio/assess/crop + per-IP token-bucket rate limit.
- **[SEC-004]** Information disclosure — subprocess stdout/stderr stripped from client responses and persisted sidecars (`lib/library.ts` now stores only exit code); generic client errors.
- **[SEC-005]** No security headers/CSP — `next.config.ts` `headers()` block (strict CSP, nosniff, referrer-policy, frame-ancestors none) + same-origin check in middleware when auth is active.
- **[SEC-006]** `~/.claude/.env` key harvesting — `lib/server/radio-tts.ts` no longer reads the global agent env; provider keys resolve from `.env.local`/process env only. **Operator migration required** (see Manual).
- **[SEC-007]** (≡ ARC-001) `new Function` dynamic load — resolved with ARC-001.
- **[SEC-008]** SSRF-adjacent Ollama URL — `lib/server/ollama.ts` URL validated/locked to env-only loopback origin; request data can never reach it.
- **[SEC-009]** iOS LAN HTTP subnet scan — `RadioEndpointResolver.swift`/`RadioAppModel.swift` scan now opt-in (default off); explicit config preferred. **Needs `make pardora-checkall`.**

### Architecture (13 fully resolved + 3 partial; see Partial/Manual)
- **[ARC-001]** (≡ QA-005/SEC-007) Machine-specific TTS path via `new Function` — removed; loads via `createRequire` from `RADIO_TTS_MODULE_PATH` (env-only, fails clear when unset). API-key resolution unchanged. **Manual review.**
- **[ARC-002]** (≡ QA-003) Radio state races/silent wipe — `lib/server/{atomic-json-store,radio-state-store}.ts`: atomic temp-file+rename, in-process mutex that re-reads fresh inside the critical section, corrupt-file backup + loud log (no silent wipe).
- **[ARC-003]** (≡ QA-008) Radio god-module — route extracted 1,612 → 549 lines into `lib/server/{radio-queue-service,radio-stream,radio-tts,codex-client}.ts`; route holds only parse+dispatch+handlers.
- **[ARC-004]** (Phase 0) Stale worktree test suite — `.claude/worktrees/**` added to vitest exclude.
- **[ARC-005]** Module singletons re-instantiated under HMR — pinned to `globalThis` (radio queue, assessment processor/timer).
- **[ARC-006]** (≡ QA-013) Cross-route `generateTitle` import + duplicated Ollama client — consolidated into `lib/server/ollama.ts`; routes import from there.
- **[ARC-007]** (≡ QA-010) Five duplicated subprocess runners — unified into `lib/server/subprocess.ts` `runCommand` (SIGTERM→SIGKILL escalation + `error` handler); landed the QA-002 spawn-error-handler fix everywhere.
- **[ARC-008]** Duplicated model contract — TS-authoritative; Python MLX map deleted, consumes `--dit`/`--decoder` from the bridge.
- **[ARC-009]** 16-action unvalidated radio POST — Zod discriminated union in `lib/server/radio-actions.ts`.
- **[ARC-011]** `lib/radio.ts` 1,481-line monolith — split into `lib/radio/{types,styles,state,prompts,tts,urls,index}.ts` (barrel re-export; pure move).
- **[ARC-013]** (≡ QA-018) No linter — ESLint flat config + `eslint-config-next` + typescript-eslint; `make lint` runs tsc + eslint.
- **[ARC-014]** No CI — `.github/workflows/ci.yml` runs typecheck + test + build on push/PR.
- **[ARC-016]** Scattered env reads / UI copy in schema — `lib/server/config.ts` centralizes reads; UI copy moved to `lib/ui-presets.ts`.

### Code Quality (20 fully resolved + 1 partial + 1 deferred)
- **[QA-001]** (CRITICAL) Poison-pill queue — capped at 3 attempts, dead-lettered to `.stable-audio-assessments/dead-letter.json`, requeued at tail with backoff. + regression test.
- **[QA-002]** (CRITICAL) Missing `spawn` error handler — resolved via ARC-007's unified runner.
- **[QA-003]** (via ARC-002), **[QA-005]** (via ARC-001), **[QA-008]** (via ARC-003), **[QA-010]** (via ARC-007), **[QA-013]** (via ARC-006), **[QA-018]** (via ARC-013).
- **[QA-004]** Segment push before existence check — `stat` before push.
- **[QA-006]** 44 silent empty catches — `lib/server/logger.ts`; warnings in all behavior-changing fallbacks.
- **[QA-007]** Existence checks via full reads + re-transcode — `stat` for existence; MP3 validated by header bytes once.
- **[QA-011]** Bitrate contradiction — single 128 kbps constant drives ffmpeg + pacing + resume offset.
- **[QA-014]** Dead catch-rethrow + dedupe/id mismatch — rethrow removed; dedupe matches full job id (rating in identity).
- **[QA-015]** TOCTOU filename collision — reserved via exclusive `wx` flag.
- **[QA-016]** Misnamed `experiment-features.test.ts` — folded into `generation.test.ts`/`library.test.ts`.
- **[QA-017]** Swift force-unwrap — guarded with default-origin fallback.
- **[QA-019]** Duplicated clamp bounds — `GENERATION_LIMITS` exported from `lib/generation.ts`, used in `page.tsx`.
- **[QA-020]** Slow micro-impls — CRC32 lookup table, batched mock-WAV writes, header-byte MP3 check.
- **[QA-021]** `prepared_audio_path` → `PreparedAudioPath`.
- **[QA-022]** (via ARC-005) singletons pinned/commented.

### Documentation (18/18)
- **[DOC-001]** README Radio Station section; **[DOC-002]** full env-var reference (`.env.example` 193 lines + README); **[DOC-003]** regenerated project layout; **[DOC-004]** `docs/reference/api.md`; **[DOC-005]** ~146 JSDoc blocks + module headers across `lib/radio/`, `audio-assessment.ts`, `library.ts`; **[DOC-006]** CHANGELOG `[0.1.0]` backfill; **[DOC-007]** `apps/pardora-ios/README.md`; **[DOC-008]** title/autoTitle; **[DOC-009]** roadmap; **[DOC-010]** assessment queue + threshold-is-a-constant; **[DOC-011]** skill fixes (`_2`/`_3`, `_sfx`, autoTitle); **[DOC-012]** `docs/troubleshooting/common-errors.md`; **[DOC-013]** `CONTRIBUTING.md`; **[DOC-014]** CLAUDE.md qualitative sizes; **[DOC-015]** Python docstrings; **[DOC-016]** portable home paths; **[DOC-017]** `docs/architecture/system-overview.md` (Mermaid); **[DOC-018]** (≡ QA-016).

---

## Partial / Requires Manual Intervention 🔧

### [SEC-006] — Operator must migrate TTS provider keys (REQUIRED ACTION)
- **Why**: The app no longer reads `~/.claude/.env`. Until keys are moved, DJ announcements for the affected provider are skipped (the stream keeps playing).
- **Action**: Copy `OPENAI_API_KEY` / `ELEVENLABS_API_KEY` / `DEEPGRAM_API_KEY` / Gemini keys from `~/.claude/.env` into the app's `.env.local`.
- **Effort**: small.

### [SEC-001] / [ARC-001] — Manual review of auth + TTS-load design
- **Why**: Auth boundary is an opt-in shared-secret bearer token (no rotation/expiry); the TTS module-load mechanism and env-var-only config choice should be eyeballed by a human. For the public `radio.pardev.net` exposure, also ensure the public tunnel does **not** forward `/api/radio` POST.
- **Effort**: small (review).

### [QA-009] / [ARC-010] — God-component panel decomposition (PARTIAL)
- **What landed**: the 283-line `generate()` batch loop was extracted into pure, tested `lib/generation-batch.ts` (`runGenerationBatch`/`planGenerationBatch` + unit test).
- **Deferred**: the full panel-by-panel split of `app/page.tsx` (~1,721 lines) and `RadioStationClient.tsx` (~1,531 lines) into `components/` with `useReducer` slices. With no component tests and no interactive verification available in this run, blind UI refactoring was judged too risky.
- **Effort**: medium-large (needs interactive UI verification + ideally component tests first — see QA-012).

### [ARC-012] — Single station ticker (PARTIAL)
- **What landed**: the single-listener/LAN assumption + memory characteristic documented in `lib/server/radio-stream.ts`.
- **Deferred**: the full behavior-changing ticker redesign (single state owner, read-only listeners via `createReadStream`) — needs its own test strategy.
- **Effort**: medium-large.

### [ARC-015] — Abandoned worktree pruning (PARTIAL)
- **What landed**: untracked the `output/playwright/audio-assessment-radio.png` artifact; root `/output/` gitignored.
- **Deferred**: removing the locked `.claude/worktrees/agent-*` and `.worktrees/pardora-ios` worktrees. They are already gitignored and neutralized by ARC-004; force-removing a locked worktree is destructive and is a human decision.
- **Effort**: small (run `git worktree remove` / `git worktree prune` after confirming no uncommitted work).

### [QA-012] — Route/component tests (DEFERRED)
- **Why**: additive test coverage (Medium). The 3c-B agent was killed by a mid-task API error before reaching this; a focused follow-up is cleaner than rushing subprocess/fetch-mocked route tests.
- **Action**: add `app/api/{generate,generate-title,library/crop}/route.test.ts` mirroring `app/api/assess/route.test.ts`, and a `RadioStationClient` smoke test.
- **Effort**: medium.

### Pardora iOS verification (operator action)
- The Swift changes (SEC-009 opt-in LAN scan, QA-017 force-unwrap guard) could not be verified here (no Xcode toolchain in this env). Run `make pardora-checkall` before shipping.

### Minor follow-ups
- **`middleware.ts` → `proxy.ts`**: Next.js 16 emits a deprecation warning ("middleware" → "proxy"). The auth file works; rename when convenient.
- **ESLint backlog**: 15 warnings (12 `react-hooks/set-state-in-effect` in the god components, resolved by QA-009; 3 benign) — triage over time.

---

## Verification Results

- **Build** (`make build`, Next.js 16.2.10 Turbopack): ✅ Pass — all 14 routes generated.
- **Tests** (`npx vitest run`): ✅ Pass — 208/208 across 17 files (was 202 at audit; +6 new tests: poison-job dead-letter, generation-batch plan/run).
- **Python tests** (`python3 -m unittest`): ✅ Pass — 11/11.
- **Type Check** (`tsc --noEmit`, `strict: true`): ✅ Pass — 0 errors.
- **Lint** (`eslint .`): ✅ Pass — 0 errors, 15 warnings (exit 0).
- **Pardora iOS** (`make pardora-checkall`): ⚠️ Not run in this environment — operator must verify Swift changes.

No regressions: every phase was verified (tsc + vitest, plus the full `make checkall`) before its checkpoint commit. The live-editor diagnostics that appeared during the run (SourceKit single-file Swift "cannot find type", Pyright "torch import unresolvable", `page.tsx` serialization hints) were all confirmed as environment artifacts, not real errors — the authoritative `tsc`/`eslint`/`next build` gates are clean.

---

## Files Changed

**13 commits, 76 files changed (+15,742 / −3,605)** on `fix/audit-remediation` (base `2af79c5`). Highlights:

**New source modules** (`lib/server/`): `concurrency.ts`, `atomic-json-store.ts`, `radio-state-store.ts`, `ollama.ts`, `codex-client.ts`, `radio-tts.ts`, `radio-queue-service.ts`, `radio-stream.ts`, `subprocess.ts`, `config.ts`, `radio-actions.ts`, `logger.ts`. **`lib/radio/`** package (7 files) split from the old monolith. `lib/generation-batch.ts`, `lib/ui-presets.ts`, `middleware.ts`.

**New docs**: `docs/reference/api.md`, `docs/architecture/system-overview.md`, `docs/troubleshooting/common-errors.md`, `apps/pardora-ios/README.md`, `CONTRIBUTING.md`, `.github/workflows/ci.yml`, `eslint.config.mjs`.

**Deleted**: `lib/radio.ts` (split into `lib/radio/`), `lib/experiment-features.test.ts` (folded), `output/playwright/audio-assessment-radio.png` (untracked).

**Modified**: all `app/api/**/route.ts`, `lib/{generation,generator-backend,library,audio-assessment}.ts`, `scripts/*.py`, `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `.env.example`, `skills/stable-audio/SKILL.md`, `next.config.ts`, `package.json`, `Makefile`, `vitest.config.ts`, and the two Pardora Swift files.

Run `git diff 2af79c5..HEAD` for the full change set; `git log --oneline 2af79c5..HEAD` for the per-phase commits (each is a clean rollback point).

---

## Next Steps

1. **SEC-006 migration (required before radio TTS works again)**: move provider keys from `~/.claude/.env` into `.env.local`.
2. **Verify iOS**: run `make pardora-checkall` for the SEC-009/QA-017 Swift changes.
3. **Review the two flagged-for-manual items** (SEC-001 auth design, ARC-001 TTS load) before public exposure; ensure the public tunnel does not forward mutating `/api/radio` POST.
4. **Pick up the deferred items** when capacity allows: QA-012 (route/component tests) → QA-009 (god-component split, which also clears the 12 ESLint warnings) → ARC-012 (ticker) → ARC-015 (worktree pruning).
5. **Re-run `/audit`** to confirm the residual posture (should drop from 65 issues to ~5 deferred/partial).
