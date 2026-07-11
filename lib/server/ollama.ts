// Shared Ollama client for the routes that talk to a local Ollama instance.
//
// Previously `generate-title/route.ts` owned `generateTitle`/`cleanTitle` and an
// Ollama base-URL resolver, while `radio/route.ts` re-implemented the same
// resolver plus a `/api/tags` variant. `generate/route.ts` then imported
// `generateTitle` from the `generate-title` ROUTE module — a cross-route import
// that Next.js typed-routes validation rejects on extra exports. This module
// is the single home for those concerns so route files export only their
// handlers.
//
// Environment fallbacks are preserved exactly:
//   * `OLLAMA_BASE_URL` wins; otherwise `http://${OLLAMA_HOST ?? "127.0.0.1"}:${OLLAMA_PORT ?? "11434"}`
//   * `OLLAMA_TITLE_MODEL` (default `phi4-mini`) selects the title-generation model.
//
// All env reads go through `@/lib/server/config` (ARC-016).

import { ollamaBaseUrl as configuredOllamaBaseUrl, ollamaHost, ollamaPort, ollamaTitleModel } from "./config";
import { logWarn } from "./logger";

const TITLE_SYSTEM_PROMPT = `You are a creative music title generator. Given a description of audio, generate a short, evocative title (2-6 words). Return ONLY the title text with no quotes, no punctuation at the end, no explanation. Be creative and concise. The mode is {mode}.`;

/** Resolve the configured Ollama base URL (no trailing slash). */
function resolveOllamaBaseUrl(): string {
  return configuredOllamaBaseUrl() ?? `http://${ollamaHost()}:${ollamaPort()}`;
}

/** Full URL for the Ollama `/api/generate` completion endpoint. */
export function ollamaGenerateUrl(): string {
  return new URL("/api/generate", resolveOllamaBaseUrl()).toString();
}

/** Full URL for the Ollama `/api/tags` model-list endpoint. */
export function ollamaTagsUrl(): string {
  return new URL("/api/tags", resolveOllamaBaseUrl()).toString();
}

/** Strip surrounding quotes and trailing punctuation from a model-generated title. */
export function cleanTitle(raw: string): string {
  let title = raw.trim();
  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1);
  }
  title = title.replace(/[.,!?]+$/, "");
  return title.trim();
}

/**
 * Ask Ollama for a short creative title for `prompt` (an audio description).
 * Returns `null` on any failure (network, non-OK, empty result) so callers can
 * fall back to a slug. Timeout is fixed at 15s, matching the original behavior.
 */
export async function generateTitle(prompt: string, mode: string): Promise<string | null> {
  const model = ollamaTitleModel();
  const systemPrompt = TITLE_SYSTEM_PROMPT.replace("{mode}", mode);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(ollamaGenerateUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, system: systemPrompt, prompt, stream: false }),
      signal: controller.signal,
    });
  } catch (error) {
    // Behavior-changing fallback: the caller (generate route / title route)
    // falls back to a slug-derived filename when no title comes back. Warn so a
    // down/misconfigured Ollama is diagnosable rather than silently disabling
    // auto-title (QA-006).
    logWarn("Ollama title generation request failed; falling back to default title", {
      error: error instanceof Error ? error.message : String(error),
      model,
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) return null;

  const data = await response.json();
  const title = cleanTitle(data.response ?? "");
  return title || null;
}
