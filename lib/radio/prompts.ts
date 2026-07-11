// Radio prompt builders, prompt-draft creators, and taste-distillation logic.
//
// Owns the Ollama prompt-model catalog/normalizer, the per-style prompt seed
// builder, the taste-distillation prompt + applier, the style-draft request
// builder/parser, and the prompt-draft factories (Ollama + deterministic
// fallback). All functions are pure: they take state/style inputs and return
// strings or new state objects without side effects.

import type {
  RadioState,
  RadioStyleId,
  RadioStyle,
  RadioStyleDraft,
  RadioPromptDraft,
  RadioPromptProvider,
  RadioTasteProfile,
  RadioTasteProfileInput,
  RadioTrackRecord,
} from "./types";
import { cleanShortText, compactTimestamp, randomSuffix, nextTimestamp } from "./_internal";
import { getRadioStyle, normalizeRadioStyleId } from "./styles";

export const radioOllamaModels = [
  "llama3.1:8b",
  "gemma3:12b",
  "phi4:14b",
  "qwen2.5:14b",
  "mistral-small:24b",
  "gemma3:27b",
] as const;

const DEFAULT_PROMPT_MODEL = radioOllamaModels[0];
const RADIO_ENDING_GUIDANCE = "play as one complete song through the full requested duration, with an outro only at the end; do not restart and do not begin a second song";

export { DEFAULT_PROMPT_MODEL };

export function normalizeOllamaPromptModel(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_PROMPT_MODEL;
  const model = value.trim();
  if (!model || model.length > 80 || /[\s"'<>]/.test(model)) return DEFAULT_PROMPT_MODEL;
  return model;
}

export function buildRadioStyleGenerationPrompt(requestInput: unknown): string {
  const request = typeof requestInput === "string" ? cleanShortText(requestInput, "", 500) : "";
  return [
    "Create a custom Stable Audio 3 radio music style from the user's request.",
    "Translate references into broad, reusable musical traits such as instrumentation, tempo feel, arrangement arc, mood, mix character, and negative constraints.",
    "Return JSON only with string fields: label, seedPrompt, negativePrompt.",
    "Keep label under 40 characters. Keep seedPrompt under 700 characters. Keep negativePrompt under 300 characters.",
    "",
    `User request: ${request || "a distinctive instrumental radio style"}`,
    "",
    "Return JSON only.",
  ].join("\n");
}

export function parseRadioStyleDraft(rawResponse: string, requestInput: unknown): RadioStyleDraft | undefined {
  try {
    const parsed = JSON.parse(extractJsonObject(rawResponse)) as Partial<Record<"label" | "seedPrompt" | "negativePrompt", unknown>>;
    const request = typeof requestInput === "string" ? requestInput : "";
    const label = typeof parsed.label === "string" ? cleanShortText(parsed.label, "Custom Style", 80) : cleanShortText(request, "Custom Style", 80);
    const seedPrompt = typeof parsed.seedPrompt === "string" ? cleanShortText(parsed.seedPrompt, "", 1000) : "";
    const negativePrompt = typeof parsed.negativePrompt === "string"
      ? cleanShortText(parsed.negativePrompt, "recognizable melodies, vocals, clipping, harsh noise", 500)
      : "recognizable melodies, vocals, clipping, harsh noise";
    if (label.length < 2 || seedPrompt.length < 8) return undefined;
    return { label, seedPrompt, negativePrompt };
  } catch {
    return undefined;
  }
}

export function buildRadioPromptSeed(state: RadioState, styleIdInput: unknown): string {
  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles, state.deletedStyleIds);
  const style = getRadioStyle(styleId, state.customStyles, state.deletedStyleIds);
  const preference = state.preferences[styleId];
  const likes = preference?.likes?.length ? `Lean into: ${preference.likes.slice(-6).join("; ")}` : "Lean into: fresh variations within the style.";
  const dislikes = preference?.dislikes?.length ? `Avoid repeating: ${preference.dislikes.slice(-6).join("; ")}` : "Avoid repeating: generic stock music, vocals, and brittle mixes.";
  const tasteProfile = buildRadioTasteProfileSeed(preference?.tasteProfile);
  const recentTitles = state.history.slice(-8).map((track) => track.title).filter(Boolean);
  const recentPrompts = state.history.slice(-3).map((track) => track.prompt).filter(Boolean);
  const uniqueness = recentTitles.length
    ? `Already queued titles: ${recentTitles.join("; ")}. Do not reuse these titles or near-identical arrangements.`
    : "Already queued titles: none. Create a clearly new title and arrangement.";
  const recentDirections = recentPrompts.length
    ? `Recent prompt directions to move away from: ${recentPrompts.join(" | ")}`
    : "Recent prompt directions to move away from: none.";

  return [
    `Style: ${style.label}`,
    `Base direction: ${style.seedPrompt}`,
    likes,
    dislikes,
    tasteProfile,
    uniqueness,
    recentDirections,
    `Default negative prompt: ${style.negativePrompt}`,
  ].filter(Boolean).join("\n");
}

export function buildRadioTasteDistillationPrompt(state: RadioState, styleIdInput: unknown): string {
  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles, state.deletedStyleIds);
  const style = getRadioStyle(styleId, state.customStyles, state.deletedStyleIds);
  const preference = state.preferences[styleId] ?? { likes: [], dislikes: [] };
  return [
    "Distill listener thumbs feedback into a compact Stable Audio 3 music taste profile.",
    "Use only the selected style feedback below. Do not infer from other station styles.",
    "Keep each array to at most 6 short, reusable phrases. Avoid copying whole prompts unless a whole phrase is genuinely reusable.",
    "Return JSON only with these string-array fields: likedTraits, dislikedTraits, promptDirectives, negativePromptDirectives, explorationNotes.",
    "",
    `Style: ${style.label}`,
    `Base direction: ${style.seedPrompt}`,
    `Default negative prompt: ${style.negativePrompt}`,
    "",
    "Thumbs up prompts:",
    formatThumbsList(preference.likes),
    "",
    "Thumbs down prompts:",
    formatThumbsList(preference.dislikes),
    "",
    "Return JSON only.",
  ].join("\n");
}

export function updateRadioTasteProfile(state: RadioState, styleIdInput: unknown, input: RadioTasteProfileInput, modelInput: unknown, now = new Date().toISOString()): RadioState {
  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles, state.deletedStyleIds);
  const previous = state.preferences[styleId] ?? { likes: [], dislikes: [] };
  const sourceEventCount = previous.likes.length + previous.dislikes.length;
  const tasteProfile: RadioTasteProfile = {
    likedTraits: normalizeTasteProfileList(input.likedTraits),
    dislikedTraits: normalizeTasteProfileList(input.dislikedTraits),
    promptDirectives: normalizeTasteProfileList(input.promptDirectives),
    negativePromptDirectives: normalizeTasteProfileList(input.negativePromptDirectives),
    explorationNotes: normalizeTasteProfileList(input.explorationNotes),
    updatedAt: now,
    sourceEventCount,
    provider: "codex-cli",
    model: normalizeCodexTasteModel(modelInput),
  };
  return {
    ...state,
    preferences: {
      ...state.preferences,
      [styleId]: { ...previous, tasteProfile },
    },
    updatedAt: nextTimestamp(state.updatedAt),
  };
}

export function buildRadioPromptGeneratorMessages(state: RadioState, styleIdInput: unknown, modelInput: unknown) {
  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles, state.deletedStyleIds);
  const model = normalizeOllamaPromptModel(modelInput);
  return {
    provider: "ollama" as const,
    model,
    system: [
      "You generate concise prompts for Stable Audio 3 music renders.",
      "This station is testing local Ollama prompt generation with 8B to 30B model sizes.",
      "Use listener thumbs-up and thumbs-down feedback to evolve taste for the selected style.",
      "Return JSON only with title, prompt, negativePrompt, and tasteNotes string fields.",
    ].join(" "),
    prompt: [
      buildRadioPromptSeed(state, styleId),
      `Create one new instrumental song prompt for the next radio track. Entropy seed: ${randomSuffix()}-${Date.now().toString(36)}.`,
      `The prompt must ${RADIO_ENDING_GUIDANCE}.`,
      "Keep the prompt under 700 characters. Do not ask questions. Do not include markdown.",
      "Return JSON only.",
    ].join("\n\n"),
  };
}

export function createRadioPromptDraft({
  title,
  prompt,
  negativePrompt,
  styleId,
  promptProvider,
  promptModel,
  rawResponse,
  style,
}: {
  title: string;
  prompt: string;
  negativePrompt: string;
  styleId: RadioStyleId;
  promptProvider: RadioPromptProvider;
  promptModel: string;
  rawResponse?: string;
  style?: RadioStyle;
}): RadioPromptDraft {
  const createdAt = new Date().toISOString();
  const fallbackStyle = style ?? getRadioStyle(styleId);
  const cleanedPrompt = cleanShortText(prompt, fallbackStyle.seedPrompt, 1000);
  return {
    id: `draft-${compactTimestamp(createdAt)}-${randomSuffix()}`,
    title: cleanShortText(title, "Untitled Signal", 80),
    prompt: appendRadioEndingGuidance(cleanedPrompt, 1000),
    negativePrompt: cleanShortText(negativePrompt, fallbackStyle.negativePrompt, 500),
    styleId,
    createdAt,
    promptProvider,
    promptModel: normalizeOllamaPromptModel(promptModel),
    ...(rawResponse ? { rawResponse: rawResponse.slice(0, 4000) } : {}),
  };
}

export function createFallbackRadioPromptDraft(state: RadioState, styleIdInput: unknown, modelInput: unknown, nowInput = new Date().toISOString()): RadioPromptDraft {
  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles, state.deletedStyleIds);
  const style = getRadioStyle(styleId, state.customStyles, state.deletedStyleIds);
  const preference = state.preferences[styleId];
  const likedTexture = preference?.likes?.at(-1);
  const dislikedTexture = preference?.dislikes?.at(-1);
  const variants = [
    "Neon Arc",
    "Glass Horizon",
    "Pulse Vector",
    "Afterimage",
    "Signal Bloom",
    "Chrome Weather",
    "Velocity Drift",
    "Night Current",
  ];
  const variationSeed = `${compactTimestamp(nowInput)}-${state.history.length + 1}`;
  const usedTitles = new Set(state.history.map((track) => track.title));
  const variant = variants.find((name) => !usedTitles.has(`${style.label} ${name}`) && !usedTitles.has(`${style.label} ${name} Keeper`)) ?? `Signal ${state.history.length + 1}`;
  const title = makeUniqueRadioTrackTitle(`${style.label} ${likedTexture ? `${variant} Keeper` : variant}`, state.history);
  return createRadioPromptDraft({
    title,
    prompt: [style.seedPrompt, likedTexture ? `emphasize ${likedTexture}` : `add a fresh ${variant.toLowerCase()} melodic motif`, `variation seed ${variationSeed}`, "polished full-song intro and outro"].join(", "),
    negativePrompt: [style.negativePrompt, dislikedTexture ? `avoid ${dislikedTexture}` : ""].filter(Boolean).join(", "),
    styleId,
    style,
    promptProvider: "fallback",
    promptModel: normalizeOllamaPromptModel(modelInput),
  });
}

export function parseRadioPromptDraft(rawResponse: string, state: RadioState, styleIdInput: unknown, modelInput: unknown): RadioPromptDraft {
  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles, state.deletedStyleIds);
  const style = getRadioStyle(styleId, state.customStyles, state.deletedStyleIds);
  try {
    const parsed = JSON.parse(extractJsonObject(rawResponse)) as Partial<Record<"title" | "prompt" | "negativePrompt", unknown>>;
    const title = makeUniqueRadioTrackTitle(typeof parsed.title === "string" ? parsed.title : style.label, state.history);
    return createRadioPromptDraft({
      title,
      prompt: typeof parsed.prompt === "string" ? parsed.prompt : style.seedPrompt,
      negativePrompt: typeof parsed.negativePrompt === "string" ? parsed.negativePrompt : style.negativePrompt,
      styleId,
      style,
      promptProvider: "ollama",
      promptModel: normalizeOllamaPromptModel(modelInput),
      rawResponse,
    });
  } catch {
    return { ...createFallbackRadioPromptDraft(state, styleId, modelInput), rawResponse: rawResponse.slice(0, 4000) };
  }
}

export function makeUniqueRadioTrackTitle(titleInput: string, history: Pick<RadioTrackRecord, "title">[]): string {
  const title = cleanShortText(stripRadioKeeperSuffix(titleInput), "Untitled Signal", 80);
  const existingTitles = history.map((track) => cleanShortText(stripRadioKeeperSuffix(track.title), "", 120)).filter(Boolean);
  const titleKey = normalizeTitleKey(title);
  if (!existingTitles.some((existingTitle) => normalizeTitleKey(existingTitle) === titleKey)) return title;

  const numeric = splitLastTitleNumber(title);
  if (!numeric) {
    const escapedTitle = escapeRegExp(title);
    const familyPattern = new RegExp(`^${escapedTitle}(?:\\s+(\\d+))?$`, "i");
    const highest = existingTitles.reduce((currentHighest, existingTitle) => {
      const match = existingTitle.match(familyPattern);
      if (!match) return currentHighest;
      return Math.max(currentHighest, match[1] ? Number(match[1]) : 1);
    }, 1);
    return cleanShortText(`${title} ${highest + 1}`, title, 80);
  }

  const prefix = title.slice(0, numeric.start);
  const suffix = title.slice(numeric.end);
  const familyPattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)${escapeRegExp(suffix)}$`, "i");
  const highest = existingTitles.reduce((currentHighest, existingTitle) => {
    const match = existingTitle.match(familyPattern);
    return match ? Math.max(currentHighest, Number(match[1])) : currentHighest;
  }, numeric.value);
  const nextNumber = String(highest + 1).padStart(numeric.width, "0");
  return cleanShortText(`${prefix}${nextNumber}${suffix}`, title, 80);
}

function buildRadioTasteProfileSeed(profile: RadioTasteProfile | undefined) {
  if (!profile) return "";
  const lines = [
    formatTasteProfileLine("Liked traits", profile.likedTraits),
    formatTasteProfileLine("Disliked traits", profile.dislikedTraits),
    formatTasteProfileLine("Prompt directives", profile.promptDirectives),
    formatTasteProfileLine("Negative prompt directives", profile.negativePromptDirectives),
    formatTasteProfileLine("Exploration notes", profile.explorationNotes),
  ].filter(Boolean);
  return lines.length ? ["Distilled listener taste:", ...lines].join("\n") : "";
}

function formatTasteProfileLine(label: string, values: string[]) {
  return values.length ? `${label}: ${values.join("; ")}` : "";
}

function formatThumbsList(values: string[]) {
  return values.length ? values.slice(-12).map((value) => `- ${value}`).join("\n") : "- none";
}

function normalizeTasteProfileList(values: unknown) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => typeof value === "string" ? cleanShortText(value, "", 120) : "")
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeCodexTasteModel(value: unknown) {
  if (typeof value !== "string") return "gpt-5.5";
  const model = value.trim();
  return model && model.length <= 80 && !/["'<>]/.test(model) ? model : "gpt-5.5";
}

function appendRadioEndingGuidance(value: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  const lower = cleaned.toLowerCase();
  if (lower.includes("full requested duration") && lower.includes("do not restart")) return cleaned.slice(0, maxLength);
  const suffix = `, ${RADIO_ENDING_GUIDANCE}`;
  const baseLength = Math.max(0, maxLength - suffix.length);
  const base = cleaned.slice(0, baseLength).replace(/[,\s]+$/g, "");
  return `${base}${suffix}`.slice(0, maxLength);
}

function normalizeTitleKey(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripRadioKeeperSuffix(value: string) {
  return value.replace(/\s+Keeper\s*$/i, "").trim() || value;
}

function splitLastTitleNumber(value: string) {
  const matches = [...value.matchAll(/\d+/g)];
  const lastMatch = matches.at(-1);
  if (!lastMatch || lastMatch.index === undefined) return undefined;
  return {
    start: lastMatch.index,
    end: lastMatch.index + lastMatch[0].length,
    value: Number(lastMatch[0]),
    width: lastMatch[0].length,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractJsonObject(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return value;
  return value.slice(start, end + 1);
}
