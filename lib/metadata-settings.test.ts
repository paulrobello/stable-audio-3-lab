import { describe, expect, it } from "vitest";
import { settingsFromMetadata } from "./metadata-settings";

describe("settingsFromMetadata", () => {
  it("extracts a reusable generation config from metadata settings", () => {
    const settings = settingsFromMetadata({
      settings: {
        prompt: "dark cinematic riser with metallic impacts",
        negativePrompt: "clipping, muddy",
        mode: "sfx",
        model: "small-sfx",
        duration: 7,
        steps: 12,
        cfgScale: 2.5,
        format: "mp3",
        mock: false,
        seed: 1234,
      },
    });

    expect(settings).toEqual({
      prompt: "dark cinematic riser with metallic impacts",
      negativePrompt: "clipping, muddy",
      mode: "sfx",
      model: "small-sfx",
      duration: 7,
      steps: 12,
      cfgScale: 2.5,
      format: "mp3",
      mock: false,
      seed: 1234,
    });
  });

  it("falls back to older metadata request blocks", () => {
    const settings = settingsFromMetadata({
      request: {
        prompt: "uplifting synthwave hook with warm bass",
        mode: "music",
        model: "small-music",
        duration: 16,
        steps: 8,
        cfgScale: 1,
        format: "wav",
        mock: true,
      },
    });

    expect(settings?.prompt).toBe("uplifting synthwave hook with warm bass");
    expect(settings?.format).toBe("wav");
  });
});
