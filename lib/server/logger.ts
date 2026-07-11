// Minimal structured logger for non-test server code.
//
// Before this module the server side had ~44 empty `catch {}` blocks and zero
// logging, so operationally significant fallbacks (TTS synthesis failure, Codex
// taste distillation failure, queue-refill generation failure, Ollama draft
// failure, stream-segment concat fallback) degraded silently with no way to
// diagnose why (QA-006). These wrappers add a consistent `[stable-audio]`
// prefix and collapse errors to a single-line, structured-ish JSON string so
// log aggregators and `next dev` console output can surface them.
//
// Design constraints (deliberately kept simple, no new dependencies):
//   * No control-flow change anywhere — these are `console.*` wrappers only.
//     Callers still return their fallback value; logging is pure observability.
//   * Errors are rendered as a single-line JSON object (message + stack hint)
//     so a multi-line traceback can't split one event across log lines.
//   * `Error` instances are serialized without their full stack (which embeds
//     absolute host paths); the `name` + `message` is enough to diagnose, and
//     the full stack stays available in the surrounding `console.error` output.
//
// Test files do NOT import this module — keep failures loud and unmediated
// during test runs.

const LOG_PREFIX = "[stable-audio]";

/** Log an informational message. Use for normal lifecycle events. */
export function logInfo(message: string, context?: Record<string, unknown>): void {
  if (context) console.info(LOG_PREFIX, message, serializeContext(context));
  else console.info(LOG_PREFIX, message);
}

/** Log a warning about a behavior-changing fallback (degraded mode, retry, default). */
export function logWarn(message: string, context?: Record<string, unknown>): void {
  if (context) console.warn(LOG_PREFIX, message, serializeContext(context));
  else console.warn(LOG_PREFIX, message);
}

/** Log an error from an unexpected failure. The caller still owns recovery. */
export function logError(message: string, error?: unknown, context?: Record<string, unknown>): void {
  const parts = [LOG_PREFIX, message];
  if (error !== undefined) parts.push(serializeError(error));
  if (context) parts.push(serializeContext(context));
  console.error(...parts);
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    // Keep it single-line and free of full stack traces (which carry host
    // paths). The name + message is the diagnostic signal; anything more lives
    // in the surrounding console output.
    return JSON.stringify({ error: error.name, message: error.message });
  }
  if (typeof error === "string") return JSON.stringify({ error: "Error", message: error });
  try {
    return JSON.stringify({ error: "UnknownError", value: error });
  } catch {
    return JSON.stringify({ error: "UnknownError" });
  }
}

function serializeContext(context: Record<string, unknown>): string {
  try {
    return JSON.stringify(context);
  } catch {
    return JSON.stringify({ note: "unserializable context" });
  }
}
