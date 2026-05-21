import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AudioPreview, buildSpectrogramBins, clampPlaybackVolume, filterLibraryItems, libraryItemSearchText, selectedComparisonItems } from "./page";

describe("playback volume", () => {
  it("clamps saved playback volume into the browser audio range", () => {
    expect(clampPlaybackVolume(-0.5)).toBe(0);
    expect(clampPlaybackVolume(0.42)).toBe(0.42);
    expect(clampPlaybackVolume(1.5)).toBe(1);
    expect(clampPlaybackVolume(Number.NaN)).toBe(0.8);
  });

  it("applies the default playback volume to rendered audio controls", () => {
    render(<AudioPreview src="/outputs/test.mp3" volume={0.37} label="Test preview" />);

    const audio = screen.getByLabelText("Test preview") as HTMLAudioElement;
    expect(audio.volume).toBe(0.37);
  });
});

describe("library filtering", () => {
  const items = [
    {
      filename: "sa3-music-1.mp3",
      audioUrl: "/outputs/sa3-music-1.mp3",
      downloadUrl: "/outputs/sa3-music-1.mp3",
      format: "mp3" as const,
      bytes: 1000,
      createdAt: "2026-05-21T12:00:00.000Z",
      favorite: true,
      meta: { settings: { prompt: "warm synthwave bass", model: "small-music" } },
    },
    {
      filename: "sa3-sfx-2.wav",
      audioUrl: "/outputs/sa3-sfx-2.wav",
      downloadUrl: "/outputs/sa3-sfx-2.wav",
      format: "wav" as const,
      bytes: 2000,
      createdAt: "2026-05-21T12:01:00.000Z",
      favorite: false,
      meta: { settings: { prompt: "metallic door slam", model: "small-sfx" } },
    },
  ];

  it("searches filenames and metadata prompt text", () => {
    expect(libraryItemSearchText(items[0])).toContain("warm synthwave bass");
    expect(filterLibraryItems(items, "door", false).map((item) => item.filename)).toEqual(["sa3-sfx-2.wav"]);
  });

  it("can restrict results to favorites", () => {
    expect(filterLibraryItems(items, "", true).map((item) => item.filename)).toEqual(["sa3-music-1.mp3"]);
  });
});

describe("comparison selection", () => {
  it("keeps selected library items in library order", () => {
    const items = [
      { filename: "a.mp3", audioUrl: "/a.mp3", downloadUrl: "/a.mp3", format: "mp3" as const, bytes: 1, createdAt: "2026-05-21T12:00:00.000Z" },
      { filename: "b.wav", audioUrl: "/b.wav", downloadUrl: "/b.wav", format: "wav" as const, bytes: 1, createdAt: "2026-05-21T12:01:00.000Z" },
    ];

    expect(selectedComparisonItems(items, new Set(["b.wav", "missing"]))).toEqual([items[1]]);
  });
});

describe("spectrogram analysis", () => {
  it("builds multiple frequency bins per time slice", () => {
    const data = Float32Array.from(Array.from({ length: 2048 }, (_, index) => Math.sin(index / 4)));
    const bins = buildSpectrogramBins(data, 12, 16);

    expect(bins).toHaveLength(12);
    expect(bins[0]).toHaveLength(16);
    expect(bins.some((column) => column.some((value) => value > 0))).toBe(true);
  });
});
