import path from "node:path";
import type { GenerateRequest } from "./generation";

export type ProcessResult = { code: number | null; stdout: string; stderr: string };

export type GenerationMetadata = {
  filename: string;
  audioUrl: string;
  metadataUrl: string;
  createdAt: string;
  generationDurationMs?: number;
  request: GenerateRequest;
  settings: {
    prompt: string;
    negativePrompt: string;
    mode: GenerateRequest["mode"];
    model: GenerateRequest["model"];
    duration: number;
    steps: number;
    cfgScale: number;
    format: GenerateRequest["format"];
    seed?: number;
    mock: boolean;
  };
  python: ProcessResult;
};

export function isSafeAudioFilename(filename: string) {
  return /^[a-zA-Z0-9._-]+\.(mp3|wav)$/.test(filename) && !filename.includes("..");
}

export function metadataFilenameForAudio(filename: string) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return `${filename}.json`;
}

export function metadataPathForAudio(audioPath: string) {
  return `${audioPath}.json`;
}

export function metadataUrlForAudio(filename: string) {
  return `/outputs/${metadataFilenameForAudio(filename)}`;
}

export function outputPathForAudio(outputDir: string, filename: string) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return path.join(outputDir, filename);
}

export function buildLibraryMetadata({
  filename,
  input,
  python,
  createdAt = new Date().toISOString(),
  generationDurationMs,
}: {
  filename: string;
  input: GenerateRequest;
  python: ProcessResult;
  createdAt?: string;
  generationDurationMs?: number;
}): GenerationMetadata {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return {
    filename,
    audioUrl: `/outputs/${filename}`,
    metadataUrl: metadataUrlForAudio(filename),
    createdAt,
    generationDurationMs,
    request: input,
    settings: {
      prompt: input.prompt,
      negativePrompt: input.negativePrompt || "",
      mode: input.mode,
      model: input.model,
      duration: input.duration,
      steps: input.steps,
      cfgScale: input.cfgScale,
      format: input.format,
      seed: input.seed,
      mock: input.mock,
    },
    python,
  };
}
