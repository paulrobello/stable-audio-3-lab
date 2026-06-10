import { describe, expect, it } from "vitest";
import { buildGenerationPromptFromAssessment } from "./assessment-prompt";
import type { AudioAssessment } from "./audio-assessment";

describe("assessment prompt builder", () => {
  it("turns model-extracted track attributes into a music generation prompt", () => {
    const assessment: AudioAssessment = {
      assessedAt: "2026-06-10T12:00:00.000Z",
      provider: "local-test",
      model: "audio-model",
      summary: "A tense synthwave track with gated drums and an arpeggiated bass line.",
      source: {
        filename: "reference.mp3",
        audioUrl: "",
        metadataUrl: "",
        source: "upload",
        title: "Reference Track",
      },
      attributes: {
        genre: ["synthwave", "cinematic electronic"],
        instruments: ["analog bass", "gated drums", "wide pads"],
        mood: ["tense", "night-drive"],
        production: ["sidechain compression", "wide stereo image"],
        positives: ["strong pulse", "memorable bass motif"],
        negatives: ["thin cymbals"],
        rhythm: "driving four-on-the-floor",
        tempoBpm: 112,
        key: "A minor",
      },
    };

    expect(buildGenerationPromptFromAssessment(assessment)).toEqual({
      prompt: [
        "Instrumental music matching the analyzed reference track.",
        "Reference summary: A tense synthwave track with gated drums and an arpeggiated bass line.",
        "Genre: synthwave, cinematic electronic.",
        "Tempo and feel: 112 BPM, driving four-on-the-floor.",
        "Key center: A minor.",
        "Instrumentation: analog bass, gated drums, wide pads.",
        "Mood: tense, night-drive.",
        "Production traits: sidechain compression, wide stereo image.",
        "Preserve these strengths: strong pulse, memorable bass motif.",
      ].join("\n"),
      negativePrompt: "thin cymbals, low quality, distorted, clipping, harsh noise",
    });
  });
});
