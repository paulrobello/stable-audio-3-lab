import type { GenerateRequest } from "./generation";

export type GenerationBackend = "mlx" | "torch";

type BuildGeneratorArgsOptions = {
  scriptPath: string;
  outputPath: string;
  input: GenerateRequest;
  backend: GenerationBackend;
  mock: boolean;
};

export function resolveGenerationBackend({ envBackend, mock }: { envBackend?: string; mock: boolean }): GenerationBackend {
  if (mock) return "mlx";
  const normalized = envBackend?.trim().toLowerCase();
  if (normalized === "torch") return "torch";
  return "mlx";
}

export function stableAudioModelToMlx(model: GenerateRequest["model"]): { dit: "sm-music" | "sm-sfx" | "medium"; decoder: "same-s" | "same-l" } {
  if (model === "small-music") return { dit: "sm-music", decoder: "same-s" };
  if (model === "small-sfx") return { dit: "sm-sfx", decoder: "same-s" };
  return { dit: "medium", decoder: "same-l" };
}

export function buildGeneratorArgs({ scriptPath, outputPath, input, backend, mock }: BuildGeneratorArgsOptions) {
  const args = [
    scriptPath,
    "--backend", backend,
    "--mode", input.mode,
    "--model", input.model,
    "--prompt", input.prompt,
    "--negative-prompt", input.negativePrompt || "",
    "--duration", String(input.duration),
    "--steps", String(input.steps),
    "--cfg-scale", String(input.cfgScale),
    "--format", input.format,
    "--out", outputPath,
  ];
  if (input.seed !== undefined) args.push("--seed", String(input.seed));
  if (mock) args.push("--mock");
  return args;
}
