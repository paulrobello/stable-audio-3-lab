import { describe, expect, it } from "vitest";
import { buildLibraryMetadata, metadataFilenameForAudio, metadataUrlForAudio } from "./library";

describe("library metadata sidecars", () => {
  it("stores metadata beside the rendered audio file as a json sidecar", () => {
    expect(metadataFilenameForAudio("sa3-music-123.mp3")).toBe("sa3-music-123.mp3.json");
    expect(metadataUrlForAudio("sa3-music-123.mp3")).toBe("/outputs/sa3-music-123.mp3.json");
  });

  it("keeps the prompt and generation settings in reviewable metadata", () => {
    const meta = buildLibraryMetadata({
      filename: "sa3-sfx-456.wav",
      input: {
        prompt: "crisp sci-fi door whoosh with hydraulic hiss",
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
      python: { code: 0, stdout: "ok", stderr: "" },
      createdAt: "2026-05-21T15:00:00.000Z",
      generationDurationMs: 12345,
    });

    expect(meta.filename).toBe("sa3-sfx-456.wav");
    expect(meta.request.prompt).toBe("crisp sci-fi door whoosh with hydraulic hiss");
    expect(meta.settings).toMatchObject({
      model: "small-sfx",
      mode: "sfx",
      duration: 4,
      steps: 8,
      cfgScale: 1.5,
      format: "wav",
      seed: 47,
      mock: false,
    });
    expect(meta.generationDurationMs).toBe(12345);
  });
});
