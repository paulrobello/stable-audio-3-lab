import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  songLengthMinutes: 2,
  unlikedTrackExpirationHours: 24,
  promptModel: "llama3.1:8b",
  ttsProvider: "openai",
  ttsVoice: "nova",
  announcementPrefix: "Now playing: ",
  announcementSuffix: "",
  customStyles: [],
  deletedStyleIds: [],
  styles: [{
    id: "synthwave",
    label: "Synthwave Night Drive",
    seedPrompt: "instrumental synthwave, warm analog bass, neon pads, clean punchy drums, 112 BPM, no vocals",
    negativePrompt: "muddy low end, harsh cymbals, distorted clipping, vocals",
  }, {
    id: "ambient",
    label: "Ambient Signal Drift",
    seedPrompt: "slow evolving ambient instrumental, wide pads, gentle arpeggios, spacious reverb, soft texture",
    negativePrompt: "busy drums, abrupt transitions, harsh noise, vocals",
  }],
  preferences: {},
  currentTrackByStyle: {},
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
      publicPlaylistUrls: {
        m3u: "https://radio.pardev.net/radio.m3u",
        pls: "https://radio.pardev.net/radio.pls",
      },
      lanPlaylistUrls: {
        m3u: "http://192.168.1.207:3007/radio.m3u",
        pls: "http://192.168.1.207:3007/radio.pls",
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithTrack, promptModels: ["qwen3:14b"] }),
    }));

    render(<RadioStationClient initialState={stateWithTrack} initialPromptModels={["qwen3:14b"]} />);

    expect(screen.getAllByText(/Synthwave Mobile Check/).length).toBeGreaterThan(0);
    expect(screen.getByText("3/3 ahead")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("http://localhost:3000/api/radio?stream=1")).toBeTruthy());
    expect(screen.getByText("https://radio.pardev.net/radio.m3u")).toBeTruthy();
    expect(screen.getByText("https://radio.pardev.net/radio.pls")).toBeTruthy();
    expect(screen.getByText("http://192.168.1.207:3007/radio.m3u")).toBeTruthy();
    expect(screen.getByText("http://192.168.1.207:3007/radio.pls")).toBeTruthy();
    expect(screen.getByRole("option", { name: "qwen3:14b" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Kokoro" })).toBeTruthy();
  });

  it("uses lightweight radio state refreshes after server-provided prompt models are loaded", async () => {
    const stateWithTrack = {
      ...radioState,
      currentTrack,
      history: [currentTrack],
      streamReady: true,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithTrack }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RadioStationClient initialState={stateWithTrack} initialPromptModels={["qwen3:14b"]} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/radio?promptModels=0", { cache: "no-store" }));
  });

  it("creates custom music styles from the radio UI", async () => {
    const customState: RadioStreamState = {
      ...radioState,
      selectedStyleId: "dungeon-synth",
      customStyles: [{
        id: "dungeon-synth",
        label: "Dungeon Synth",
        seedPrompt: "moody dungeon synth instrumental, tape hiss, simple medieval melody, no vocals",
        negativePrompt: "modern EDM drops, bright pop drums",
      }],
      styles: [{
        id: "synthwave",
        label: "Synthwave Night Drive",
        seedPrompt: "instrumental synthwave, warm analog bass, neon pads, clean punchy drums, 112 BPM, no vocals",
        negativePrompt: "muddy low end, harsh cymbals, distorted clipping, vocals",
      }, {
        id: "dungeon-synth",
        label: "Dungeon Synth",
        seedPrompt: "moody dungeon synth instrumental, tape hiss, simple medieval melody, no vocals",
        negativePrompt: "modern EDM drops, bright pop drums",
      }],
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string } : {};
      if (body.action === "createStyle") {
        return { json: async () => ({ ok: true, style: customState.customStyles?.[0], state: customState }) };
      }
      return { json: async () => ({ ok: true, state: radioState, promptModels: ["qwen3:14b"], cleanedTracks: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RadioStationClient initialState={radioState} initialPromptModels={["qwen3:14b"]} />);

    fireEvent.change(screen.getByLabelText("Style name"), { target: { value: "Dungeon Synth" } });
    fireEvent.change(screen.getByLabelText("Style prompt"), { target: { value: "moody dungeon synth instrumental, tape hiss, simple medieval melody, no vocals" } });
    fireEvent.change(screen.getByLabelText("Style negative prompt"), { target: { value: "modern EDM drops, bright pop drums" } });
    fireEvent.click(screen.getByRole("button", { name: "Create music style" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"action":"createStyle"'),
    })));
    expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"label":"Dungeon Synth"'),
    }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Dungeon Synth" })).toBeTruthy());
    expect(screen.getByText("moody dungeon synth instrumental, tape hiss, simple medieval melody, no vocals")).toBeTruthy();
  });

  it("generates style prompts with Codex and edits and deletes custom styles", async () => {
    const dungeonStyle = {
      id: "dungeon-synth",
      label: "Dungeon Synth",
      seedPrompt: "moody dungeon synth instrumental, tape hiss, simple medieval melody, no vocals",
      negativePrompt: "modern EDM drops, bright pop drums",
    };
    const customState: RadioStreamState = {
      ...radioState,
      selectedStyleId: dungeonStyle.id,
      customStyles: [dungeonStyle],
      styles: [...radioState.styles, dungeonStyle],
    };
    const updatedStyle = {
      ...dungeonStyle,
      label: "Dungeon Synth Tape",
      seedPrompt: "warbly cassette dungeon synth with bells and long minor-key pads",
      negativePrompt: "club drums, vocals",
    };
    const updatedState = {
      ...customState,
      customStyles: [updatedStyle],
      styles: [radioState.styles[0], updatedStyle],
    };
    const deletedState = {
      ...radioState,
      selectedStyleId: "synthwave",
      customStyles: [],
      styles: radioState.styles,
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string } : {};
      if (body.action === "draftStyle") {
        return {
          json: async () => ({
            ok: true,
            styleDraft: {
              label: "Dark Orchestral Breaks",
              seedPrompt: "brooding cinematic trip-hop with piano ostinatos and stormy strings",
              negativePrompt: "direct artist imitation, vocals",
              model: "gpt-5.5",
            },
          }),
        };
      }
      if (body.action === "updateStyle") {
        return { json: async () => ({ ok: true, style: updatedStyle, state: updatedState }) };
      }
      if (body.action === "deleteStyle") {
        return { json: async () => ({ ok: true, deletedStyle: updatedStyle, state: deletedState }) };
      }
      return { json: async () => ({ ok: true, state: customState, promptModels: ["qwen3:14b"], cleanedTracks: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<RadioStationClient initialState={customState} initialPromptModels={["qwen3:14b"]} />);

    fireEvent.change(screen.getByLabelText("Describe style"), { target: { value: "Rob D style like Furious Angels" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate style prompts with Codex" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"action":"draftStyle"'),
    })));
    await waitFor(() => expect((screen.getByLabelText("Style name") as HTMLInputElement).value).toBe("Dark Orchestral Breaks"));
    expect((screen.getByLabelText("Style prompt") as HTMLTextAreaElement).value).toContain("brooding cinematic trip-hop");

    fireEvent.click(screen.getByRole("button", { name: "Edit Dungeon Synth" }));
    fireEvent.change(screen.getByLabelText("Style name"), { target: { value: "Dungeon Synth Tape" } });
    fireEvent.change(screen.getByLabelText("Style prompt"), { target: { value: "warbly cassette dungeon synth with bells and long minor-key pads" } });
    fireEvent.change(screen.getByLabelText("Style negative prompt"), { target: { value: "club drums, vocals" } });
    fireEvent.click(screen.getByRole("button", { name: "Save music style" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"action":"updateStyle"'),
    })));
    await waitFor(() => expect(screen.getByRole("option", { name: "Dungeon Synth Tape" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Delete Dungeon Synth Tape" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"action":"deleteStyle"'),
    })));
    await waitFor(() => expect(screen.queryByRole("option", { name: "Dungeon Synth Tape" })).toBeNull());
  });

  it("edits and deletes default music styles from the radio UI", async () => {
    const editedStyle = {
      ...radioState.styles[0],
      label: "Synthwave Noir",
      seedPrompt: "darker synthwave instrumental with heavy analog bass and rain-gloss pads",
      negativePrompt: "thin drums, vocals",
    };
    const editedState = {
      ...radioState,
      customStyles: [editedStyle],
      styles: [editedStyle, ...radioState.styles.slice(1)],
    };
    const deletedState = {
      ...radioState,
      selectedStyleId: "synthwave",
      deletedStyleIds: ["ambient"],
      styles: radioState.styles.filter((style) => style.id !== "ambient"),
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string; styleId?: string } : {};
      if (body.action === "updateStyle") {
        return { json: async () => ({ ok: true, style: editedStyle, state: editedState }) };
      }
      if (body.action === "deleteStyle") {
        return { json: async () => ({ ok: true, deletedStyle: radioState.styles.find((style) => style.id === body.styleId), state: deletedState }) };
      }
      return { json: async () => ({ ok: true, state: radioState, promptModels: ["qwen3:14b"], cleanedTracks: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<RadioStationClient initialState={radioState} initialPromptModels={["qwen3:14b"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Synthwave Night Drive" }));
    fireEvent.change(screen.getByLabelText("Style name"), { target: { value: "Synthwave Noir" } });
    fireEvent.change(screen.getByLabelText("Style prompt"), { target: { value: "darker synthwave instrumental with heavy analog bass and rain-gloss pads" } });
    fireEvent.change(screen.getByLabelText("Style negative prompt"), { target: { value: "thin drums, vocals" } });
    fireEvent.click(screen.getByRole("button", { name: "Save music style" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"styleId":"synthwave"'),
    })));
    await waitFor(() => expect(screen.getByRole("option", { name: "Synthwave Noir" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Delete Ambient Signal Drift" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"styleId":"ambient"'),
    })));
    await waitFor(() => expect(screen.queryByRole("option", { name: "Ambient Signal Drift" })).toBeNull());
  });

  it("plays a generated test voice sample from the selected TTS settings", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string } : {};
      if (body.action === "testVoice") {
        return { json: async () => ({ ok: true, audioUrl: "/outputs/radio_voice_test_sample.mp3" }) };
      }
      return { json: async () => ({ ok: true, state: radioState, promptModels: ["qwen3:14b"], cleanedTracks: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const playMock = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const { container } = render(<RadioStationClient initialState={radioState} initialPromptModels={["qwen3:14b"]} />);

    await waitFor(() => {
      const button = screen.getByRole("button", { name: "Test voice" }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });
    fireEvent.change(screen.getByLabelText("TTS voice"), { target: { value: "alloy" } });
    const testVoiceButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: "Test voice" }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      return button;
    });
    fireEvent.click(testVoiceButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"action":"testVoice"'),
    })));
    expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"ttsVoice":"alloy"'),
    }));
    await waitFor(() => expect(container.querySelector('audio[data-testid="test-voice-audio"]')?.getAttribute("src")).toBe("/outputs/radio_voice_test_sample.mp3"));
    expect(playMock).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Playing test voice sample.")).toBeTruthy());
  });

  it("renders the voice control as a provider-specific dropdown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: radioState, promptModels: ["qwen3:14b"], cleanedTracks: [] }),
    }));

    render(<RadioStationClient initialState={radioState} initialPromptModels={["qwen3:14b"]} />);

    const voiceSelect = screen.getByRole("combobox", { name: "TTS voice" });
    expect(voiceSelect.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: /Nova/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Alloy/ })).toBeTruthy();

    const providerSelect = screen.getByRole("combobox", { name: "Provider" });
    fireEvent.change(providerSelect, { target: { value: "gemini" } });

    await waitFor(() => expect(screen.getByRole("option", { name: /Kore/ })).toBeTruthy());
  });

  it("loads ElevenLabs account voices into the voice dropdown", async () => {
    const elevenLabsState = { ...radioState, ttsProvider: "elevenlabs" as const, ttsVoice: "Juniper" };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string } : {};
      if (body.action === "ttsVoices") {
        return {
          json: async () => ({
            ok: true,
            voices: [
              { id: "voice-alpha", label: "Alpha", description: "warm" },
              { id: "voice-beta", label: "Beta", description: "bright" },
            ],
          }),
        };
      }
      return { json: async () => ({ ok: true, state: elevenLabsState, promptModels: ["qwen3:14b"], cleanedTracks: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RadioStationClient initialState={elevenLabsState} initialPromptModels={["qwen3:14b"]} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"action":"ttsVoices"'),
    })));
    await waitFor(() => expect(screen.getByRole("option", { name: "Alpha - warm" })).toBeTruthy());
    expect(screen.getByRole("option", { name: "Beta - bright" })).toBeTruthy();
  });

  it("surfaces browser playback failures instead of reporting silent success", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string } : {};
      if (body.action === "testVoice") {
        return { json: async () => ({ ok: true, audioUrl: "/outputs/radio_voice_test_sample.mp3" }) };
      }
      return { json: async () => ({ ok: true, state: radioState, promptModels: ["qwen3:14b"], cleanedTracks: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("autoplay blocked"));
    render(<RadioStationClient initialState={radioState} initialPromptModels={["qwen3:14b"]} />);

    const testVoiceButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: "Test voice" }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      return button;
    });
    fireEvent.click(testVoiceButton);

    await waitFor(() => expect(screen.getByText(/Test voice sample is ready/)).toBeTruthy());
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

  it("plays a generated announcement asset before switching to the song stream", async () => {
    const announcedTrack = {
      ...currentTrack,
      announce: true,
      announcementFilename: "radio_announce_synthwave_mobile_check.mp3",
    };
    const stateWithAnnouncement = {
      ...radioState,
      currentTrack: announcedTrack,
      history: [announcedTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithAnnouncement, promptModels: ["qwen3:14b"] }),
    }));
    const playMock = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    const { container } = render(<RadioStationClient initialState={stateWithAnnouncement} initialPromptModels={["qwen3:14b"]} />);

    await waitFor(() => expect(container.querySelector("audio")?.getAttribute("src")).toBe("http://localhost:3000/outputs/radio_announce_synthwave_mobile_check.mp3"));
    fireEvent.ended(container.querySelector("audio")!);

    await waitFor(() => expect(container.querySelector("audio")?.getAttribute("src")).toBe("http://localhost:3000/api/radio?stream=1&skipAnnouncement=1"));
    expect(playMock).toHaveBeenCalled();
  });

  it("skips existing announcement audio when title announcements are disabled", async () => {
    const announcedTrack = {
      ...currentTrack,
      announce: true,
      announcementFilename: "radio_announce_synthwave_mobile_check.mp3",
    };
    const stateWithDisabledAnnouncements = {
      ...radioState,
      announceEnabled: false,
      currentTrack: announcedTrack,
      history: [announcedTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithDisabledAnnouncements, promptModels: ["qwen3:14b"] }),
    }));

    const { container } = render(<RadioStationClient initialState={stateWithDisabledAnnouncements} initialPromptModels={["qwen3:14b"]} />);

    await waitFor(() => expect(container.querySelector("audio")?.getAttribute("src")).toBe("http://localhost:3000/api/radio?stream=1&skipAnnouncement=1"));
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
      await vi.advanceTimersByTimeAsync(30000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock.mock.calls.filter(([_url, init]) => !init?.method).length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls.some(([_url, init]) => typeof init?.body === "string" && init.body.includes('"action":"cleanup"'))).toBe(false);
  });

  it("leaves queue refill generation to the server", async () => {
    const depletedQueueState = {
      ...radioState,
      currentTrack,
      history: [currentTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
      queueAheadCount: 0,
      needsQueueFill: true,
      updatedAt: "2026-05-26T12:00:02.000Z",
    };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return { json: async () => ({ ok: true, state: depletedQueueState, promptModels: ["qwen3:14b"], cleanedTracks: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RadioStationClient initialState={depletedQueueState} initialPromptModels={["qwen3:14b"]} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/generate")).toBe(false);
    expect(fetchMock.mock.calls.some(([_url, init]) => typeof init?.body === "string" && init.body.includes('"action":"fallbackTrack"'))).toBe(false);
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

  it("does not advance visible progress from the shared station clock while local audio is idle", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-28T20:01:00.000Z") });
    const stateWithIdleTrack = {
      ...radioState,
      currentTrack: { ...currentTrack, durationSeconds: 90 },
      currentTrackStartedAt: "2026-05-28T20:00:00.000Z",
      history: [{ ...currentTrack, durationSeconds: 90 }],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithIdleTrack, promptModels: ["qwen3:14b"] }),
    }));

    render(<RadioStationClient initialState={stateWithIdleTrack} initialPromptModels={["qwen3:14b"]} />);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText("0:00 / 1:30")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Song progress" }).getAttribute("aria-valuenow")).toBe("0");
  });

  it("uses a 2 minute default song length and sends selected minutes as generation seconds", async () => {
    const stateWithDraft = {
      ...radioState,
      currentDraft: {
        id: "draft-1",
        title: "Four Minute Drift",
        prompt: "four minute synthwave instrumental",
        negativePrompt: "vocals",
        styleId: "synthwave" as const,
        createdAt: "2026-05-26T12:00:00.000Z",
        promptProvider: "fallback" as const,
        promptModel: "llama3.1:8b",
      },
      queueAheadCount: 3,
      needsQueueFill: false,
    };
    const generatedTrack = { ...currentTrack, title: "Four Minute Drift", durationSeconds: 240 };
    const generatedState = {
      ...stateWithDraft,
      currentTrack: generatedTrack,
      history: [generatedTrack],
      songLengthMinutes: 4,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string; songLengthMinutes?: number; duration?: number; durationSeconds?: number } : {};
      if (url === "/api/generate") {
        return { json: async () => ({ ok: true, filename: "four_minute_drift.mp3", title: "Four Minute Drift" }) };
      }
      if (body.action === "configure") {
        return { json: async () => ({ ok: true, state: { ...stateWithDraft, songLengthMinutes: body.songLengthMinutes }, cleanedTracks: [] }) };
      }
      if (body.action === "track") {
        return { json: async () => ({ ok: true, state: generatedState, cleanedTracks: [] }) };
      }
      return { json: async () => ({ ok: true, state: stateWithDraft, promptModels: ["qwen3:14b"], cleanedTracks: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RadioStationClient initialState={stateWithDraft} initialPromptModels={["qwen3:14b"]} />);

    const songLengthSelect = screen.getByRole("combobox", { name: "Song length" }) as HTMLSelectElement;
    expect(songLengthSelect.value).toBe("2");
    expect(screen.getByRole("option", { name: "1 minute" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "6 minutes" })).toBeTruthy();

    fireEvent.change(songLengthSelect, { target: { value: "4" } });
    await waitFor(() => {
      expect(songLengthSelect.value).toBe("4");
      const button = screen.getByRole("button", { name: "Generate station song" }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate station song" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/generate", expect.objectContaining({
      body: expect.stringContaining('"duration":240'),
    })));
    expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"songLengthMinutes":4'),
    }));
    expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"durationSeconds":240'),
    }));
  });

  it("shows and persists the unliked song expiration setting", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string; unlikedTrackExpirationHours?: number } : {};
      if (body.action === "configure") {
        return { json: async () => ({ ok: true, state: { ...radioState, unlikedTrackExpirationHours: body.unlikedTrackExpirationHours }, cleanedTracks: [] }) };
      }
      return { json: async () => ({ ok: true, state: radioState, promptModels: ["qwen3:14b"], cleanedTracks: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RadioStationClient initialState={radioState} initialPromptModels={["qwen3:14b"]} />);

    const expirationSelect = screen.getByRole("combobox", { name: "Unliked song expiration" }) as HTMLSelectElement;
    expect(expirationSelect.value).toBe("24");

    fireEvent.change(expirationSelect, { target: { value: "72" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"unlikedTrackExpirationHours":72'),
    })));
  });

  it("keeps the station player on the same stream when the browser audio element ends", async () => {
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

    expect(container.querySelector("audio")?.getAttribute("src")).toBe("http://localhost:3000/api/radio?stream=1");
    expect(screen.getByText(/Waiting for more station audio/)).toBeTruthy();
    expect(playMock).not.toHaveBeenCalled();
  });

  it("selects a clicked lineup song and reconnects the player", async () => {
    const previousTrack = {
      ...currentTrack,
      id: "track-previous",
      filename: "previous_song.mp3",
      title: "Previous Song",
      prompt: "previous prompt",
    };
    const stateWithLineup = {
      ...radioState,
      currentTrack,
      history: [previousTrack, currentTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
      queueAheadCount: 0,
    };
    const selectedState = {
      ...stateWithLineup,
      currentTrack: previousTrack,
      queueAheadCount: 1,
      updatedAt: "2026-05-26T12:00:01.000Z",
    };
    let latestState: RadioStreamState = stateWithLineup;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string; filename?: string } : {};
      if (body.action === "selectTrack") latestState = selectedState;
      return {
        json: async () => ({ ok: true, state: latestState, promptModels: ["qwen3:14b"], cleanedTracks: [] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const playMock = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const { container } = render(<RadioStationClient initialState={stateWithLineup} initialPromptModels={["qwen3:14b"]} />);

    const previousPlayButton = screen.getByRole("button", { name: "Play Previous Song" });
    const currentPlayButton = screen.getByRole("button", { name: "Now playing Synthwave Mobile Check" }) as HTMLButtonElement;
    expect(previousPlayButton.textContent).toBe("Play");
    expect(currentPlayButton.disabled).toBe(true);

    fireEvent.click(previousPlayButton);

    await waitFor(() => expect(screen.getAllByText(/Now playing: Previous Song/).length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"action":"selectTrack"'),
    }));
    expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"filename":"previous_song.mp3"'),
    }));
    await waitFor(() => expect(container.querySelector("audio")?.getAttribute("src")).toBe("http://localhost:3000/api/radio?stream=1&client=1"));
    expect(playMock).toHaveBeenCalled();
  });

  it("skips the current song and reconnects the player to the next track", async () => {
    const nextTrack = {
      ...currentTrack,
      id: "track-next",
      filename: "next_song.mp3",
      title: "Next Song",
      prompt: "next prompt",
    };
    const stateWithLineup = {
      ...radioState,
      currentTrack,
      history: [currentTrack, nextTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
      queueAheadCount: 1,
    };
    const skippedState = {
      ...stateWithLineup,
      currentTrack: nextTrack,
      history: [currentTrack, nextTrack],
      queueAheadCount: 0,
      updatedAt: "2026-05-26T12:00:01.000Z",
    };
    let latestState: RadioStreamState = stateWithLineup;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string } : {};
      if (body.action === "skipTrack") latestState = skippedState;
      return {
        json: async () => ({
          ok: true,
          skippedTrack: body.action === "skipTrack" ? currentTrack : undefined,
          state: latestState,
          promptModels: ["qwen3:14b"],
          cleanedTracks: [],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const playMock = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const { container } = render(<RadioStationClient initialState={stateWithLineup} initialPromptModels={["qwen3:14b"]} />);

    expect(container.querySelector("audio")?.getAttribute("src")).toBe("http://localhost:3000/api/radio?stream=1");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => expect(screen.getAllByText(/Now playing: Next Song/).length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"action":"skipTrack"'),
    }));
    expect(fetchMock.mock.calls.some(([_url, init]) => typeof init?.body === "string" && init.body.includes('"rating"'))).toBe(false);
    await waitFor(() => expect(container.querySelector("audio")?.getAttribute("src")).toBe("http://localhost:3000/api/radio?stream=1&client=1"));
    expect(playMock).toHaveBeenCalled();
  });

  it("deletes a radio queue row after confirmation", async () => {
    const previousTrack = {
      ...currentTrack,
      id: "track-previous",
      filename: "previous_song.mp3",
      title: "Previous Song",
      prompt: "previous prompt",
    };
    const stateWithLineup = {
      ...radioState,
      currentTrack,
      history: [previousTrack, currentTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
      queueAheadCount: 3,
      needsQueueFill: false,
    };
    const deletedState = {
      ...stateWithLineup,
      history: [currentTrack],
      updatedAt: "2026-05-26T12:00:01.000Z",
    };
    let latestState: RadioStreamState = stateWithLineup;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string; filename?: string } : {};
      if (body.action === "deleteTrack") latestState = deletedState;
      return {
        json: async () => ({ ok: true, deletedTrack: previousTrack, state: latestState, promptModels: ["qwen3:14b"], cleanedTracks: [] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<RadioStationClient initialState={stateWithLineup} initialPromptModels={["qwen3:14b"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Previous Song" }));

    await waitFor(() => expect(screen.queryByText("Previous Song")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"action":"deleteTrack"'),
    }));
    expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"filename":"previous_song.mp3"'),
    }));
  });

  it("bulk removes selected radio queue rows after confirmation", async () => {
    const previousTrack = {
      ...currentTrack,
      id: "track-previous",
      filename: "previous_song.mp3",
      title: "Previous Song",
      prompt: "previous prompt",
    };
    const secondPreviousTrack = {
      ...currentTrack,
      id: "track-second-previous",
      filename: "second_previous_song.mp3",
      title: "Second Previous Song",
      prompt: "second previous prompt",
    };
    const stateWithLineup = {
      ...radioState,
      currentTrack,
      history: [previousTrack, secondPreviousTrack, currentTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
      queueAheadCount: 3,
      needsQueueFill: false,
    };
    let latestState: RadioStreamState = stateWithLineup;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string; filename?: string } : {};
      let deletedTrack: RadioTrackRecord | undefined;
      if (body.action === "deleteTrack" && body.filename) {
        deletedTrack = latestState.history.find((track) => track.filename === body.filename);
        latestState = {
          ...latestState,
          history: latestState.history.filter((track) => track.filename !== body.filename),
          updatedAt: "2026-05-26T12:00:01.000Z",
        };
      }
      return {
        json: async () => ({ ok: true, deletedTrack, state: latestState, promptModels: ["qwen3:14b"], cleanedTracks: [] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<RadioStationClient initialState={stateWithLineup} initialPromptModels={["qwen3:14b"]} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Previous Song" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Second Previous Song" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected (2)" }));

    await waitFor(() => expect(screen.queryByText("Previous Song")).toBeNull());
    expect(screen.queryByText("Second Previous Song")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"filename":"previous_song.mp3"'),
    }));
    expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"filename":"second_previous_song.mp3"'),
    }));
  });

  it("shows only the selected music style queue in the lineup", async () => {
    const ambientTrack = {
      ...currentTrack,
      id: "track-ambient",
      filename: "ambient_queue_song.mp3",
      title: "Ambient Queue Song",
      prompt: "soft ambient queue",
      styleId: "ambient" as const,
    };
    const stateWithMixedQueues = {
      ...radioState,
      currentTrack,
      selectedStyleId: "synthwave" as const,
      history: [currentTrack, ambientTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithMixedQueues, promptModels: ["qwen3:14b"], cleanedTracks: [] }),
    }));

    render(<RadioStationClient initialState={stateWithMixedQueues} initialPromptModels={["qwen3:14b"]} />);

    expect(screen.getByRole("button", { name: "Now playing Synthwave Mobile Check" })).toBeTruthy();
    expect(screen.queryByText("Ambient Queue Song")).toBeNull();
  });

  it("shows created time and age on radio queue rows", () => {
    vi.setSystemTime(new Date("2026-05-27T12:00:00.000Z"));
    const queuedTrack = {
      ...currentTrack,
      id: "track-queued-metadata",
      filename: "queued_metadata_song.mp3",
      title: "Queued Metadata Song",
      prompt: "queue metadata prompt",
      createdAt: "2026-05-26T12:00:00.000Z",
    };
    const stateWithMetadata = {
      ...radioState,
      currentTrack,
      history: [currentTrack, queuedTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
      queueAheadCount: 1,
      needsQueueFill: true,
    };

    const { container } = render(<RadioStationClient initialState={stateWithMetadata} initialPromptModels={["qwen3:14b"]} />);

    expect(screen.getByText("Queued Metadata Song")).toBeTruthy();
    expect(screen.getAllByText("Created").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/May 26, 2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 day old").length).toBeGreaterThan(0);
    expect(container.querySelector('time[datetime="2026-05-26T12:00:00.000Z"]')).toBeTruthy();
  });

  it("shows thumbs up status for liked queue items", () => {
    const likedQueuedTrack = {
      ...currentTrack,
      id: "track-liked-queue",
      filename: "liked_queue_song.mp3",
      title: "Liked Queue Song",
      prompt: "liked queue prompt",
      rating: "up" as const,
    };
    const stateWithLikedQueuedTrack = {
      ...radioState,
      currentTrack,
      selectedStyleId: "synthwave" as const,
      history: [currentTrack, likedQueuedTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithLikedQueuedTrack, promptModels: ["qwen3:14b"], cleanedTracks: [] }),
    }));

    render(<RadioStationClient initialState={stateWithLikedQueuedTrack} initialPromptModels={["qwen3:14b"]} />);

    expect(screen.getByText("Liked Queue Song")).toBeTruthy();
    expect(screen.getAllByText("Thumbs up").length).toBeGreaterThan(0);
  });

  it("rates radio queue rows with thumbs up and down actions", async () => {
    const queuedTrack = {
      ...currentTrack,
      id: "track-rate-queue",
      filename: "rate_queue_song.mp3",
      title: "Rate Queue Song",
      prompt: "rate queue prompt",
    };
    const stateWithQueuedTrack = {
      ...radioState,
      currentTrack,
      selectedStyleId: "synthwave" as const,
      history: [currentTrack, queuedTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string; rating?: string } : {};
      if (body.action === "rating" && body.rating === "up") {
        return {
          json: async () => ({
            ok: true,
            state: {
              ...stateWithQueuedTrack,
              history: [currentTrack, { ...queuedTrack, rating: "up" }],
              preferences: { synthwave: { likes: [queuedTrack.prompt], dislikes: [] } },
            },
          }),
        };
      }
      if (body.action === "rating" && body.rating === "down") {
        return {
          json: async () => ({
            ok: true,
            state: {
              ...stateWithQueuedTrack,
              history: [currentTrack, { ...queuedTrack, rating: "down" }],
              preferences: { synthwave: { likes: [], dislikes: [queuedTrack.prompt] } },
            },
          }),
        };
      }
      return { json: async () => ({ ok: true, state: stateWithQueuedTrack, promptModels: ["qwen3:14b"], cleanedTracks: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RadioStationClient initialState={stateWithQueuedTrack} initialPromptModels={["qwen3:14b"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Thumbs up Rate Queue Song" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"phrase":"rate queue prompt"'),
    })));
    expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"rating":"up"'),
    }));

    fireEvent.click(screen.getByRole("button", { name: "Thumbs down Rate Queue Song" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/radio", expect.objectContaining({
      body: expect.stringContaining('"rating":"down"'),
    })));
  });

  it("sends the current radio song to the audio assessor with rating context", async () => {
    const likedTrack = { ...currentTrack, rating: "up" as const };
    const stateWithTrack = {
      ...radioState,
      currentTrack: likedTrack,
      history: [likedTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string } : {};
      if (!body.action && init?.method === "POST") {
        return {
          json: async () => ({
            ok: true,
            assessment: {
              summary: "Bright synthwave with a steady electronic pulse.",
              attributes: {
                instruments: ["analog bass", "drum machine"],
                mood: ["driving"],
              },
            },
          }),
        };
      }
      return { json: async () => ({ ok: true, state: stateWithTrack, promptModels: ["qwen3:14b"], cleanedTracks: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RadioStationClient initialState={stateWithTrack} initialPromptModels={["qwen3:14b"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Assess current song" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/assess", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        filename: "synthwave_mobile_check.mp3",
        source: "radio",
        title: "Synthwave Mobile Check",
        prompt: "instrumental synthwave mobile render check",
        styleId: "synthwave",
        rating: "up",
      }),
    })));
    expect(await screen.findByText("Bright synthwave with a steady electronic pulse.")).toBeTruthy();
    expect(await screen.findByText(/analog bass, drum machine/)).toBeTruthy();
  });

  it("shows a local radio assessment error when the assessor is not configured", async () => {
    const stateWithTrack = {
      ...radioState,
      currentTrack,
      history: [currentTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string } : {};
      if (!body.action && init?.method === "POST") {
        return {
          json: async () => ({
            ok: false,
            error: "Set STABLE_AUDIO_ASSESSOR_COMMAND to a local audio assessment command.",
          }),
        };
      }
      return { json: async () => ({ ok: true, state: stateWithTrack, promptModels: ["qwen3:14b"], cleanedTracks: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RadioStationClient initialState={stateWithTrack} initialPromptModels={["qwen3:14b"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Assess current song" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Set STABLE_AUDIO_ASSESSOR_COMMAND");
  });

  it("shows created time, age, and file size for radio queue items", () => {
    vi.useFakeTimers({ now: new Date("2026-05-26T14:05:00.000Z") });
    const queuedTrack = {
      ...currentTrack,
      id: "track-queue-metadata",
      filename: "queue_metadata_song.mp3",
      title: "Queue Metadata Song",
      createdAt: "2026-05-26T12:00:00.000Z",
      fileSizeBytes: 1_234_567,
    };
    const stateWithMetadata = {
      ...radioState,
      currentTrack,
      selectedStyleId: "synthwave" as const,
      history: [currentTrack, queuedTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithMetadata, promptModels: ["qwen3:14b"], cleanedTracks: [] }),
    }));

    const { container } = render(<RadioStationClient initialState={stateWithMetadata} initialPromptModels={["qwen3:14b"]} />);

    expect(screen.getByText("Queue Metadata Song")).toBeTruthy();
    expect(container.querySelector('time[dateTime="2026-05-26T12:00:00.000Z"]')).toBeTruthy();
    expect(screen.getAllByText(/2 hours old/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1.2 MB/).length).toBeGreaterThan(0);
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

  it("shows radio station stats from the stream state", () => {
    const stateWithStats = {
      ...radioState,
      currentTrack,
      history: [currentTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
      stats: {
        generatedSongCount: 12,
        thumbsUpCount: 3,
        thumbsDownCount: 2,
        audioDiskBytes: 5 * 1024 * 1024,
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithStats, promptModels: ["qwen3:14b"] }),
    }));

    render(<RadioStationClient initialState={stateWithStats} initialPromptModels={["qwen3:14b"]} />);

    const stats = within(screen.getByLabelText("Station stats"));
    expect(stats.getByText("Songs generated")).toBeTruthy();
    expect(stats.getByText("12")).toBeTruthy();
    expect(stats.getByText("Thumbs up")).toBeTruthy();
    expect(stats.getByText("3")).toBeTruthy();
    expect(stats.getByText("Thumbs down")).toBeTruthy();
    expect(stats.getByText("2")).toBeTruthy();
    expect(stats.getByText("Audio on disk")).toBeTruthy();
    expect(stats.getByText("5.0 MB")).toBeTruthy();
  });

  it("shows assessment queue status from the stream state", () => {
    const stateWithAssessmentQueue = {
      ...radioState,
      currentTrack,
      history: [currentTrack],
      streamReady: true,
      streamUrl: "/api/radio?stream=1",
      assessmentQueue: {
        pendingCount: 2,
        status: "paused" as const,
        loadRatio: 0.32,
        loadThreshold: 0.25,
        nextFilename: "synthwave_mobile_check.mp3",
        nextRating: "up",
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, state: stateWithAssessmentQueue, promptModels: ["qwen3:14b"] }),
    }));

    render(<RadioStationClient initialState={stateWithAssessmentQueue} initialPromptModels={["qwen3:14b"]} />);

    const queue = within(screen.getByLabelText("Assessment queue status"));
    expect(queue.getByText("Assessment queue")).toBeTruthy();
    expect(queue.getByText("Paused for load")).toBeTruthy();
    expect(queue.getByText("2 pending")).toBeTruthy();
    expect(queue.getByText("Load 32% / limit 25%")).toBeTruthy();
    expect(queue.getByText("Next: synthwave_mobile_check.mp3 (up)")).toBeTruthy();
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
