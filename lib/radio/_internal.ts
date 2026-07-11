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

export function cleanShortText(value: string, fallback: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, maxLength);
}

export function compactTimestamp(value: string) {
  return value.replace(/[-:.TZ]/g, "").slice(0, 14);
}

export function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

export function shortHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function nextTimestamp(previous: string) {
  const now = Date.now();
  const previousMs = Date.parse(previous);
  return new Date(Number.isFinite(previousMs) && now <= previousMs ? previousMs + 1 : now).toISOString();
}
