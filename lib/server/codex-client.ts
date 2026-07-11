// Read-only `codex exec` invocations for the radio station.
//
// Two agents live here, both run with `--sandbox read-only` and
// `approval_policy="never"` so they cannot mutate the repo tree:
//   * taste distillation — `distillRadioTasteProfile` turns a listener's
//     thumbs up/down into a `RadioTasteProfileInput` that rewrites future
//     generation prompts.
//   * style drafting — `draftRadioStyleWithCodex` turns a free-text request
//     into a `RadioStyleDraft`.
//
// Extracted verbatim from `app/api/radio/route.ts`; behavior is unchanged.

import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  buildRadioStyleGenerationPrompt,
  buildRadioTasteDistillationPrompt,
  normalizeRadioStyleId,
  parseRadioStyleDraft,
  type RadioState,
  type RadioStyleDraft,
  type RadioTasteProfileInput,
} from "@/lib/radio";
import { statePath } from "./radio-state-store";
import { runCommand } from "./subprocess";
import { logError } from "./logger";
import { radioCodexBin, radioCodexStyleModel, radioCodexTasteModel, radioCodexTasteTimeoutMs } from "./config";

// Runs the (slow) Codex taste distillation and returns the distilled profile +
// model so the caller can apply it to the freshest state inside the state lock.
// Returns undefined when there is no feedback to distill or distillation fails.
export async function distillRadioTasteProfile(state: RadioState, styleId: ReturnType<typeof normalizeRadioStyleId>): Promise<{ profile: RadioTasteProfileInput; model: string } | undefined> {
  const preference = state.preferences[styleId];
  if (!preference || preference.likes.length + preference.dislikes.length === 0) return undefined;
  try {
    const model = normalizeCodexTasteModel(radioCodexTasteModel());
    const profile = await runCodexTasteDistillation(state, styleId, model);
    return profile ? { profile, model } : undefined;
  } catch (error) {
    // Behavior-changing fallback: taste feedback is not distilled, so future
    // prompts are not adjusted toward/away from the listener's likes/dislikes.
    // Surface it so a broken/absent `codex` binary doesn't silently disable
    // taste learning (QA-006).
    logError("Radio Codex taste distillation failed; taste profile unchanged", error, {
      styleId,
      model: radioCodexTasteModel() ?? "unset",
    });
    return undefined;
  }
}

export async function draftRadioStyleWithCodex(requestInput: unknown): Promise<RadioStyleDraft | undefined> {
  const request = typeof requestInput === "string" ? requestInput.trim() : "";
  if (request.length < 3) return undefined;
  const model = normalizeCodexTasteModel(radioCodexStyleModel());
  const stateDir = path.dirname(statePath());
  await mkdir(stateDir, { recursive: true });
  const outputPath = path.join(stateDir, `codex-style-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  const prompt = buildRadioStyleGenerationPrompt(request);
  try {
    await runCodexCli(prompt, outputPath, model, "Codex style generation");
    const draft = parseRadioStyleDraft(await readFile(outputPath, "utf8"), request);
    return draft ? { ...draft, model } : undefined;
  } finally {
    await unlink(outputPath).catch((error: unknown) => {
      if (!isNotFoundError(error)) throw error;
    });
  }
}

async function runCodexTasteDistillation(state: RadioState, styleId: ReturnType<typeof normalizeRadioStyleId>, model: string): Promise<RadioTasteProfileInput | undefined> {
  const stateDir = path.dirname(statePath());
  await mkdir(stateDir, { recursive: true });
  const outputPath = path.join(stateDir, `codex-taste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  const prompt = buildRadioTasteDistillationPrompt(state, styleId);
  try {
    await runCodexCli(prompt, outputPath, model);
    return parseCodexTasteProfile(await readFile(outputPath, "utf8"));
  } finally {
    await unlink(outputPath).catch((error: unknown) => {
      if (!isNotFoundError(error)) throw error;
    });
  }
}

async function runCodexCli(prompt: string, outputPath: string, model: string, taskLabel = "Codex taste distillation") {
  const codexBin = radioCodexBin();
  const rawTimeout = radioCodexTasteTimeoutMs();
  // Preserve the original finite/positive guard so a malformed env value still
  // falls back to the 2-minute default rather than firing immediately.
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 120_000;
  const args = [
    "exec",
    "-m",
    model,
    "--cd",
    process.cwd(),
    "--sandbox",
    "read-only",
    "--config",
    "approval_policy=\"never\"",
    "--ephemeral",
    "--ignore-rules",
    "-o",
    outputPath,
    "-",
  ];
  // Delegates to the shared runner (ARC-007), keeping codex's own 1s SIGTERM →
  // SIGKILL grace and its `ignore`-stdout stdio arrangement. The runner attaches
  // the `error` handler (QA-002) and resolves `{ code, stderr, timedOut }`.
  const result = await runCommand(codexBin, args, {
    timeoutMs,
    cwd: process.cwd(),
    stdin: prompt,
    killGraceMs: 1_000,
    spawnOptions: { stdio: ["pipe", "ignore", "pipe"] },
  });
  if (result.timedOut) throw new Error(`${taskLabel} timed out`);
  if (result.code !== 0) throw new Error(`${taskLabel} failed: ${result.stderr.trim()}`);
}

function parseCodexTasteProfile(value: string): RadioTasteProfileInput | undefined {
  const parsed = JSON.parse(extractJsonObject(value)) as Record<string, unknown>;
  const profile = {
    likedTraits: readTasteArray(parsed, "likedTraits"),
    dislikedTraits: readTasteArray(parsed, "dislikedTraits"),
    promptDirectives: readTasteArray(parsed, "promptDirectives"),
    negativePromptDirectives: readTasteArray(parsed, "negativePromptDirectives"),
    explorationNotes: readTasteArray(parsed, "explorationNotes"),
  };
  return Object.values(profile).some((values) => values.length > 0) ? profile : undefined;
}

function readTasteArray(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeCodexTasteModel(value: unknown) {
  if (typeof value !== "string") return "gpt-5.5";
  const model = value.trim();
  return model && model.length <= 80 && !/[\s"'<>]/.test(model) ? model : "gpt-5.5";
}

function extractJsonObject(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return value;
  return value.slice(start, end + 1);
}

function isNotFoundError(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
