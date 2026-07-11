// Atomic, corruption-tolerant JSON persistence for server-side state files.
//
// Used by the radio state store (`.stable-audio-radio/state.json`) and the
// audio-assessment queue (`.stable-audio-assessments/queue.json`). Both files
// are mutated concurrently by POST handlers, background loops, and per-listener
// stream advancement; this module gives them three guarantees:
//
//   1. Atomic writes  — write to `<path>.tmp`, then `rename` over the target.
//      A crash mid-write never leaves a torn/half-written state file.
//   2. Serialized mutations — a per-path in-process mutex (promise chain) so
//      concurrent writers never interleave their read-modify-write.
//   3. Corruption handling — a torn/corrupt read is backed up to
//      `<path>.corrupt-<n>` and surfaced via `console.error`, so a bad read
//      is diagnosable rather than silently wiping state.
//
// The mutex is pinned to `globalThis` so it survives Next.js dev HMR and
// route-module re-instantiation (two module evaluations would otherwise create
// two independent lock maps and the serialization guarantee would be lost).
//
// We intentionally do NOT fsync: `rename` is atomic on POSIX/APEX, and the
// narrow power-loss window is acceptable for these regenerable state files.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const LOCK_KEY = "__stableAudioFileLocks__";
type LockMap = Map<string, Promise<unknown>>;

function getLockMap(): LockMap {
  const g = globalThis as unknown as Partial<Record<typeof LOCK_KEY, LockMap>>;
  if (!g[LOCK_KEY]) g[LOCK_KEY] = new Map();
  return g[LOCK_KEY]!;
}

/** Serialize access to one path. Calls are chained in arrival order per path. */
export function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const locks = getLockMap();
  const previous = locks.get(filePath) ?? Promise.resolve();
  const next = previous.then(fn, fn) as Promise<T>;
  locks.set(filePath, next);
  void next.finally(() => {
    if (locks.get(filePath) === next) locks.delete(filePath);
  });
  return next;
}

/**
 * Atomically write `value` as pretty JSON: tmp file then rename, WITHOUT taking
 * the per-path lock. Use this when the caller already holds the lock (e.g.
 * inside `withFileLock` or a mutate critical section) to avoid a non-reentrant
 * self-deadlock. Otherwise prefer `writeJsonAtomic`.
 */
export async function writeJsonAtomicUnlocked(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, filePath);
}

/** Atomically write `value` as pretty JSON, serialized with other writers. */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await withFileLock(filePath, () => writeJsonAtomicUnlocked(filePath, value));
}

export type JsonReadResult =
  | { status: "ok"; data: unknown }
  | { status: "missing" }
  | { status: "corrupt"; backedUpAs?: string; error: string };

/**
 * Read and parse JSON with corruption backup.
 *
 * - ENOENT → `missing` (caller decides whether that means "first run").
 * - Parse failure → back the bad bytes up to `<path>.corrupt-<n>` (the first
 *   free n, via an exclusive `wx` open so concurrent backups don't collide),
 *   log loudly, and return `corrupt`.
 * - Success → `ok` with the parsed value.
 *
 * Never throws for a missing or corrupt file; only re-throws unexpected OS
 * errors (permissions, EIO, …).
 */
export async function readJsonWithBackup(filePath: string): Promise<JsonReadResult> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) return { status: "missing" };
    throw error;
  }

  try {
    return { status: "ok", data: JSON.parse(contents) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const backedUpAs = await backupCorruptFile(filePath, contents);
    console.error(
      `[atomic-json-store] Corrupt JSON at ${filePath} (${message}); backed up to ${backedUpAs}. Returning no data so the caller can fall back to defaults.`,
    );
    return { status: "corrupt", backedUpAs, error: message };
  }
}

async function backupCorruptFile(filePath: string, contents: string): Promise<string | undefined> {
  for (let n = 1; n <= 1000; n += 1) {
    const dest = `${filePath}.corrupt-${n}`;
    try {
      await writeFile(dest, contents, { flag: "wx" });
      return dest;
    } catch (error) {
      if (isErrnoCode(error, "EEXIST")) continue;
      console.error(`[atomic-json-store] Could not back up corrupt file to ${dest}: ${error instanceof Error ? error.message : error}`);
      return undefined;
    }
  }
  return undefined;
}

function isErrnoCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
}
