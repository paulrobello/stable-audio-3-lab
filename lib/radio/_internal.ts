// Low-level helpers shared across the `lib/radio/*` submodules.
//
// These were private (non-exported) utilities inside the original monolithic
// `lib/radio.ts`; they are factored out here so each domain module
// (styles / state / prompts / tts) can use them without duplicating logic and
// without forcing a circular dependency between domain modules.
//
// NOT re-exported by `lib/radio/index.ts` — they stay outside the package's
// public surface, matching the pre-split visibility. Other submodules import
// them via the relative `./_internal` path.

/** Collapse internal whitespace, fall back to `fallback` when empty, and truncate to `maxLength`. */
export function cleanShortText(value: string, fallback: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, maxLength);
}

/** Compact an ISO timestamp into a 14-digit, separator-free string (YYYYMMDDHHMMSS). */
export function compactTimestamp(value: string) {
  return value.replace(/[-:.TZ]/g, "").slice(0, 14);
}

/** Return a short random base-36 suffix (6 characters) for id entropy. */
export function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

/** Compute a short non-cryptographic base-36 hash of `value` (32-bit polynomial hash, multiplier 31). */
export function shortHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Return an ISO timestamp strictly greater than `previous`.
 *
 * Falls back to `now` when `previous` is missing/unparseable, or to
 * `previous + 1ms` when `now` would not advance it — guaranteeing monotonically
 * increasing `updatedAt` values across rapid successive state writes.
 */
export function nextTimestamp(previous: string) {
  const now = Date.now();
  const previousMs = Date.parse(previous);
  return new Date(Number.isFinite(previousMs) && now <= previousMs ? previousMs + 1 : now).toISOString();
}
