import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home, { AudioPreview, buildCropOverlayPercentages, buildPlayheadOverlayPercentage, buildSeekTimeFromKeyboard, buildSeekTimeFromPointer, buildSpectrogramBins, clampPlaybackVolume, filterLibraryItems, libraryItemSearchText, playAudioElement, prunePlaybackState, selectedComparisonItems } from "./page";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it("reports playback timing changes from audio events", () => {
    const onPlaybackChange = vi.fn();
    render(<AudioPreview src="/outputs/test.mp3" volume={0.37} label="Test preview" onPlaybackChange={onPlaybackChange} />);

    const audio = screen.getByLabelText("Test preview") as HTMLAudioElement;
    Object.defineProperty(audio, "currentTime", { configurable: true, value: 4 });
    Object.defineProperty(audio, "duration", { configurable: true, value: 10 });
    fireEvent.timeUpdate(audio);

    expect(onPlaybackChange).toHaveBeenCalledWith({ currentTime: 4, duration: 10, isPlaying: false });
  });

  it("can hide native browser chrome when waveform controls own playback", () => {
    render(<AudioPreview src="/outputs/test.mp3" volume={0.37} label="Hidden preview" hiddenPlayer />);

    const audio = screen.getByLabelText("Hidden preview") as HTMLAudioElement;
    expect(audio.hasAttribute("controls")).toBe(false);
    expect(audio.className).toContain("hidden");
  });

  it("surfaces play rejection messages instead of swallowing browser playback failures", async () => {
    const audio = document.createElement("audio");
    audio.play = vi.fn().mockRejectedValue(new Error("NotAllowedError"));

    await expect(playAudioElement(audio)).resolves.toBe("NotAllowedError");
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

  it("can hide radio voice tests and title announcements", () => {
    const radioItems = [
      ...items,
      { filename: "radio_voice_test_1812345678901.mp3", audioUrl: "/outputs/radio_voice_test_1812345678901.mp3", downloadUrl: "/outputs/radio_voice_test_1812345678901.mp3", format: "mp3" as const, bytes: 1, createdAt: "2026-05-21T12:02:00.000Z" },
      { filename: "radio_announce_midnight_arcade_now_playing.mp3", audioUrl: "/outputs/radio_announce_midnight_arcade_now_playing.mp3", downloadUrl: "/outputs/radio_announce_midnight_arcade_now_playing.mp3", format: "mp3" as const, bytes: 1, createdAt: "2026-05-21T12:03:00.000Z" },
    ];

    expect(filterLibraryItems(radioItems, "", false, true).map((item) => item.filename)).toEqual(["sa3-music-1.mp3", "sa3-sfx-2.wav"]);
    expect(filterLibraryItems(radioItems, "radio", false, false).map((item) => item.filename)).toEqual(["radio_voice_test_1812345678901.mp3", "radio_announce_midnight_arcade_now_playing.mp3"]);
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

describe("library playback state", () => {
  it("prunes playback state for library items no longer present after refresh or delete", () => {
    const current = {
      "keep.mp3": { currentTime: 3, duration: 12, isPlaying: true },
      "deleted.wav": { currentTime: 1, duration: 4, error: "NotAllowedError" },
    };
    const items = [
      { filename: "keep.mp3", audioUrl: "/keep.mp3", downloadUrl: "/keep.mp3", format: "mp3" as const, bytes: 1, createdAt: "2026-05-21T12:00:00.000Z" },
    ];

    expect(prunePlaybackState(current, items)).toEqual({
      "keep.mp3": { currentTime: 3, duration: 12, isPlaying: true },
    });
  });

  it("keeps playback state for hidden filtered items that still exist in the full library", () => {
    const current = {
      "visible.mp3": { currentTime: 2, duration: 8 },
      "hidden-but-live.wav": { currentTime: 6, duration: 10, isPlaying: false },
    };
    const allLibraryItems = [
      { filename: "visible.mp3", audioUrl: "/visible.mp3", downloadUrl: "/visible.mp3", format: "mp3" as const, bytes: 1, createdAt: "2026-05-21T12:00:00.000Z" },
      { filename: "hidden-but-live.wav", audioUrl: "/hidden-but-live.wav", downloadUrl: "/hidden-but-live.wav", format: "wav" as const, bytes: 1, createdAt: "2026-05-21T12:01:00.000Z" },
    ];

    expect(prunePlaybackState(current, allLibraryItems)).toEqual(current);
  });
});

describe("reference track analysis", () => {
  it("extracts a YouTube URL for prompt analysis", async () => {
    window.localStorage.clear();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/library") {
        return { json: async () => ({ ok: true, items: [] }) } as Response;
      }
      if (input === "/api/assess/youtube") {
        return {
          json: async () => ({
            ok: true,
            title: "YouTube Mix",
            filename: "youtube-reference-test.mp3",
            prompt: "matched youtube reference prompt",
            negativePrompt: "avoid crowded chorus",
            assessment: {
              summary: "Bright electro pop with chopped vocals.",
              attributes: {
                genre: ["electro pop"],
                instruments: ["chopped vocal", "sidechain bass"],
                mood: ["bright"],
                tempoBpm: 124,
              },
            },
          }),
        } as Response;
      }
      return { arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    fireEvent.change(await screen.findByLabelText("YouTube URL"), { target: { value: "https://www.youtube.com/watch?v=abc12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Extract audio" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/assess/youtube", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=abc12345678" }),
    })));
    expect(await screen.findByText("YouTube Mix")).toBeTruthy();
    expect(await screen.findByText("Bright electro pop with chopped vocals.")).toBeTruthy();
    expect(screen.getByDisplayValue("matched youtube reference prompt")).toBeTruthy();
  });

  it("accepts a dragged browser link as a YouTube reference", async () => {
    window.localStorage.clear();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/api/library") {
        return { json: async () => ({ ok: true, items: [] }) } as Response;
      }
      if (input === "/api/assess/youtube") {
        return {
          json: async () => ({
            ok: true,
            title: "Dragged YouTube Mix",
            filename: "youtube-reference-dragged.mp3",
            prompt: "prompt from dragged youtube link",
            negativePrompt: "avoid harsh splash",
            assessment: {
              summary: "Dragged link audio with bright drums.",
              attributes: {
                genre: ["dance pop"],
                instruments: ["drum machine"],
                mood: ["bright"],
                tempoBpm: 128,
              },
            },
          }),
        } as Response;
      }
      return { arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    const dropTarget = await screen.findByText(/Drop an MP3, WAV, or M4P here/);
    fireEvent.drop(dropTarget, {
      dataTransfer: {
        files: { item: () => null, length: 0 },
        getData: (type: string) => type === "text/uri-list" ? "https://youtu.be/dragged12345" : "",
      },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/assess/youtube", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ url: "https://youtu.be/dragged12345" }),
    })));
    expect(await screen.findByText("Dragged YouTube Mix")).toBeTruthy();
    expect(await screen.findByText("Dragged link audio with bright drums.")).toBeTruthy();
    expect(screen.getByDisplayValue("prompt from dragged youtube link")).toBeTruthy();
  });
});

describe("main page radio lineup action", () => {
  it("hides radio utility audio by default and shows it when toggled", async () => {
    window.localStorage.clear();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/api/library") {
        return {
          json: async () => ({
            ok: true,
            items: [
              { filename: "keeper.mp3", audioUrl: "/outputs/keeper.mp3", downloadUrl: "/outputs/keeper.mp3", metadataUrl: "/outputs/keeper.mp3.json", bundleUrl: "/api/library/bundle?filename=keeper.mp3", format: "mp3", bytes: 4096, createdAt: "2026-05-21T12:00:00.000Z", favorite: false },
              { filename: "radio_voice_test_1812345678901.mp3", audioUrl: "/outputs/radio_voice_test_1812345678901.mp3", downloadUrl: "/outputs/radio_voice_test_1812345678901.mp3", metadataUrl: "/outputs/radio_voice_test_1812345678901.mp3.json", bundleUrl: "/api/library/bundle?filename=radio_voice_test_1812345678901.mp3", format: "mp3", bytes: 1024, createdAt: "2026-05-21T12:01:00.000Z", favorite: false },
              { filename: "radio_announce_keeper_now_playing.mp3", audioUrl: "/outputs/radio_announce_keeper_now_playing.mp3", downloadUrl: "/outputs/radio_announce_keeper_now_playing.mp3", metadataUrl: "/outputs/radio_announce_keeper_now_playing.mp3.json", bundleUrl: "/api/library/bundle?filename=radio_announce_keeper_now_playing.mp3", format: "mp3", bytes: 1024, createdAt: "2026-05-21T12:02:00.000Z", favorite: false },
            ],
          }),
        } as Response;
      }
      return { arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fillRect: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    render(<Home />);

    const hideUtilityToggle = await screen.findByRole("button", { name: "Hide Voice" });
    expect(hideUtilityToggle.getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText("keeper.mp3")).toBeTruthy();
    expect(screen.queryByText("radio_voice_test_1812345678901.mp3")).toBeNull();
    expect(screen.queryByText("radio_announce_keeper_now_playing.mp3")).toBeNull();

    fireEvent.click(hideUtilityToggle);

    expect(hideUtilityToggle.getAttribute("aria-pressed")).toBe("false");
    expect(await screen.findByText("radio_voice_test_1812345678901.mp3")).toBeTruthy();
    expect(await screen.findByText("radio_announce_keeper_now_playing.mp3")).toBeTruthy();
  });

  it("uses the Favorites pill itself as the library filter toggle", async () => {
    window.localStorage.clear();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/api/library") {
        return {
          json: async () => ({
            ok: true,
            items: [
              { filename: "favorite_song.mp3", audioUrl: "/outputs/favorite_song.mp3", downloadUrl: "/outputs/favorite_song.mp3", format: "mp3", bytes: 4096, createdAt: "2026-05-21T12:00:00.000Z", favorite: true },
              { filename: "plain_song.mp3", audioUrl: "/outputs/plain_song.mp3", downloadUrl: "/outputs/plain_song.mp3", format: "mp3", bytes: 4096, createdAt: "2026-05-21T12:01:00.000Z", favorite: false },
            ],
          }),
        } as Response;
      }
      return { arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fillRect: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    render(<Home />);

    const favoritesToggle = await screen.findByRole("button", { name: "Favorites" });
    expect(screen.queryByRole("checkbox", { name: "Favorites" })).toBeNull();
    expect(favoritesToggle.getAttribute("aria-pressed")).toBe("false");
    expect(await screen.findByText(/favorite_song\.mp3/)).toBeTruthy();
    expect(await screen.findByText("plain_song.mp3")).toBeTruthy();

    fireEvent.click(favoritesToggle);

    expect(favoritesToggle.getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText(/favorite_song\.mp3/)).toBeTruthy();
    expect(screen.queryByText("plain_song.mp3")).toBeNull();
  });

  it("adds an mp3 library song to the radio lineup with its saved prompt metadata", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/library") {
        return {
          json: async () => ({
            ok: true,
            items: [{
              filename: "midnight_arcade.mp3",
              audioUrl: "/outputs/midnight_arcade.mp3",
              downloadUrl: "/outputs/midnight_arcade.mp3",
              metadataUrl: "/outputs/midnight_arcade.mp3.json",
              bundleUrl: "/api/library/bundle?filename=midnight_arcade.mp3",
              format: "mp3",
              bytes: 4096,
              createdAt: "2026-05-21T12:00:00.000Z",
              favorite: false,
              title: "Midnight Arcade",
              meta: { title: "Midnight Arcade", settings: { prompt: "warm synthwave night drive", mode: "music", model: "small-music", duration: 42, steps: 8, cfgScale: 1, format: "mp3", mock: false } },
            }],
          }),
        } as Response;
      }
      if (input === "/api/radio") {
        return { json: async () => ({ ok: true }) } as Response;
      }
      return { arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fillRect: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    render(<Home />);

    fireEvent.click(await screen.findByRole("button", { name: "Add Midnight Arcade to radio lineup" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        action: "track",
        filename: "midnight_arcade.mp3",
        title: "Midnight Arcade",
        styleId: "synthwave",
        prompt: "warm synthwave night drive",
        durationSeconds: 42,
      }),
    })));
    expect(await screen.findByRole("button", { name: "Midnight Arcade queued for radio" })).toHaveProperty("disabled", true);
  });

  it("adds a library song to the selected radio music type queue", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/api/library") {
        return {
          json: async () => ({
            ok: true,
            items: [{
              filename: "drift_signal.mp3",
              audioUrl: "/outputs/drift_signal.mp3",
              downloadUrl: "/outputs/drift_signal.mp3",
              metadataUrl: "/outputs/drift_signal.mp3.json",
              bundleUrl: "/api/library/bundle?filename=drift_signal.mp3",
              format: "mp3",
              bytes: 4096,
              createdAt: "2026-05-21T12:00:00.000Z",
              favorite: false,
              title: "Drift Signal",
              meta: { title: "Drift Signal", settings: { prompt: "slow evolving ambient pads", mode: "music", model: "small-music", duration: 64, steps: 8, cfgScale: 1, format: "mp3", mock: false } },
            }],
          }),
        } as Response;
      }
      if (input === "/api/radio") {
        return { json: async () => ({ ok: true }) } as Response;
      }
      return { arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fillRect: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    render(<Home />);

    fireEvent.change(await screen.findByLabelText("Radio queue"), { target: { value: "ambient" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add Drift Signal to radio lineup" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        action: "track",
        filename: "drift_signal.mp3",
        title: "Drift Signal",
        styleId: "ambient",
        prompt: "slow evolving ambient pads",
        durationSeconds: 64,
      }),
    })));
  });

  it("sends a library song to the audio assessor and displays returned attributes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/library") {
        return {
          json: async () => ({
            ok: true,
            items: [{
              filename: "assess_me.mp3",
              audioUrl: "/outputs/assess_me.mp3",
              downloadUrl: "/outputs/assess_me.mp3",
              metadataUrl: "/outputs/assess_me.mp3.json",
              bundleUrl: "/api/library/bundle?filename=assess_me.mp3",
              format: "mp3",
              bytes: 4096,
              createdAt: "2026-05-21T12:00:00.000Z",
              favorite: false,
              title: "Assess Me",
              rating: 5,
              meta: { title: "Assess Me", settings: { prompt: "warm lofi groove", mode: "music", seed: 77 } },
            }],
          }),
        } as Response;
      }
      if (input === "/api/assess") {
        return {
          json: async () => ({
            ok: true,
            assessment: {
              summary: "Warm lofi groove with dusty drums.",
              attributes: {
                genre: ["lofi hip hop"],
                instruments: ["electric piano", "drum machine"],
                mood: ["warm"],
                tempoBpm: 82,
              },
            },
          }),
        } as Response;
      }
      return { arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fillRect: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    render(<Home />);

    fireEvent.click(await screen.findByRole("button", { name: "Assess Assess Me" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/assess", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        filename: "assess_me.mp3",
        source: "library",
        title: "Assess Me",
        prompt: "warm lofi groove",
        rating: 5,
      }),
    })));
    expect(await screen.findByText("Warm lofi groove with dusty drums.")).toBeTruthy();
    expect(await screen.findByText(/electric piano, drum machine/)).toBeTruthy();
  });
});

describe("crop waveform overlay", () => {
  it("maps crop start/end seconds to clamped waveform percentages", () => {
    expect(buildCropOverlayPercentages({ start: 2, end: 5, duration: 10 })).toEqual({ left: 20, width: 30, start: 20, end: 50 });
    expect(buildCropOverlayPercentages({ start: -1, end: 15, duration: 10 })).toEqual({ left: 0, width: 100, start: 0, end: 100 });
    expect(buildCropOverlayPercentages({ start: 3, end: 3, duration: 10 })).toEqual({ left: 30, width: 0, start: 30, end: 30 });
  });

  it("maps audio playback time to a clamped waveform playhead percentage", () => {
    expect(buildPlayheadOverlayPercentage({ currentTime: 4, duration: 10 })).toBe(40);
    expect(buildPlayheadOverlayPercentage({ currentTime: -1, duration: 10 })).toBe(0);
    expect(buildPlayheadOverlayPercentage({ currentTime: 12, duration: 10 })).toBe(100);
    expect(buildPlayheadOverlayPercentage({ currentTime: 12, duration: 0 })).toBe(0);
  });

  it("maps waveform pointer position to a clamped seek time", () => {
    expect(buildSeekTimeFromPointer({ clientX: 60, rectLeft: 10, rectWidth: 100, duration: 20 })).toBe(10);
    expect(buildSeekTimeFromPointer({ clientX: -10, rectLeft: 10, rectWidth: 100, duration: 20 })).toBe(0);
    expect(buildSeekTimeFromPointer({ clientX: 140, rectLeft: 10, rectWidth: 100, duration: 20 })).toBe(20);
  });

  it("maps keyboard shortcuts to clamped waveform seek times", () => {
    expect(buildSeekTimeFromKeyboard({ key: "ArrowRight", currentTime: 5, duration: 20 })).toBe(6);
    expect(buildSeekTimeFromKeyboard({ key: "ArrowLeft", currentTime: 0.5, duration: 20 })).toBe(0);
    expect(buildSeekTimeFromKeyboard({ key: "PageUp", currentTime: 5, duration: 20 })).toBe(10);
    expect(buildSeekTimeFromKeyboard({ key: "PageDown", currentTime: 3, duration: 20 })).toBe(0);
    expect(buildSeekTimeFromKeyboard({ key: "Home", currentTime: 9, duration: 20 })).toBe(0);
    expect(buildSeekTimeFromKeyboard({ key: "End", currentTime: 9, duration: 20 })).toBe(20);
    expect(buildSeekTimeFromKeyboard({ key: "Tab", currentTime: 9, duration: 20 })).toBeUndefined();
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
