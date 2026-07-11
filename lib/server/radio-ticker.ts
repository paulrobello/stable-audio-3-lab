// ARC-012: the single wall-clock "ticker" that owns radio playback advancement.
//
// Listeners (radio-stream.ts `streamCurrentTrack`) are read-only subscribers:
// they read the current track + playback clock and stream bytes from the
// wall-clock offset (`getRadioPlaybackElapsedSeconds * BYTES_PER_SECOND`). They
// no longer advance station state when their segment is exhausted — this ticker
// is the sole owner of advancement. It calls the existing pure
// `synchronizeRadioPlayback` (advances `currentTrack` forward through history
// while `now - currentTrackStartedAt >= duration`) inside the locked state
// store, so the wall-clock math and the on-disk write are both centralized here.
//
// The ticker is listener-gated: a reference count of active stream listeners
// keeps it alive. `registerRadioStreamListener` increments it and starts a
// `setInterval` on the first listener; `releaseRadioStreamListener` decrements
// it and clears the interval at zero. With no stream connected the ticker does
// NOT run, so a plain `GET /api/radio` state poll never advances playback — the
// contract asserted by the "does not advance playback from a plain state poll"
// test. The interval is `.unref()`'d so it never keeps the process alive on its
// own (the listeners / open responses own liveness).
//
// The store is pinned to globalThis so it survives Next.js dev HMR (mirroring
// the pattern in ./concurrency.ts and ./radio-queue-service.ts): HMR re-evaluates
// module scope and would otherwise drop the ref count and leak a detached
// interval against the still-running station.

import { synchronizeRadioPlayback } from "@/lib/radio";
import { mutateRadioState, readRadioState } from "./radio-state-store";
import { startRadioQueueMaintenance } from "./radio-queue-service";
import { logError } from "./logger";

const RADIO_TICKER_KEY = "__stableAudioRadioTicker__";
const RADIO_TICKER_INTERVAL_MS = 500;

type RadioTickerStore = {
  listeners: number;
  interval: NodeJS.Timeout | null;
};

function tickerStore(): RadioTickerStore {
  const g = globalThis as unknown as Partial<Record<typeof RADIO_TICKER_KEY, RadioTickerStore>>;
  if (!g[RADIO_TICKER_KEY]) g[RADIO_TICKER_KEY] = { listeners: 0, interval: null };
  return g[RADIO_TICKER_KEY]!;
}

/**
 * Increment the active-listener count, starting the wall-clock advancement
 * ticker on the first listener. Safe to call multiple times per stream; pair
 * each call with {@link releaseRadioStreamListener}.
 */
export function registerRadioStreamListener(): void {
  const store = tickerStore();
  store.listeners += 1;
  if (store.interval) return;
  // First listener owns the kickoff. The interval drives advancement; it does
  // not keep the process alive on its own (`.unref()`).
  const handle = setInterval(tickRadioStation, RADIO_TICKER_INTERVAL_MS);
  handle.unref?.();
  store.interval = handle;
}

/**
 * Decrement the active-listener count, clearing the ticker when the last
 * listener disconnects. Idempotent and safe to call without a matching
 * register (the count is floored at zero).
 */
export function releaseRadioStreamListener(): void {
  const store = tickerStore();
  if (store.listeners <= 0) {
    store.listeners = 0;
    return;
  }
  store.listeners -= 1;
  if (store.listeners === 0 && store.interval) {
    clearInterval(store.interval);
    store.interval = null;
  }
}

/**
 * One wall-clock tick: snapshot the state, advance `currentTrack` as far as
 * elapsed playback duration warrants, and top up the queue when the current
 * track changed. Errors are logged, never thrown, so a single tick failure
 * can never kill the interval.
 */
async function tickRadioStation(): Promise<void> {
  try {
    const before = await readRadioState();
    const after = await mutateRadioState((state) => synchronizeRadioPlayback(state));
    const advanced = after.currentTrack?.filename !== before.currentTrack?.filename
      || after.currentTrackStartedAt !== before.currentTrackStartedAt;
    if (advanced) startRadioQueueMaintenance(after);
  } catch (error) {
    logError("Radio station ticker tick failed", error);
  }
}
