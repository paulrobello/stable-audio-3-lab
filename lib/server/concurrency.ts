// In-process admission control for subprocess-spawning routes.
//
// Two opt-in, fail-open controls shared across /api/generate, the radio queue
// generator, /api/assess*, and /api/library/crop:
//
//   * withGenerationSlot  — a globalThis-pinned semaphore capping the number of
//     concurrent heavy subprocesses. Survives Next.js dev HMR and route-module
//     re-instantiation because the singleton lives on globalThis.
//
//   * checkMutatingRateLimit — a per-client token bucket intended for the auth
//     middleware, throttling mutating /api/* requests. State is in-memory only;
//     a cold isolate reset simply allows traffic (fail-open) until the bucket
//     refills.
//
// Both controls are env-tunable. They never reject configuration: bad values
// fall back to the documented default, and any internal error fails open so a
// restart cannot wedge the app.
//
// Raw env values are read through `@/lib/server/config` (ARC-016) so this module
// holds no direct `process.env` references; the clamp/fallback logic stays here
// because it is specific to admission control.

import { envStringOptional } from "./config";

const DEFAULT_MAX_CONCURRENT = 1;
const DEFAULT_RATE_PER_MINUTE = 30; // 0 disables rate limiting
const MINUTE_MS = 60_000;
const MAX_BUCKETS = 2_000; // bound memory; evict the whole table past this

type SlotState = { active: number; waiters: Array<() => void> };
type Bucket = { tokens: number; lastRefillMs: number };
type AdmissionStore = { slot: SlotState; buckets: Map<string, Bucket> };

const STORE_KEY = "__stableAudioAdmission__";

function getStore(): AdmissionStore {
  const g = globalThis as unknown as Partial<Record<typeof STORE_KEY, AdmissionStore>>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = { slot: { active: 0, waiters: [] }, buckets: new Map() };
  }
  return g[STORE_KEY]!;
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return Math.min(Math.max(rounded, min), max);
}

/** Maximum number of heavy subprocesses that may run concurrently. */
function maxConcurrent(): number {
  return clampInt(envStringOptional("STABLE_AUDIO_MAX_CONCURRENT"), DEFAULT_MAX_CONCURRENT, 1, 8);
}

/**
 * Run `fn` while holding a generation slot. Requests beyond the configured
 * maximum (`STABLE_AUDIO_MAX_CONCURRENT`, default 1) wait in FIFO order. The
 * slot is released even if `fn` throws, so a crashed request cannot leak a
 * permit and wedge subsequent requests.
 */
export async function withGenerationSlot<T>(fn: () => Promise<T>): Promise<T> {
  const store = getStore();
  await new Promise<void>((resolve) => {
    const slot = store.slot;
    if (slot.active < maxConcurrent()) {
      slot.active += 1;
      resolve();
      return;
    }
    slot.waiters.push(() => {
      slot.active += 1;
      resolve();
    });
  });
  try {
    return await fn();
  } finally {
    const slot = store.slot;
    slot.active = Math.max(0, slot.active - 1);
    const next = slot.waiters.shift();
    if (next) next();
  }
}

/**
 * Per-client token-bucket rate limit for mutating routes.
 *
 * Returns `{ ok: true }` when the request is allowed (and consumes one token),
 * or `{ ok: false, retryAfterMs }` when the bucket is empty. A rate of 0
 * (via `STABLE_AUDIO_MUTATING_RATE_PER_MINUTE=0`) disables limiting. Any
 * internal error fails open.
 */
export function checkMutatingRateLimit(clientId: string): { ok: true } | { ok: false; retryAfterMs: number } {
  try {
    const ratePerMinute = clampInt(envStringOptional("STABLE_AUDIO_MUTATING_RATE_PER_MINUTE"), DEFAULT_RATE_PER_MINUTE, 0, 600);
    if (ratePerMinute <= 0 || !clientId) return { ok: true };

    const store = getStore();
    const capacity = Math.max(1, ratePerMinute);
    const refillPerMs = ratePerMinute / MINUTE_MS;
    const now = Date.now();

    let bucket = store.buckets.get(clientId);
    if (!bucket) {
      if (store.buckets.size >= MAX_BUCKETS) store.buckets.clear();
      bucket = { tokens: capacity, lastRefillMs: now };
      store.buckets.set(clientId, bucket);
    }

    const elapsed = Math.max(0, now - bucket.lastRefillMs);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
    bucket.lastRefillMs = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true };
    }
    const retryAfterMs = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs));
    return { ok: false, retryAfterMs };
  } catch {
    return { ok: true };
  }
}
