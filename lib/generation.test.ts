import { describe, expect, it } from "vitest";
import { normalizeGenerationRequest, promptPresets } from "./generation";
import { controlTips } from "./ui-presets";

describe("normalizeGenerationRequest", () => {
  it("caps duration to the selected model limit", () => {
    const request = normalizeGenerationRequest({
      prompt: "uplifting synthwave instrumental with warm analog bass",
      mode: "music",
      model: "small-music",
      duration: 999,
      steps: 8,
      cfgScale: 1,
    });

    expect(request.duration).toBe(120);
  });

  it("keeps medium long-form requests inside the Stable Audio 3 public limit", () => {
    const request = normalizeGenerationRequest({
      prompt: "progressive house festival track with detailed melodic phrasing",
      mode: "music",
      model: "medium",
      duration: 420,
      steps: 8,
      cfgScale: 1,
    });

    expect(request.duration).toBe(380);
  });

  it("ships with both music and sound-effect presets", () => {
    expect(promptPresets.music.length).toBeGreaterThan(1);
    expect(promptPresets.sfx.length).toBeGreaterThan(1);
  });

  it("defaults generated downloads to mp3", () => {
    const request = normalizeGenerationRequest({
      prompt: "warm analog synth loop with gentle drums and polished mix",
      mode: "music",
      model: "small-music",
      duration: 12,
      steps: 8,
      cfgScale: 1,
    });

    expect(request.format).toBe("mp3");
  });

  it("preserves fixed seeds for reproducible iteration", () => {
    const request = normalizeGenerationRequest({
      prompt: "repeatable sci-fi impact with clean transient",
      mode: "sfx",
      model: "small-sfx",
      duration: 3,
      steps: 12,
      cfgScale: 1,
      seed: "123456",
    });

    expect(request.seed).toBe(123456);
  });

  it("requires consistent batch variation metadata", () => {
    const base = {
      prompt: "repeatable sci-fi impact with clean transient",
      mode: "sfx",
      model: "small-sfx",
      duration: 3,
      steps: 12,
      cfgScale: 1,
    };

    expect(normalizeGenerationRequest({ ...base, batchRunId: "batch-abc123", variationIndex: 0, variationCount: 2 }).batchRunId).toBe("batch-abc123");
    expect(() => normalizeGenerationRequest({ ...base, batchRunId: "batch-abc123", variationIndex: 2, variationCount: 2 })).toThrow();
    expect(() => normalizeGenerationRequest({ ...base, variationIndex: 0, variationCount: 2 })).toThrow();
    expect(() => normalizeGenerationRequest({ ...base, batchRunId: "batch-abc123" })).toThrow();
  });

  it("explains the non-obvious generation controls", () => {
    expect(controlTips.steps.body).toContain("Start at 8");
    expect(controlTips.cfgScale.body).toContain("Prompt strength");
    expect(controlTips.format.body).toContain("MP3");
    expect(controlTips.seed.body).toContain("same seed");
  });
});
