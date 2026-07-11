# ENH-004 — Generation result cache / request-signature dedupe

## Goal
Return instantly for identical generation requests instead of re-running inference. Generation is deterministic given (prompt, seed, model, steps, cfgScale, duration, mode), so a match on that signature can short-circuit to the existing output.

## Current-State Context
- `/api/generate` (`app/api/generate/route.ts`) validates via the Zod schema in `lib/generation.ts` (`normalizeGenerationRequest`) then spawns inference.
- Outputs + JSON sidecars live in `public/outputs/`; sidecars already store the full generation settings.
- Seeds are explicit (batch seed generation in `lib/generation.ts`); a fixed seed makes output reproducible, which is what makes caching sound.
- Random-seed requests (seed omitted / randomized) must **not** be cached (each is intentionally unique) — the cache applies only when a concrete seed is present.

## Implementation Steps
1. **Define the signature**: a stable hash of the normalized request fields that determine output — `{ prompt, seed, model, steps, cfgScale, duration, mode }`. Use a sorted-key JSON string → SHA-256 (Node `crypto`). Exclude cosmetic fields (title, notes).
2. **Build an index** (`lib/server/generation-cache.ts`, new): a map from signature → output filename, persisted to a small JSON file (e.g. `.stable-audio-cache/index.json`) using the **same atomic-write + locked pattern** as the audit's ARC-002 state store (reuse that helper). On startup, lazily rebuild from existing sidecars if the index is missing.
3. **Lookup in `/api/generate`**: after normalization, if the request has a concrete seed, compute the signature and look it up. On hit, verify the referenced file still exists (`stat`), then return the existing item's metadata immediately (optionally cloning to a new title if the user supplied one) without spawning inference.
4. **Populate on miss**: after a successful generation, write the signature→filename mapping into the index.
5. **Respect duplicates**: title-derived filenames already de-dupe with `_N` suffixes; the cache keys on generation parameters, not filename, so a cache hit reuses the *audio* even under a new title.
6. **Config**: `GENERATION_CACHE_ENABLED` (default true), documented in `.env.example`/README (DOC-002). A `?nocache=1` escape hatch forces regeneration.
7. **Invalidation**: if the model weights or backend change (e.g. a new MLX version), the same params could produce different audio — include a `backendVersion` token in the signature so an upgrade transparently misses the old cache.

## Files to Touch
- `lib/server/generation-cache.ts` (new; reuses the ARC-002 atomic-store helper)
- `app/api/generate/route.ts` (lookup + populate)
- `lib/generation.ts` (expose the fields used for the signature, if not already)
- `lib/server/config.ts` (ARC-016), `.env.example`, `tests/`

## Verification Commands
- `make test`: unit-test the signature (same inputs → same hash; changing any output-determining field → different hash; random-seed request → not cacheable); integration-test that a second identical request with a fixed seed returns without spawning Python (mock the runner and assert it's not called).
- `make typecheck` + `make build`.
- Manual: generate with a fixed seed, then re-submit the identical request — the second returns near-instantly and points at the same audio; add `?nocache=1` and confirm it regenerates.

## Rollback Considerations
- Gated behind `GENERATION_CACHE_ENABLED`; disabling it makes `/api/generate` always spawn inference (today's behavior).
- The cache never deletes or mutates audio — worst case a stale mapping points at a removed file, which the `stat` check catches and falls through to regeneration. Safe by construction.
- The `backendVersion` token in the signature prevents serving audio from an older backend after an upgrade; bump it on any inference-affecting change.
- Rollback = flip the flag; the index file is inert and can be deleted.
