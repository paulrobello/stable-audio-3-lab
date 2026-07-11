// Single owner of `.stable-audio-radio/state.json`.
//
// All radio state reads and writes go through this module. It provides three
// primitives:
//
//   * `readRadioState()` — read-only snapshot for stream/GET callers. Returns
//     `defaultRadioState()` for a legitimate first run (ENOENT) and for a
//     corrupt file (the corrupt copy is backed up by `readJsonWithBackup`
//     before this returns, so the station keeps running but the failure is
//     visible in the logs).
//   * `writeRadioState(state)` — atomic (tmp + rename), serialized write for
//     callers that already hold the next state.
//   * `mutateRadioState(fn)` — the safe read-modify-write path: acquires the
//     per-path lock, re-reads state INSIDE the critical section, applies `fn`,
//     and writes atomically. This is the fix for the lost-update race flagged
//     by the audit, where the background queue loop held a stale snapshot
//     across a multi-minute generation and then clobbered a thumbs-up that a
//     POST had recorded in the meantime. If `fn` returns the same object
//     reference it was given, the write is skipped (no-op short-circuit).
//
// The persisted shape is `buildRadioStreamState(state)` and the read path runs
// it through `normalizeRadioState`, matching the pre-refactor on-disk format
// exactly (the radio route test asserts on this JSON).

import path from "node:path";
import {
  buildRadioStreamState,
  defaultRadioState,
  normalizeRadioState,
  type RadioState,
} from "@/lib/radio";
import { readJsonWithBackup, withFileLock, writeJsonAtomicUnlocked } from "./atomic-json-store";

/** Path to the radio station state file. */
export function statePath(): string {
  return path.join(process.cwd(), ".stable-audio-radio", "state.json");
}

/** Read-only snapshot. Safe to call concurrently with mutations. */
export async function readRadioState(): Promise<RadioState> {
  return readRadioStateUnlocked();
}

/**
 * Atomic, serialized write of a fully-formed state.
 *
 * Prefer `mutateRadioState` for read-modify-write sequences: a state computed
 * from a stale snapshot can still clobber a newer write here because the read
 * happened outside the lock. Use this only when you already hold an up-to-date
 * state or are writing unconditionally.
 */
export async function writeRadioState(state: RadioState): Promise<void> {
  await withFileLock(statePath(), () => writeRadioStateUnlocked(state));
}

/**
 * Serialized read-modify-write. `fn` is applied to a FRESH read taken inside
 * the per-path lock, so a snapshot held across a long generation can't
 * overwrite a newer write. If `fn` returns the same reference it was passed,
 * no write occurs.
 */
export async function mutateRadioState(fn: (state: RadioState) => RadioState): Promise<RadioState> {
  return withFileLock(statePath(), async () => {
    const current = await readRadioStateUnlocked();
    const next = fn(current);
    if (next !== current) await writeRadioStateUnlocked(next);
    return next;
  });
}

// --- lock-free internals (only call from inside `withFileLock` or `readRadioState`) ---

async function readRadioStateUnlocked(): Promise<RadioState> {
  const result = await readJsonWithBackup(statePath());
  if (result.status === "ok") {
    return normalizeRadioState(result.data as Partial<RadioState>);
  }
  // `missing` (first run) and `corrupt` (already backed up + logged) both fall
  // back to defaults so the station keeps running. The corrupt case is visible
  // via the console.error emitted by readJsonWithBackup.
  return defaultRadioState();
}

async function writeRadioStateUnlocked(state: RadioState): Promise<void> {
  // Lock-free atomic write — the caller (writeRadioState / mutateRadioState)
  // already holds the per-path lock.
  await writeJsonAtomicUnlocked(statePath(), buildRadioStreamState(state));
}
