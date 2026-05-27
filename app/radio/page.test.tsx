import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RadioStationClient from "./RadioStationClient";
import type { RadioStreamState, RadioTrackRecord } from "@/lib/radio";

const originalLocation = window.location;

const currentTrack: RadioTrackRecord = {
  id: "track-mobile",
  filename: "synthwave_mobile_check.mp3",
  title: "Synthwave Mobile Check",
  prompt: "instrumental synthwave mobile render check",
  styleId: "synthwave",
  announce: false,
  createdAt: "2026-05-26T12:00:00.000Z",
  promptProvider: "fallback",
  promptModel: "llama3.1:8b",
};

const radioState: RadioStreamState = {
  selectedStyleId: "synthwave",
  announceEnabled: true,
  promptModel: "llama3.1:8b",
  ttsProvider: "openai",
  ttsVoice: "nova",
  announcementPrefix: "Now playing: ",
  announcementSuffix: "",
  preferences: {},
  history: [],
  updatedAt: "2026-05-26T12:00:00.000Z",
  streamReady: false,
  queueAheadCount: 3,
  queueTarget: 3,
  needsQueueFill: false,
};

describe("radio page loading", () => {
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders server-provided station state and prompt models before the client refresh completes", async () => {
    const stateWithTrack = {
      ...radioState,
      currentTrack,
      history: [currentTrack],
      streamReady: true,
      streamUrl: "https://radio.pardev.net/api/radio?stream=1",
      lanStreamUrl: "http://192.168.1.207:3007/api/radio?stream=1",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithTrack, promptModels: ["qwen3:14b"] }),
    }));

    render(<RadioStationClient initialState={stateWithTrack} initialPromptModels={["qwen3:14b"]} />);

    expect(screen.getAllByText(/Synthwave Mobile Check/).length).toBeGreaterThan(0);
    expect(screen.getByText("3/3 ahead")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("http://localhost:3000/api/radio?stream=1")).toBeTruthy());
    expect(screen.getByRole("option", { name: "qwen3:14b" })).toBeTruthy();
  });

  it("rewrites embedded radio URLs to the browser origin used to load the page", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("https://mobile-radio.example.test/radio"),
    });
    const stateWithTrack = {
      ...radioState,
      currentTrack,
      history: [currentTrack],
      streamReady: true,
      streamUrl: "https://radio.pardev.net/api/radio?stream=1",
      lanStreamUrl: "http://192.168.1.207:3007/api/radio?stream=1",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithTrack, promptModels: ["qwen3:14b"] }),
    }));

    const { container } = render(<RadioStationClient initialState={stateWithTrack} initialPromptModels={["qwen3:14b"]} />);

    await waitFor(() => expect(screen.getByText("https://mobile-radio.example.test/api/radio?stream=1")).toBeTruthy());
    expect(container.querySelector("audio")?.getAttribute("src")).toBe("https://mobile-radio.example.test/api/radio?stream=1");
  });

  it("keeps one active audio player on the original source during same-track refreshes", async () => {
    const stateWithTrack = {
      ...radioState,
      currentTrack,
      history: [currentTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
      lanStreamUrl: "http://192.168.1.207:3007/api/radio?stream=1",
    };
    const refreshedState = {
      ...stateWithTrack,
      updatedAt: "2026-05-26T12:00:01.000Z",
      streamUrl: "/api/radio?stream=1&refresh=1",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: refreshedState, promptModels: ["qwen3:14b"] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<RadioStationClient initialState={stateWithTrack} initialPromptModels={["qwen3:14b"]} />);
    const initialAudio = container.querySelector("audio");

    expect(container.querySelectorAll("audio")).toHaveLength(1);
    expect(initialAudio?.getAttribute("src")).toBe("http://localhost:3000/api/radio?stream=1");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(container.querySelectorAll("audio")).toHaveLength(1);
    expect(container.querySelector("audio")).toBe(initialAudio);
    expect(container.querySelector("audio")?.getAttribute("src")).toBe("http://localhost:3000/api/radio?stream=1");
  });

  it("polls radio state so queue refill runs after stream-side track advancement", async () => {
    vi.useFakeTimers();
    const fullQueueState = {
      ...radioState,
      currentTrack,
      history: [currentTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
      updatedAt: "2026-05-26T12:00:01.000Z",
    };
    const depletedQueueState = {
      ...fullQueueState,
      queueAheadCount: 0,
      needsQueueFill: true,
      updatedAt: "2026-05-26T12:00:02.000Z",
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string } : {};
      if (!init?.method) {
        return {
          json: async () => ({ ok: true, state: fetchMock.mock.calls.length < 2 ? fullQueueState : depletedQueueState, promptModels: ["qwen3:14b"] }),
        };
      }
      return {
        json: async () => ({ ok: true, state: depletedQueueState, promptModels: ["qwen3:14b"], cleanedTracks: [] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RadioStationClient initialState={fullQueueState} initialPromptModels={["qwen3:14b"]} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock.mock.calls.filter(([_url, init]) => !init?.method).length).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock.mock.calls.filter(([_url, init]) => !init?.method).length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls.some(([_url, init]) => typeof init?.body === "string" && init.body.includes('"action":"cleanup"'))).toBe(true);
  });

  it("shows song duration and progress for the current track", () => {
    const stateWithTrack = {
      ...radioState,
      currentTrack: { ...currentTrack, durationSeconds: 90 },
      history: [{ ...currentTrack, durationSeconds: 90 }],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithTrack, promptModels: ["qwen3:14b"] }),
    }));

    render(<RadioStationClient initialState={stateWithTrack} initialPromptModels={["qwen3:14b"]} />);

    expect(screen.getByText("0:00 / 1:30")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Song progress" }).getAttribute("aria-valuemax")).toBe("90");
  });

  it("reconnects the stream when the browser audio element ends", async () => {
    const stateWithTrack = {
      ...radioState,
      currentTrack,
      history: [currentTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithTrack, promptModels: ["qwen3:14b"] }),
    }));
    const playMock = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    const { container } = render(<RadioStationClient initialState={stateWithTrack} initialPromptModels={["qwen3:14b"]} />);
    const audio = container.querySelector("audio");

    expect(audio?.getAttribute("src")).toBe("http://localhost:3000/api/radio?stream=1");
    fireEvent.ended(audio!);

    await waitFor(() => expect(container.querySelector("audio")?.getAttribute("src")).toBe("http://localhost:3000/api/radio?stream=1&client=1"));
    expect(playMock).toHaveBeenCalled();
  });

  it("indicates when the current song is already liked", () => {
    const likedTrack = { ...currentTrack, rating: "up" as const };
    const stateWithLikedTrack = {
      ...radioState,
      currentTrack: likedTrack,
      history: [likedTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithLikedTrack, promptModels: ["qwen3:14b"] }),
    }));

    render(<RadioStationClient initialState={stateWithLikedTrack} initialPromptModels={["qwen3:14b"]} />);

    expect(screen.getByRole("button", { name: "Liked" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("indicates when the current song prompt is in saved likes", () => {
    const stateWithSavedLike = {
      ...radioState,
      currentTrack,
      history: [currentTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
      preferences: { synthwave: { likes: [currentTrack.prompt], dislikes: [] } },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithSavedLike, promptModels: ["qwen3:14b"] }),
    }));

    render(<RadioStationClient initialState={stateWithSavedLike} initialPromptModels={["qwen3:14b"]} />);

    expect(screen.getByRole("button", { name: "Liked" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows liked feedback after pressing Like", async () => {
    const stateWithTrack = {
      ...radioState,
      currentTrack,
      history: [currentTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
      queueAheadCount: 3,
    };
    const likedTrack = { ...currentTrack, rating: "up" as const };
    const likedState = {
      ...stateWithTrack,
      currentTrack: likedTrack,
      history: [likedTrack],
      preferences: { synthwave: { likes: [currentTrack.prompt], dislikes: [] } },
    };
    let latestState: RadioStreamState = stateWithTrack;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string } : {};
      if (body.action === "rating") latestState = likedState;
      return {
        json: async () => ({ ok: true, state: latestState, promptModels: ["qwen3:14b"], cleanedTracks: [] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<RadioStationClient initialState={stateWithTrack} initialPromptModels={["qwen3:14b"]} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Like" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Like" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Liked" }).getAttribute("aria-pressed")).toBe("true"));
    expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"rating":"up"'),
    }));
  });

  it("removes liked feedback after pressing Liked again", async () => {
    const likedTrack = { ...currentTrack, rating: "up" as const };
    const likedState = {
      ...radioState,
      currentTrack: likedTrack,
      history: [likedTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
      queueAheadCount: 3,
      preferences: { synthwave: { likes: [currentTrack.prompt], dislikes: [] } },
    };
    const unlikedState = {
      ...likedState,
      currentTrack,
      history: [currentTrack],
      preferences: { synthwave: { likes: [], dislikes: [] } },
    };
    let latestState: RadioStreamState = likedState;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string } : {};
      if (body.action === "rating") latestState = unlikedState;
      return {
        json: async () => ({ ok: true, state: latestState, promptModels: ["qwen3:14b"], cleanedTracks: [] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<RadioStationClient initialState={likedState} initialPromptModels={["qwen3:14b"]} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Liked" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Liked" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Like" }).getAttribute("aria-pressed")).toBe("false"));
    expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"rating":"up"'),
    }));
  });

  it("retries radio state loading so mobile controls do not stay stuck on queue loading", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue({
        json: async () => ({ ok: true, state: radioState, promptModels: ["gemma3:12b"], cleanedTracks: [] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<RadioStationClient />);

    expect(screen.getByText("Queue loading")).toBeTruthy();

    await waitFor(() => expect(screen.getByText("3/3 ahead")).toBeTruthy(), { timeout: 4000 });
  }, 7000);
});
