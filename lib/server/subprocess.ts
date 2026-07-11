// Single subprocess runner for every route and service that spawns a child.
//
// Replaces the five near-duplicate runners flagged by ARC-007 / QA-010
// (`runProcess` in generate + crop, `runStableAudioGeneratorProcess` in the
// radio queue, `runCodexCli`'s spawner, the youtube route's `runCommand`) and
// the four duplicated `spawnRuntimeProcess` helpers. It also closes QA-002:
// every caller now gets an `error` handler so a missing binary (ENOENT, which
// emits `error` without `close`) can no longer hang the request until the
// route's `maxDuration`.
//
// The lifecycle mirrors the model Python side (`scripts/generate_audio.py`:
// `terminate_process_tree`): on timeout send SIGTERM, wait `killGraceMs`, then
// SIGKILL. Signal handlers are not installed on the Node side because the
// child runs in its own process group only when the caller opts in via
// `startNewSession`; the SIGTERM→SIGKILL escalation here is the equivalent
// guarantee that a stuck child cannot outlive its parent's timeout.

import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";

export type RunCommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type RunCommandOptions = {
  timeoutMs: number;
  /** Grace period between SIGTERM and SIGKILL on timeout. Default 2000ms. */
  killGraceMs?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Optional streaming callbacks for callers that process output as it arrives. */
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  /**
   * stdin handling:
   *   - string/Buffer: written then the pipe is closed (assessor JSON, codex prompt)
   *   - "ignore":      stdio[0] = "ignore" (no stdin pipe at all)
   *   - undefined:     stdin pipe is closed immediately (EOF), matching callers
   *                     that never feed the child stdin (generate, crop, yt-dlp)
   */
  stdin?: string | Buffer | "ignore";
  /** Tail-truncate captured stdout to this many chars. Default 8000. */
  stdoutLimit?: number;
  /** Tail-truncate captured stderr to this many chars. Default 8000. */
  stderrLimit?: number;
  /** Pass through to spawn() (e.g. for a custom stdio arrangement). */
  spawnOptions?: SpawnOptions;
  /** Start the child in a new session (process-group isolation). */
  startNewSession?: boolean;
};

const DEFAULT_KILL_GRACE_MS = 2_000;
const DEFAULT_STDOUT_LIMIT = 8_000;
const DEFAULT_STDERR_LIMIT = 8_000;

/**
 * Spawn `cmd` with an argument array (never a shell), capture stdout/stderr,
 * and resolve once the child exits or fails to spawn. Guarantees:
 *
 *   * an `error` handler is always attached (QA-002: ENOENT no longer hangs),
 *   * timeouts escalate SIGTERM → `killGraceMs` → SIGKILL,
 *   * the promise resolves exactly once.
 *
 * Returns `{ code, stdout, stderr, timedOut }`. `timedOut` is true when the
 * timeout fired; `code` is the child's exit code (null if it was killed without
 * a clean exit). Callers that need to throw on failure inspect `code`/`timedOut`.
 */
export function runCommand(command: string, args: string[], options: RunCommandOptions): Promise<RunCommandResult> {
  const {
    timeoutMs,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    env = process.env,
    cwd = process.cwd(),
    onStdout,
    onStderr,
    stdin,
    stdoutLimit = DEFAULT_STDOUT_LIMIT,
    stderrLimit = DEFAULT_STDERR_LIMIT,
    spawnOptions,
    startNewSession,
  } = options;

  const stdio: SpawnOptions["stdio"] = stdin === "ignore"
    ? ["ignore", "pipe", "pipe"]
    : ["pipe", "pipe", "pipe"];

  const child = spawn(command, args, {
    cwd,
    env: { ...env },
    stdio,
    ...(startNewSession ? { detached: true } : {}),
    ...spawnOptions,
  });

  return runChild(child, {
    timeoutMs,
    killGraceMs,
    onStdout,
    onStderr,
    stdin: stdin === "ignore" ? undefined : stdin,
    stdoutLimit,
    stderrLimit,
  });
}

/**
 * Low-level spawner for callers that need custom promise logic over the raw
 * child (e.g. the ffmpeg transcode wrappers that collect binary MP3 stdout as
 * Buffers and reject on non-zero). Replaces the four duplicated
 * `spawnRuntimeProcess` helpers. The caller owns the lifecycle (timeout, error
 * handler, stdin) — this just removes the spawn() duplication.
 *
 * Returns `ChildProcessWithoutNullStreams` (matching the prior helpers) because
 * every caller spawns with the default pipe stdio; callers passing a custom
 * `stdio` arrangement take responsibility for the resulting stream types.
 */
export function spawnProcess(command: string, args: string[], options: SpawnOptions = {}): ChildProcessWithoutNullStreams {
  return spawn(command, args, options) as ChildProcessWithoutNullStreams;
}

type RunChildOptions = {
  timeoutMs: number;
  killGraceMs: number;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  stdin?: string | Buffer;
  stdoutLimit: number;
  stderrLimit: number;
};

function runChild(child: ChildProcess, options: RunChildOptions): Promise<RunCommandResult> {
  const { timeoutMs, killGraceMs, onStdout, onStderr, stdin, stdoutLimit, stderrLimit } = options;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout: tail(stdout, stdoutLimit), stderr: tail(stderr, stderrLimit), timedOut });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      stderr += `\nTimed out after ${timeoutMs}ms`;
      try {
        child.kill("SIGTERM");
      } catch {
        /* child already gone */
      }
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* child already gone */
        }
      }, killGraceMs);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      onStdout?.(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      onStderr?.(chunk);
    });

    // QA-002: `error` fires for ENOENT (and other spawn failures) WITHOUT a
    // `close` event. Without this handler the promise never resolved and the
    // request hung until the route's maxDuration (900s for generate).
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      stderr += `\n${error.message}`;
      finish(1);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      finish(code);
    });

    if (child.stdin) {
      if (stdin !== undefined) child.stdin.end(stdin);
      else child.stdin.end();
    }
  });
}

function tail(value: string, limit: number): string {
  return value.length > limit ? value.slice(-limit) : value;
}
