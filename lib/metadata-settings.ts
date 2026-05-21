export type AudioFormat = "mp3" | "wav";
export type GenerationMode = "music" | "sfx";
export type ModelId = "small-sfx" | "small-music" | "medium";

export type ReusableGenerationSettings = {
  prompt: string;
  negativePrompt: string;
  mode: GenerationMode;
  model: ModelId;
  duration: number;
  steps: number;
  cfgScale: number;
  format: AudioFormat;
  seed?: number;
  mock: boolean;
};

export function settingsFromMetadata(meta: unknown): ReusableGenerationSettings | null {
  if (!meta || typeof meta !== "object") return null;
  const record = meta as Record<string, unknown>;
  const source = (record.settings && typeof record.settings === "object" ? record.settings : record.request) as Record<string, unknown> | undefined;
  if (!source || typeof source !== "object") return null;

  const prompt = readString(source.prompt);
  const mode = readMode(source.mode);
  const model = readModel(source.model);
  if (!prompt || !mode || !model) return null;

  return {
    prompt,
    negativePrompt: readString(source.negativePrompt) || "",
    mode,
    model,
    duration: clampNumber(source.duration, 1, 380, mode === "sfx" ? 6 : 12),
    steps: Math.round(clampNumber(source.steps, 4, 50, 8)),
    cfgScale: clampNumber(source.cfgScale, 0, 12, 1),
    format: readFormat(source.format) || "mp3",
    seed: typeof source.seed === "number" && Number.isInteger(source.seed) ? source.seed : undefined,
    mock: typeof source.mock === "boolean" ? source.mock : false,
  };
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readMode(value: unknown): GenerationMode | undefined {
  return value === "music" || value === "sfx" ? value : undefined;
}

function readModel(value: unknown): ModelId | undefined {
  return value === "small-sfx" || value === "small-music" || value === "medium" ? value : undefined;
}

function readFormat(value: unknown): AudioFormat | undefined {
  return value === "mp3" || value === "wav" ? value : undefined;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}
