# ENH-006 — Server-side library search index

## Goal
Scale library search past the in-memory client filter. Provide server-side search over title, prompt, and assessment attributes via `/api/library` query params, with pagination, so search stays fast as the library grows into the thousands.

## Current-State Context
- Search/filter today is client-side: `filterLibraryItems` / `libraryItemSearchText` in `app/page.tsx` (both exported and tested in `app/page.test.tsx`), operating over the full list the client already holds.
- `GET /api/library` (`app/api/library/route.ts`) lists `public/outputs/` filtered by `isSafeAudioFilename` (~line 33) and reads each sidecar — it returns everything, no query/pagination.
- Sidecars contain title, prompt, generation settings, annotations, and (when assessed) an `analysis` block.

## Implementation Steps
1. **Index model** (`lib/server/library-index.ts`, new): build an in-memory index from sidecars — for each item, a lowercased searchable blob (title + prompt + notes + analysis attributes) plus sortable fields (createdAt, rating, favorite, duration, model). Rebuild on demand and invalidate on library mutations (PATCH/DELETE/new generation).
2. **Cache invalidation**: track the outputs-dir mtime or maintain the index incrementally in the create/patch/delete paths of `app/api/library`. On a cache miss or staleness, rescan.
3. **Extend `GET /api/library`**: accept `?q=`, `?favorite=`, `?model=`, `?sort=`, `?order=`, `?limit=`, `?offset=`. Filter/sort/paginate server-side; return `{ items, total, offset, limit }`. Keep the no-query call backward-compatible (returns the same list shape, just optionally paginated).
4. **Ranking**: simple substring/token match is enough initially (mirror `libraryItemSearchText` semantics so results match today's behavior); rank exact-title matches first, then prompt, then analysis. Keep the algorithm shared/consistent with the client fallback.
5. **Client update**: `app/page.tsx` calls the API with query params and renders server results + pagination; keep `filterLibraryItems` as a client-side refinement for the current page only (instant typing feedback) but rely on the server for the full-corpus search.
6. **Assessment-aware search**: expose analysis attributes (genre, mood, tempo, etc.) as filterable facets since the assessor already extracts them — high-value differentiator.

## Files to Touch
- `lib/server/library-index.ts` (new)
- `app/api/library/route.ts` (query params, pagination; invalidate index on PATCH/DELETE)
- `app/api/generate/route.ts` (invalidate/insert on new output) — coordinate with the conflict map
- `app/page.tsx` (query-driven search + pagination; keep client filter for the current page)
- `tests/`, `app/page.test.tsx`

## Verification Commands
- `make test`: unit-test the index (query returns expected items, sort/pagination correct, analysis facets filter correctly); assert server results for a query match the existing `libraryItemSearchText` semantics on the same data.
- `make typecheck` + `make build`.
- Manual: with many items, search returns quickly and paginates; a newly generated item appears in search without a full restart (invalidation works).

## Rollback Considerations
- Backward compatible: `GET /api/library` with no query params returns the same shape as today (optionally paginated — keep a large default `limit` or an `?all=1` to preserve exact behavior).
- The index is in-memory and derived from sidecars (the source of truth), so it can be dropped/rebuilt with no data loss.
- Rollback = ignore the query params server-side and revert the client to full-list + `filterLibraryItems`. No migration.
- Watch the conflict map: `app/api/library/route.ts` and `app/api/generate/route.ts` are edited by several audit items — read current state before editing.
