import { describe, expect, it, vi } from "vitest";

import {
  planGenerationBatch,
  runGenerationBatch,
  type GenerationBatchInput,
} from "./generation-batch";

const baseInput: GenerationBatchInput = {
  prompt: "warm pad",
  negativePrompt: "",
  mode: "music",
  model: "medium",
  duration: 60,
  steps: 10,
  cfgScale: 2,
  format: "mp3",
  mock: true,
  autoTitle: false,
  seed: "",
  batchCount: 1,
};

describe("planGenerationBatch", () => {
  it("omits seed and batchRunId for a single variation with no fixed seed", () => {
    const plan = planGenerationBatch({ ...baseInput, batchCount: 1, seed: "" });
    expect(plan.batchRunId).toBeUndefined();
    expect(plan.variationSeeds).toEqual([undefined]);
    expect(plan.variations).toHaveLength(1);
    const body = plan.variations[0]!.body;
    expect(body).not.toHaveProperty("seed");
    expect(body).not.toHaveProperty("batchRunId");
    expect(body).toMatchObject({ prompt: "warm pad", mode: "music", duration: 60 });
  });

  it("mints a batchRunId and sequential seeds for multiple variations", () => {
    const id = vi.fn(() => "batch-fixed");
    const plan = planGenerationBatch({ ...baseInput, batchCount: 3, seed: "1000" }, id);
    expect(id).toHaveBeenCalledTimes(1);
    expect(plan.batchRunId).toBe("batch-fixed");
    expect(plan.variationSeeds).toEqual([1000, 1001, 1002]);
    plan.variations.forEach((variation, index) => {
      expect(variation.batchRunId).toBe("batch-fixed");
      expect(variation.variationIndex).toBe(index);
      expect(variation.variationCount).toBe(3);
      expect(variation.body).toHaveProperty("seed", 1000 + index);
      expect(variation.body).toHaveProperty("batchRunId", "batch-fixed");
    });
  });

  it("sends undefined seed slots across a batch when no fixed seed is set", () => {
    const plan = planGenerationBatch({ ...baseInput, batchCount: 2, seed: "" });
    expect(plan.variationSeeds).toEqual([undefined, undefined]);
    plan.variations.forEach((variation) => {
      expect(variation.body).not.toHaveProperty("seed");
    });
  });
});

describe("runGenerationBatch", () => {
  it("stops after the first failing variation and includes it in the results", async () => {
    const generateOne = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, file: "a" })
      .mockResolvedValueOnce({ ok: false, error: "boom" });
    const progress = vi.fn();
    const { results, variationSeeds } = await runGenerationBatch(
      { ...baseInput, batchCount: 3, seed: "5" },
      generateOne,
      { onProgress: progress },
    );
    expect(generateOne).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results[1]).toMatchObject({ ok: false });
    expect(variationSeeds).toEqual([5, 6, 7]);
  });

  it("runs every variation when all succeed", async () => {
    const generateOne = vi.fn().mockResolvedValue({ ok: true });
    const { results } = await runGenerationBatch(
      { ...baseInput, batchCount: 2, seed: "1" },
      generateOne,
    );
    expect(generateOne).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
