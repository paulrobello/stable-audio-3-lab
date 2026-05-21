import { describe, expect, it } from "vitest";
import { buildGeneratorArgs, resolveGenerationBackend, stableAudioModelToMlx } from "./generator-backend";

describe("generator backend routing", () => {
  it("defaults real generation to the MLX backend", () => {
    expect(resolveGenerationBackend({ mock: false })).toBe("mlx");
  });

  it("maps every UI model to the official MLX DiT and decoder pair", () => {
    expect(stableAudioModelToMlx("small-music")).toEqual({ dit: "sm-music", decoder: "same-s" });
    expect(stableAudioModelToMlx("small-sfx")).toEqual({ dit: "sm-sfx", decoder: "same-s" });
    expect(stableAudioModelToMlx("medium")).toEqual({ dit: "medium", decoder: "same-l" });
  });

  it("passes MLX backend and shared generation settings to the Python bridge", () => {
    const args = buildGeneratorArgs({
      scriptPath: "/repo/scripts/generate_audio.py",
      outputPath: "/repo/public/outputs/test.wav",
      input: {
        prompt: "cinematic spaceship door opening with clean metallic tail",
        negativePrompt: "muddy, clipped",
        mode: "sfx",
        model: "small-sfx",
        duration: 4,
        steps: 8,
        cfgScale: 1.5,
        format: "wav",
        seed: 47,
        mock: false,
      },
      backend: "mlx",
      mock: false,
    });

    expect(args).toContain("--backend");
    expect(args).toContain("mlx");
    expect(args).toContain("--seed");
    expect(args).toContain("47");
    expect(args).not.toContain("--mock");
  });
});
