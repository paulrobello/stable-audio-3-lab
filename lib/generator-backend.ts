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

/**
 * Authoritative model → MLX DiT/decoder mapping for the whole project.
 *
 * This is the SINGLE source of truth for which MLX DiT and decoder each
 * user-facing model id resolves to (ARC-008). The Python bridge receives the
 * resolved pair as explicit `--dit` / `--decoder` args (see `buildGeneratorArgs`)
 * and no longer keeps its own copy of this mapping.
 */
export function stableAudioModelToMlx(model: GenerateRequest["model"]): { dit: "sm-music" | "sm-sfx" | "medium"; decoder: "same-s" | "same-l" } {
  if (model === "small-music") return { dit: "sm-music", decoder: "same-s" };
  if (model === "small-sfx") return { dit: "sm-sfx", decoder: "same-s" };
  return { dit: "medium", decoder: "same-l" };
}

export function buildGeneratorArgs({ scriptPath, outputPath, input, backend, mock }: BuildGeneratorArgsOptions) {
  // Resolve the MLX routing here (authoritative) and pass it explicitly so the
  // Python side does not maintain a duplicate model→MLX map (ARC-008).
  const { dit, decoder } = stableAudioModelToMlx(input.model);
  const args = [
    scriptPath,
    "--backend", backend,
    "--mode", input.mode,
    "--model", input.model,
    "--dit", dit,
    "--decoder", decoder,
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
