import { describe, expect, it } from "vitest";
import {
  applyLibraryAnnotationMetadata,
  buildAnalysisSummary,
  buildAnalysisSummaryFilename,
  buildBatchBundleFilename,
  buildBatchManifest,
  buildBundleFilename,
  buildCropFilename,
  buildCropMetadata,
  buildLibraryMetadata,
  buildRenderScreenshotFilename,
  buildRenderScreenshotSvg,
  buildStoredZip,
  isFavoriteMetadata,
  isSafeBatchRunId,
  metadataFilenameForAudio,
  metadataUrlForAudio,
  normalizeCropWindow,
  normalizeLibraryAnnotation,
  toggleFavoriteMetadata,
  validateCropFitsDuration,
} from "./library";

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
        autoTitle: false,
      },
      python: { code: 0, stdout: "ok", stderr: "" },
      backend: "mlx",
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
    expect(meta.backend).toBe("mlx");
  });
});

describe("favorite metadata", () => {
  it("toggles keepers without disturbing generation settings", () => {
    const meta = { settings: { prompt: "big hit" }, favorite: false };

    const favorited = toggleFavoriteMetadata(meta, true);
    expect(isFavoriteMetadata(favorited)).toBe(true);
    expect(favorited).toMatchObject({ settings: { prompt: "big hit" }, favorite: true });

    expect(isFavoriteMetadata(toggleFavoriteMetadata(favorited, false))).toBe(false);
  });
});

describe("library annotations", () => {
  it("normalizes optional notes and ratings for metadata sidecars", () => {
    expect(normalizeLibraryAnnotation({ notes: "  Keeper after crop.  ", rating: 4 })).toEqual({ notes: "Keeper after crop.", rating: 4 });
    expect(normalizeLibraryAnnotation({ notes: "", rating: null })).toEqual({ notes: "", rating: null });
    expect(normalizeLibraryAnnotation({ rating: 5 }, { notes: "Keep me", rating: 2 })).toEqual({ notes: "Keep me", rating: 5 });
    expect(normalizeLibraryAnnotation({ notes: "New note" }, { notes: "Old", rating: 3 })).toEqual({ notes: "New note", rating: 3 });
    expect(() => normalizeLibraryAnnotation({ notes: "x".repeat(1001), rating: 3 })).toThrow(/notes/i);
    expect(() => normalizeLibraryAnnotation({ notes: "ok", rating: 6 })).toThrow(/rating/i);
  });

  it("applies notes and ratings without disturbing existing metadata", () => {
    const updated = applyLibraryAnnotationMetadata(
      { filename: "sa3-music-123.mp3", settings: { prompt: "bass loop" }, favorite: true },
      { notes: "Mix is wide", rating: 5 },
      "2026-05-21T13:00:00.000Z",
    );

    expect(updated).toMatchObject({
      filename: "sa3-music-123.mp3",
      settings: { prompt: "bass loop" },
      favorite: true,
      notes: "Mix is wide",
      rating: 5,
      annotatedAt: "2026-05-21T13:00:00.000Z",
    });
  });

  it("preserves omitted fields when applying partial annotation updates", () => {
    expect(applyLibraryAnnotationMetadata({ notes: "Keep me", rating: 2 }, { rating: 5 })).toMatchObject({ notes: "Keep me", rating: 5 });
    expect(applyLibraryAnnotationMetadata({ notes: "Old", rating: 3 }, { notes: "New" })).toMatchObject({ notes: "New", rating: 3 });
    expect(applyLibraryAnnotationMetadata({ notes: "Clear rating", rating: 4 }, { rating: null })).toMatchObject({ notes: "Clear rating" });
  });
});

describe("export bundles", () => {
  it("creates a safe zip filename for audio + metadata bundles", () => {
    expect(buildBundleFilename("sa3-music-123.mp3")).toBe("sa3-music-123.bundle.zip");
    expect(() => buildBundleFilename("../bad.mp3")).toThrow(/Invalid/);
  });

  it("creates safe batch run bundle filenames", () => {
    expect(isSafeBatchRunId("batch-20260521-abc123")).toBe(true);
    expect(isSafeBatchRunId("../bad")).toBe(false);
    expect(isSafeBatchRunId(".")).toBe(false);
    expect(isSafeBatchRunId("..hidden")).toBe(false);
    expect(buildBatchBundleFilename("batch-20260521-abc123")).toBe("batch-20260521-abc123.variation-run.zip");
    expect(() => buildBatchBundleFilename("../bad")).toThrow(/Invalid/);
  });

  it("builds a batch manifest with deterministic ordered variations", () => {
    const manifest = buildBatchManifest({
      batchRunId: "batch-20260521-abc123",
      items: [
        { filename: "sa3-music-b.mp3", metadata: { batch: { variationIndex: 1, variationCount: 2 }, settings: { prompt: "b" } } },
        { filename: "sa3-music-a.mp3", metadata: { batch: { variationIndex: 0, variationCount: 2 }, settings: { prompt: "a" } } },
      ],
    });

    expect(manifest).toMatchObject({ batchRunId: "batch-20260521-abc123", variationCount: 2 });
    expect(manifest.items.map((item) => item.filename)).toEqual(["sa3-music-a.mp3", "sa3-music-b.mp3"]);
  });

  it("builds a stored zip containing audio and metadata entries", () => {
    const zip = buildStoredZip([
      { name: "sa3-music-123.mp3", data: Buffer.from("audio") },
      { name: "sa3-music-123.mp3.json", data: Buffer.from('{"ok":true}') },
    ]);

    expect(zip.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(zip.toString("utf8")).toContain("sa3-music-123.mp3");
    expect(zip.toString("utf8")).toContain("sa3-music-123.mp3.json");
  });

  it("adds a safe analysis summary filename for bundle exports", () => {
    expect(buildAnalysisSummaryFilename("sa3-music-123.mp3")).toBe("sa3-music-123.analysis-summary.json");
    expect(() => buildAnalysisSummaryFilename("../../bad.wav")).toThrow(/Invalid/);
  });

  it("adds a rendered screenshot image entry for bundle exports", () => {
    expect(buildRenderScreenshotFilename("sa3-music-123.mp3")).toBe("sa3-music-123.render-screenshot.svg");
    expect(() => buildRenderScreenshotFilename("../../bad.wav")).toThrow(/Invalid/);

    const svg = buildRenderScreenshotSvg({
      filename: "sa3-music-123.mp3",
      metadata: { backend: "mlx", settings: { prompt: "glassy arps", mode: "music", model: "medium", duration: 12, seed: 47 } },
    });

    expect(svg).toContain("<svg");
    expect(svg).toContain("glassy arps");
    expect(svg).toContain("medium");
    expect(svg).toContain("seed 47");
    expect(svg).not.toContain("<script");
  });

  it("summarizes render settings for bundle exports", () => {
    const summary = buildAnalysisSummary({
      filename: "sa3-sfx-123.wav",
      metadata: {
        backend: "mlx",
        generationDurationMs: 1200,
        settings: {
          prompt: "metallic door hit",
          negativePrompt: "mud",
          mode: "sfx",
          model: "small-sfx",
          duration: 4,
          steps: 8,
          cfgScale: 1.5,
          format: "wav",
          seed: 99,
          mock: false,
        },
      },
    });

    expect(summary).toMatchObject({
      filename: "sa3-sfx-123.wav",
      prompt: "metallic door hit",
      model: "small-sfx",
      duration: 4,
      seed: 99,
      backend: "mlx",
    });
  });
});

describe("audio cropping", () => {
  it("normalizes crop windows into a positive start/end pair", () => {
    expect(normalizeCropWindow({ start: 3.2, end: 9.7 })).toEqual({ start: 3.2, end: 9.7, duration: 6.5 });
    expect(() => normalizeCropWindow({ start: -1, end: 2 })).toThrow(/Invalid crop/);
    expect(() => normalizeCropWindow({ start: 4, end: 4 })).toThrow(/Invalid crop/);
    expect(() => normalizeCropWindow({ start: 1.0004, end: 1.00049 })).toThrow(/Invalid crop/);
  });

  it("creates safe crop filenames beside the source audio", () => {
    expect(buildCropFilename("sa3-music-123.mp3", 1.25, 5)).toBe("sa3-music-123.crop-1p250-5p000.mp3");
    expect(() => buildCropFilename("../bad.mp3", 0, 1)).toThrow(/Invalid/);
  });

  it("rejects crop windows that exceed the probed source duration", () => {
    const crop = normalizeCropWindow({ start: 0.5, end: 2 });
    expect(validateCropFitsDuration(crop, 2)).toEqual(crop);
    expect(() => validateCropFitsDuration(crop, 1.5)).toThrow(/source duration/);
  });

  it("preserves source metadata and records crop provenance", () => {
    const cropped = buildCropMetadata({
      sourceFilename: "sa3-music-123.mp3",
      cropFilename: "sa3-music-123.crop-1p00-3p00.mp3",
      sourceMetadata: { settings: { prompt: "lofi loop" }, backend: "mlx" },
      crop: { start: 1, end: 3, duration: 2 },
      createdAt: "2026-05-21T12:00:00.000Z",
    });

    expect(cropped).toMatchObject({
      filename: "sa3-music-123.crop-1p00-3p00.mp3",
      sourceFilename: "sa3-music-123.mp3",
      crop: { start: 1, end: 3, duration: 2 },
      settings: { prompt: "lofi loop", duration: 2 },
      backend: "mlx",
    });
  });
});
