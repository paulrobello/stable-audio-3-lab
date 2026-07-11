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

import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";
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

// Runs the (slow) Codex taste distillation and returns the distilled profile +
// model so the caller can apply it to the freshest state inside the state lock.
// Returns undefined when there is no feedback to distill or distillation fails.
export async function distillRadioTasteProfile(state: RadioState, styleId: ReturnType<typeof normalizeRadioStyleId>): Promise<{ profile: RadioTasteProfileInput; model: string } | undefined> {
  const preference = state.preferences[styleId];
  if (!preference || preference.likes.length + preference.dislikes.length === 0) return undefined;
  try {
    const model = normalizeCodexTasteModel(process.env.RADIO_CODEX_TASTE_MODEL);
    const profile = await runCodexTasteDistillation(state, styleId, model);
    return profile ? { profile, model } : undefined;
  } catch {
    return undefined;
  }
}

export async function draftRadioStyleWithCodex(requestInput: unknown): Promise<RadioStyleDraft | undefined> {
  const request = typeof requestInput === "string" ? requestInput.trim() : "";
  if (request.length < 3) return undefined;
  const model = normalizeCodexTasteModel(process.env.RADIO_CODEX_STYLE_MODEL ?? process.env.RADIO_CODEX_TASTE_MODEL);
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
  const codexBin = process.env.RADIO_CODEX_BIN || "codex";
  const timeoutMs = Number(process.env.RADIO_CODEX_TASTE_TIMEOUT_MS || 120000);
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
  const child = await spawnRuntimeProcess(codexBin, args, { cwd: process.cwd(), stdio: ["pipe", "ignore", "pipe"] });

  return new Promise<void>((resolve, reject) => {
    const stderr: Buffer[] = [];
    let timedOut = false;
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, 1000);
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000);

    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      if (timedOut) {
        reject(new Error(`${taskLabel} timed out`));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`${taskLabel} failed: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    child.stdin.end(prompt);
  });
}

// NOTE: `spawnRuntimeProcess` is duplicated across the extracted radio service
// modules (codex-client, radio-tts, radio-stream, radio-queue-service) because
// each was moved verbatim from the route. ARC-007 / QA-010 consolidate the five
// subprocess runners into one `lib/server/subprocess.ts`; until then the
// duplication is intentional and matches the pre-refactor state.
async function spawnRuntimeProcess(command: string, args: string[], options?: SpawnOptions): Promise<ChildProcessWithoutNullStreams> {
  const { spawn } = await import("node:child_process");
  return spawn(command, args, options ?? {}) as ChildProcessWithoutNullStreams;
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
