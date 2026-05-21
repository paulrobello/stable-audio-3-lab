import { describe, expect, it } from "vitest";
import { buildVariationSeeds, promptTemplateGroups } from "./generation";
import { buildBundleFilename, buildStoredZip, isFavoriteMetadata, toggleFavoriteMetadata } from "./library";

describe("prompt templates", () => {
  it("ships templates for foley, ui stings, loops, trailer hits, ambience, and music beds", () => {
    expect(promptTemplateGroups.map((group) => group.id)).toEqual(["foley", "ui-stings", "loops", "trailer-hits", "ambience", "music-beds"]);
    expect(promptTemplateGroups.every((group) => group.templates.length >= 2)).toBe(true);
  });
});

describe("batch variation seeds", () => {
  it("derives deterministic variation seeds from a fixed base seed", () => {
    expect(buildVariationSeeds(47, 4)).toEqual([47, 48, 49, 50]);
  });

  it("wraps safely inside the Stable Audio seed range", () => {
    expect(buildVariationSeeds(2147483646, 4)).toEqual([2147483646, 2147483647, 0, 1]);
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

describe("export bundles", () => {
  it("creates a safe zip filename for audio + metadata bundles", () => {
    expect(buildBundleFilename("sa3-music-123.mp3")).toBe("sa3-music-123.bundle.zip");
    expect(() => buildBundleFilename("../bad.mp3")).toThrow(/Invalid/);
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
});
