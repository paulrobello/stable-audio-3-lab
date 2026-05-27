import { describe, expect, it } from "vitest";
import {
  buildAnnouncementText,
  buildRadioAnnouncementFilename,
  buildRadioPlaylistContent,
  buildRadioPlaylistUrls,
  buildRadioPublicStreamUrl,
  buildRadioPromptGeneratorMessages,
  buildRadioPromptSeed,
  buildRadioTasteDistillationPrompt,
  buildRadioLanStreamUrl,
  buildRadioStreamState,
  buildRadioTrackPlaybackFilenames,
  createFallbackRadioPromptDraft,
  createRadioTrackRecord,
  defaultRadioState,
  findDuplicateRadioTitleTracks,
  findRadioTracksForCleanup,
  getRadioQueueAheadCount,
  normalizeRadioTtsConfig,
  normalizeRadioState,
  getRadioTtsVoiceOptions,
  normalizeRadioRating,
  normalizeRadioStyleId,
  radioStyles,
  registerRadioTrack,
  replaceRadioTrackInLineup,
  removeRadioTracksFromLineup,
  readRadioConfigFileValue,
  readRadioEnvFileValue,
  resolveRadioAnnouncementFilename,
  rejectCurrentRadioTrack,
  advanceRadioCurrentTrack,
  recordRadioRating,
  selectRadioTrack,
  shouldGenerateRadioQueueTrack,
  updateRadioTasteProfile,
} from "./radio";

describe("radio station styles", () => {
  it("defaults radio songs to two minutes and clamps configured minute values", () => {
    expect((defaultRadioState() as { songLengthMinutes?: number }).songLengthMinutes).toBe(2);
    expect((normalizeRadioState({ songLengthMinutes: 6 } as Parameters<typeof normalizeRadioState>[0]) as { songLengthMinutes?: number }).songLengthMinutes).toBe(6);
    expect((normalizeRadioState({ songLengthMinutes: 9 } as Parameters<typeof normalizeRadioState>[0]) as { songLengthMinutes?: number }).songLengthMinutes).toBe(2);
    expect((normalizeRadioState({ songLengthMinutes: 0 } as Parameters<typeof normalizeRadioState>[0]) as { songLengthMinutes?: number }).songLengthMinutes).toBe(2);
  });

  it("defaults unliked radio song expiration to 24 hours and clamps configured hour values", () => {
    expect((defaultRadioState() as { unlikedTrackExpirationHours?: number }).unlikedTrackExpirationHours).toBe(24);
    expect((normalizeRadioState({ unlikedTrackExpirationHours: 72 } as Parameters<typeof normalizeRadioState>[0]) as { unlikedTrackExpirationHours?: number }).unlikedTrackExpirationHours).toBe(72);
    expect((normalizeRadioState({ unlikedTrackExpirationHours: 0 } as Parameters<typeof normalizeRadioState>[0]) as { unlikedTrackExpirationHours?: number }).unlikedTrackExpirationHours).toBe(24);
    expect((normalizeRadioState({ unlikedTrackExpirationHours: 999 } as Parameters<typeof normalizeRadioState>[0]) as { unlikedTrackExpirationHours?: number }).unlikedTrackExpirationHours).toBe(24);
  });

  it("falls back to synthwave for unknown style ids", () => {
    expect(normalizeRadioStyleId("ambient")).toBe("ambient");
    expect(normalizeRadioStyleId("missing")).toBe("synthwave");
  });

  it("builds a station prompt seed from selected style and feedback", () => {
    const state = recordRadioRating(
      recordRadioRating(defaultRadioState(), "synthwave", "warm analog bass", "up"),
      "synthwave",
      "harsh compressed drums",
      "down",
    );

    const seed = buildRadioPromptSeed(state, "synthwave");

    expect(seed).toContain("Style: Synthwave Night Drive");
    expect(seed).toContain("Lean into: warm analog bass");
    expect(seed).toContain("Avoid repeating: harsh compressed drums");
  });

  it("uses only the selected style distilled taste profile in prompt seeds", () => {
    const state = {
      ...defaultRadioState(),
      preferences: {
        synthwave: {
          likes: ["warm analog bass"],
          dislikes: ["harsh cymbals"],
          tasteProfile: {
            likedTraits: ["wide neon pads", "clean gated snares"],
            dislikedTraits: ["thin supersaw leads"],
            promptDirectives: ["write a night-drive hook with a stronger B section"],
            negativePromptDirectives: ["avoid brittle top-end fizz"],
            explorationNotes: ["try adjacent outrun bass movement"],
            updatedAt: "2026-05-26T12:00:00.000Z",
            sourceEventCount: 2,
            provider: "codex-cli",
            model: "gpt-5.5",
          },
        },
        ambient: {
          likes: ["soft tape drift"],
          dislikes: [],
          tasteProfile: {
            likedTraits: ["granular clouds"],
            dislikedTraits: [],
            promptDirectives: ["make it beatless"],
            negativePromptDirectives: [],
            explorationNotes: [],
            updatedAt: "2026-05-26T12:00:00.000Z",
            sourceEventCount: 1,
            provider: "codex-cli",
            model: "gpt-5.5",
          },
        },
      },
    } satisfies ReturnType<typeof defaultRadioState>;

    const seed = buildRadioPromptSeed(state, "synthwave");

    expect(seed).toContain("Distilled listener taste:");
    expect(seed).toContain("Liked traits: wide neon pads; clean gated snares");
    expect(seed).toContain("Prompt directives: write a night-drive hook with a stronger B section");
    expect(seed).toContain("Negative prompt directives: avoid brittle top-end fizz");
    expect(seed).not.toContain("granular clouds");
  });

  it("builds a Codex CLI prompt from style-only thumbs feedback", () => {
    const state = recordRadioRating(
      recordRadioRating(defaultRadioState(), "lofi", "dusty rhodes chords and soft tape wobble", "up"),
      "lofi",
      "thin hi hats and harsh clipping",
      "down",
    );

    const prompt = buildRadioTasteDistillationPrompt(state, "lofi");

    expect(prompt).toContain("Style: Lofi Study Loop");
    expect(prompt).toContain("Thumbs up prompts:");
    expect(prompt).toContain("dusty rhodes chords and soft tape wobble");
    expect(prompt).toContain("Thumbs down prompts:");
    expect(prompt).toContain("thin hi hats and harsh clipping");
    expect(prompt).toContain("Return JSON only");
  });

  it("updates a single style taste profile without changing other style memories", () => {
    const state = recordRadioRating(defaultRadioState(), "ambient", "slow soft pads", "up");
    const updated = updateRadioTasteProfile(state, "synthwave", {
      likedTraits: ["analog bass"],
      dislikedTraits: ["muddy kick"],
      promptDirectives: ["add a clearer chorus"],
      negativePromptDirectives: ["avoid over-compression"],
      explorationNotes: ["try brighter arps"],
    }, "gpt-5.5", "2026-05-26T12:00:00.000Z");

    expect(updated.preferences.ambient?.likes).toEqual(["slow soft pads"]);
    expect(updated.preferences.synthwave?.tasteProfile).toMatchObject({
      likedTraits: ["analog bass"],
      dislikedTraits: ["muddy kick"],
      promptDirectives: ["add a clearer chorus"],
      negativePromptDirectives: ["avoid over-compression"],
      explorationNotes: ["try brighter arps"],
      provider: "codex-cli",
      model: "gpt-5.5",
      sourceEventCount: 0,
    });
  });

  it("keeps prompt generation scoped to local Ollama 8B-30B model experiments", () => {
    const existing = createRadioTrackRecord({
      filename: "existing.mp3",
      title: "Existing Synth Title",
      prompt: "warm bass",
      styleId: "synthwave",
      announce: false,
    });
    const state = { ...defaultRadioState(), currentTrack: existing, history: [existing] };
    const messages = buildRadioPromptGeneratorMessages(state, "cinematic", "llama3.1:8b");

    expect(messages.model).toBe("llama3.1:8b");
    expect(messages.provider).toBe("ollama");
    expect(messages.system).toContain("8B to 30B");
    expect(messages.prompt).toContain("Cinematic Trailer Pulse");
    expect(messages.prompt).toContain("Existing Synth Title");
    expect(messages.prompt).toContain("Do not reuse");
    expect(messages.prompt).toContain("Return JSON only");
  });

  it("adds entropy to fallback drafts so queued songs do not share the same title", () => {
    const first = createFallbackRadioPromptDraft(defaultRadioState("2026-05-26T12:00:00.000Z"), "synthwave", "llama3.1:8b", "2026-05-26T12:00:00.000Z");
    const queuedState = registerRadioTrack(defaultRadioState("2026-05-26T12:00:00.000Z"), createRadioTrackRecord({
      filename: "first.mp3",
      title: first.title,
      prompt: first.prompt,
      styleId: first.styleId,
      announce: false,
    }));

    const second = createFallbackRadioPromptDraft(queuedState, "synthwave", "llama3.1:8b", "2026-05-26T12:01:00.000Z");

    expect(second.title).not.toBe(first.title);
    expect(second.prompt).not.toBe(first.prompt);
    expect(second.prompt).toContain("variation seed");
  });
});

describe("radio ratings", () => {
  it("normalizes thumbs ratings", () => {
    expect(normalizeRadioRating("up")).toBe("up");
    expect(normalizeRadioRating("down")).toBe("down");
    expect(normalizeRadioRating("meh")).toBeNull();
  });

  it("stores likes and dislikes per style", () => {
    const state = recordRadioRating(defaultRadioState(), "lofi", "dusty mellow rhodes", "up");
    const updated = recordRadioRating(state, "lofi", "thin hi hats", "down");

    expect(updated.preferences.lofi?.likes).toEqual(["dusty mellow rhodes"]);
    expect(updated.preferences.lofi?.dislikes).toEqual(["thin hi hats"]);
    expect(updated.updatedAt).not.toBe(state.updatedAt);
  });

  it("pressing like again removes the like from the current song", () => {
    const track = createRadioTrackRecord({
      filename: "liked_song.mp3",
      title: "Liked Song",
      prompt: "warm analog bass",
      styleId: "synthwave",
      announce: false,
    });
    const state = recordRadioRating({ ...defaultRadioState(), currentTrack: track, history: [track] }, "synthwave", track.prompt, "up");

    const toggled = recordRadioRating(state, "synthwave", track.prompt, "up");

    expect(toggled.preferences.synthwave?.likes).toEqual([]);
    expect(toggled.currentTrack?.rating).toBeUndefined();
    expect(toggled.history[0].rating).toBeUndefined();
  });
});

describe("radio TTS settings", () => {
  it("lists provider-specific voice options and preserves a saved custom voice", () => {
    expect(getRadioTtsVoiceOptions("openai").map((voice) => voice.id)).toContain("nova");
    expect(getRadioTtsVoiceOptions("gemini").map((voice) => voice.id)).toContain("Kore");
    expect(getRadioTtsVoiceOptions("deepgram").map((voice) => voice.id)).toContain("aura-2-thalia-en");
    expect(getRadioTtsVoiceOptions("kokoro-onnx").map((voice) => voice.id)).toContain("af_sarah");
    expect(getRadioTtsVoiceOptions("elevenlabs", "custom-account-voice")[0]).toEqual({
      id: "custom-account-voice",
      label: "custom-account-voice",
    });
  });

  it("normalizes configurable TTS provider, voice, and announcement text", () => {
    const config = normalizeRadioTtsConfig({
      ttsProvider: "elevenlabs",
      ttsVoice: "Rachel",
      announcementPrefix: "Coming up: ",
      announcementSuffix: " on Paul's station",
    });

    expect(config).toEqual({
      ttsProvider: "elevenlabs",
      ttsVoice: "Rachel",
      announcementPrefix: "Coming up: ",
      announcementSuffix: " on Paul's station",
    });
    expect(buildAnnouncementText("Night Signal", config)).toBe("Coming up: Night Signal on Paul's station");
  });

  it("normalizes Kokoro TTS provider aliases to the node provider", () => {
    expect(normalizeRadioTtsConfig({
      ttsProvider: "kokoro-onnx",
      ttsVoice: "af_sarah",
      announcementPrefix: "Now playing: ",
      announcementSuffix: "",
    }).ttsProvider).toBe("kokoro-onnx");
    expect(normalizeRadioTtsConfig({
      ttsProvider: "kokoro",
      ttsVoice: "af_sarah",
      announcementPrefix: "Now playing: ",
      announcementSuffix: "",
    }).ttsProvider).toBe("kokoro-onnx");
  });

  it("reads API keys from the par-tts YAML config format", () => {
    const contents = [
      "# PAR CLI TTS Configuration File",
      "provider: \"elevenlabs\"",
      "elevenlabs_api_key: \"eleven-test-key\"",
      "deepgram_api_key: 'deepgram-test-key'",
      "gemini_api_key: gemini-test-key # inline comment",
      "openai_api_key: ",
    ].join("\n");

    expect(readRadioConfigFileValue(contents, "elevenlabs_api_key")).toBe("eleven-test-key");
    expect(readRadioConfigFileValue(contents, "deepgram_api_key")).toBe("deepgram-test-key");
    expect(readRadioConfigFileValue(contents, "gemini_api_key")).toBe("gemini-test-key");
    expect(readRadioConfigFileValue(contents, "openai_api_key")).toBeUndefined();
  });

  it("builds stable announcer filenames for the same song and TTS settings", () => {
    const state = normalizeRadioTtsConfig({
      ttsProvider: "openai",
      ttsVoice: "nova",
      announcementPrefix: "Now playing: ",
      announcementSuffix: "",
    });
    const track = createRadioTrackRecord({
      filename: "synthwave_mobile_check.mp3",
      title: "Synthwave Mobile Check",
      prompt: "instrumental synthwave",
      styleId: "synthwave",
      announce: true,
    });
    const sameSongNewRecord = { ...track, id: "track-new-id" };

    expect(buildRadioAnnouncementFilename(track, state)).toBe(buildRadioAnnouncementFilename(sameSongNewRecord, state));
    expect(buildRadioAnnouncementFilename(track, { ...state, ttsVoice: "alloy" })).not.toBe(buildRadioAnnouncementFilename(track, state));
  });

  it("resolves announcer filenames from track records or saved metadata for deletion", () => {
    const track = createRadioTrackRecord({
      filename: "synthwave_mobile_check.mp3",
      title: "Synthwave Mobile Check",
      prompt: "instrumental synthwave",
      styleId: "synthwave",
      announce: true,
    });
    const metadata = { radio: { announcementFilename: "radio_announce_synthwave_mobile_check_now_playing.mp3" } };

    expect(resolveRadioAnnouncementFilename({ ...track, announcementFilename: "radio_announce_track_record.mp3" }, metadata)).toBe("radio_announce_track_record.mp3");
    expect(resolveRadioAnnouncementFilename(track, metadata)).toBe("radio_announce_synthwave_mobile_check_now_playing.mp3");
    expect(resolveRadioAnnouncementFilename(track, { radio: { announcementFilename: "../bad.mp3" } })).toBeUndefined();
  });

  it("plays the announcer file before the song audio when announcements exist", () => {
    const track = createRadioTrackRecord({
      filename: "synthwave_mobile_check.mp3",
      title: "Synthwave Mobile Check",
      prompt: "instrumental synthwave",
      styleId: "synthwave",
      announce: true,
      announcementFilename: "radio_announce_synthwave_mobile_check.mp3",
    });

    expect(buildRadioTrackPlaybackFilenames(track)).toEqual([
      "radio_announce_synthwave_mobile_check.mp3",
      "synthwave_mobile_check.mp3",
    ]);
    expect(buildRadioTrackPlaybackFilenames(track, { skipAnnouncement: true })).toEqual([
      "synthwave_mobile_check.mp3",
    ]);
  });

  it("persists generated announcer metadata on the current track and lineup", () => {
    const track = createRadioTrackRecord({
      filename: "synthwave_mobile_check.mp3",
      title: "Synthwave Mobile Check",
      prompt: "instrumental synthwave",
      styleId: "synthwave",
      announce: false,
    });
    const next = createRadioTrackRecord({
      filename: "next_song.mp3",
      title: "Next Song",
      prompt: "wide pads",
      styleId: "synthwave",
      announce: false,
    });
    const updatedTrack = {
      ...track,
      announce: true,
      announcementFilename: "radio_announce_synthwave_mobile_check.mp3",
    };

    const originalState = { ...defaultRadioState(), currentTrack: track, history: [track, next] };

    const state = replaceRadioTrackInLineup(originalState, updatedTrack);

    expect(state.currentTrack).toEqual(updatedTrack);
    expect(state.history.map((item) => item.filename)).toEqual(["synthwave_mobile_check.mp3", "next_song.mp3"]);
    expect(state.history[0]).toEqual(updatedTrack);
    expect(state.updatedAt).not.toBe(originalState.updatedAt);
  });

  it("reads provider keys from a local env file without exposing unrelated values", () => {
    const contents = [
      "OPENAI_API_KEY=sk-openai",
      "GEMINI_API_KEY='gemini-key'",
      "OTHER_SECRET=hidden",
    ].join("\n");

    expect(readRadioEnvFileValue(contents, "OPENAI_API_KEY")).toBe("sk-openai");
    expect(readRadioEnvFileValue(contents, "GEMINI_API_KEY")).toBe("gemini-key");
    expect(readRadioEnvFileValue(contents, "OTHER_SECRET")).toBe("hidden");
    expect(readRadioEnvFileValue(contents, "MISSING_KEY")).toBeUndefined();
  });
});

describe("radio stream state", () => {
  it("builds a LAN stream URL for Sonos/TuneIn clients", () => {
    expect(buildRadioLanStreamUrl("192.168.1.50", "3007")).toBe("http://192.168.1.50:3007/api/radio?stream=1");
    expect(buildRadioLanStreamUrl("not-an-ip", "3007")).toBeUndefined();
  });

  it("builds a public stream URL for Cloudflare tunnel clients", () => {
    expect(buildRadioPublicStreamUrl("https://radio.pardev.net")).toBe("https://radio.pardev.net/api/radio?stream=1");
    expect(buildRadioPublicStreamUrl("https://radio.pardev.net/radio")).toBe("https://radio.pardev.net/api/radio?stream=1");
    expect(buildRadioPublicStreamUrl("https://radio.pardev.net", "ambient")).toBe("https://radio.pardev.net/api/radio?stream=1&style=ambient");
    expect(buildRadioPublicStreamUrl("ftp://radio.pardev.net")).toBeUndefined();
  });

  it("builds TuneIn playlist URLs without changing the continuous mp3 stream URL", () => {
    expect(buildRadioPlaylistUrls("https://radio.pardev.net")).toEqual({
      m3u: "https://radio.pardev.net/radio.m3u",
      pls: "https://radio.pardev.net/radio.pls",
    });
    expect(buildRadioPlaylistUrls("http://192.168.1.50:3007/radio")).toEqual({
      m3u: "http://192.168.1.50:3007/radio.m3u",
      pls: "http://192.168.1.50:3007/radio.pls",
    });
    expect(buildRadioPlaylistUrls("https://radio.pardev.net", "ambient")).toEqual({
      m3u: "https://radio.pardev.net/radio.m3u?style=ambient",
      pls: "https://radio.pardev.net/radio.pls?style=ambient",
    });
    expect(buildRadioPlaylistUrls("ftp://radio.pardev.net")).toBeUndefined();
    expect(buildRadioPublicStreamUrl("https://radio.pardev.net")).toBe("https://radio.pardev.net/api/radio?stream=1");
  });

  it("builds m3u and pls files that point TuneIn clients at the icy mp3 stream", () => {
    expect(buildRadioPlaylistContent("m3u", "https://radio.pardev.net/api/radio?stream=1&icy=1")).toBe([
      "#EXTM3U",
      "#EXTINF:-1,Stable Audio 3 Lab Radio",
      "https://radio.pardev.net/api/radio?stream=1&icy=1",
      "",
    ].join("\n"));
    expect(buildRadioPlaylistContent("pls", "http://192.168.1.50:3007/api/radio?stream=1&icy=1")).toBe([
      "[playlist]",
      "NumberOfEntries=1",
      "File1=http://192.168.1.50:3007/api/radio?stream=1&icy=1",
      "Title1=Stable Audio 3 Lab Radio",
      "Length1=-1",
      "Version=2",
      "",
    ].join("\n"));
  });

  it("exposes an mp3 current track as streamable", () => {
    const track = createRadioTrackRecord({
      filename: "midnight_arcade.mp3",
      title: "Midnight Arcade",
      prompt: radioStyles[0].seedPrompt,
      styleId: "synthwave",
      announce: false,
      promptProvider: "ollama",
      promptModel: "llama3.1:8b",
    });

    const state = buildRadioStreamState({ ...defaultRadioState(), currentTrack: track });

    expect(state.streamReady).toBe(true);
    expect(state.streamUrl).toBe("/api/radio?stream=1");
    expect(state.currentTrack?.filename).toBe("midnight_arcade.mp3");
    expect(state.currentTrack?.promptProvider).toBe("ollama");
    expect(state.currentTrack?.promptModel).toBe("llama3.1:8b");
  });

  it("does not mark wav tracks as TuneIn-ready mp3 streams", () => {
    const track = createRadioTrackRecord({
      filename: "wide_pad.wav",
      title: "Wide Pad",
      prompt: "ambient wide pad",
      styleId: "ambient",
      announce: true,
    });

    const state = buildRadioStreamState({ ...defaultRadioState(), currentTrack: track });

    expect(state.streamReady).toBe(false);
  });

  it("removes a rejected current track from lineup and advances to the next mp3", () => {
    const rejected = createRadioTrackRecord({
      filename: "skip_me.mp3",
      title: "Skip Me",
      prompt: "harsh drums",
      styleId: "synthwave",
      announce: false,
    });
    const next = createRadioTrackRecord({
      filename: "next_song.mp3",
      title: "Next Song",
      prompt: "warm bass",
      styleId: "synthwave",
      announce: false,
    });
    const state = { ...defaultRadioState(), currentTrack: rejected, history: [rejected, next] };

    const result = rejectCurrentRadioTrack(state);

    expect(result.rejectedTrack).toEqual(rejected);
    expect(result.state.currentTrack?.filename).toBe("next_song.mp3");
    expect(result.state.history.map((track) => track.filename)).toEqual(["next_song.mp3"]);
  });

  it("advances the stream current track after a song finishes without removing lineup metadata", () => {
    const current = createRadioTrackRecord({
      filename: "current_song.mp3",
      title: "Current Song",
      prompt: "warm bass",
      styleId: "synthwave",
      announce: false,
    });
    const next = createRadioTrackRecord({
      filename: "next_song.mp3",
      title: "Next Song",
      prompt: "wide pads",
      styleId: "synthwave",
      announce: true,
      announcementFilename: "radio_announce_next_song.mp3",
    });
    const state = { ...defaultRadioState(), currentTrack: current, history: [current, next] };

    const advanced = advanceRadioCurrentTrack(state);

    expect(advanced.currentTrack?.filename).toBe("next_song.mp3");
    expect(advanced.history.map((track) => track.filename)).toEqual(["current_song.mp3", "next_song.mp3"]);
    expect(advanced.updatedAt).not.toBe(state.updatedAt);
  });

  it("advances and counts queue tracks inside the current music style", () => {
    const current = createRadioTrackRecord({
      filename: "synth_current.mp3",
      title: "Synth Current",
      prompt: "warm bass",
      styleId: "synthwave",
      announce: false,
    });
    const ambient = createRadioTrackRecord({
      filename: "ambient_current.mp3",
      title: "Ambient Current",
      prompt: "wide pads",
      styleId: "ambient",
      announce: false,
    });
    const next = createRadioTrackRecord({
      filename: "synth_next.mp3",
      title: "Synth Next",
      prompt: "neon lead",
      styleId: "synthwave",
      announce: false,
    });
    const state = { ...defaultRadioState(), currentTrack: current, history: [current, ambient, next] };

    expect(getRadioQueueAheadCount(state)).toBe(1);

    const advanced = advanceRadioCurrentTrack(state);

    expect(advanced.currentTrack?.filename).toBe("synth_next.mp3");
  });

  it("selects an earlier lineup song without removing or reordering metadata", () => {
    const first = createRadioTrackRecord({
      filename: "first_song.mp3",
      title: "First Song",
      prompt: "first prompt",
      styleId: "synthwave",
      announce: false,
    });
    const current = createRadioTrackRecord({
      filename: "current_song.mp3",
      title: "Current Song",
      prompt: "current prompt",
      styleId: "synthwave",
      announce: false,
    });
    const next = createRadioTrackRecord({
      filename: "next_song.mp3",
      title: "Next Song",
      prompt: "next prompt",
      styleId: "synthwave",
      announce: false,
    });
    const originalState = { ...defaultRadioState(), currentTrack: current, history: [first, current, next] };

    const result = selectRadioTrack(originalState, "first_song.mp3");

    expect(result.selectedTrack).toEqual(first);
    expect(result.state.currentTrack).toEqual(first);
    expect(result.state.history.map((track) => track.filename)).toEqual(["first_song.mp3", "current_song.mp3", "next_song.mp3"]);
    expect(getRadioQueueAheadCount(result.state)).toBe(2);
    expect(result.state.updatedAt).not.toBe(originalState.updatedAt);
  });

  it("queues newly generated tracks behind the current song", () => {
    const current = createRadioTrackRecord({
      filename: "current.mp3",
      title: "Current",
      prompt: "warm bass",
      styleId: "synthwave",
      announce: false,
    });
    const next = createRadioTrackRecord({
      filename: "next.mp3",
      title: "Next",
      prompt: "wide pads",
      styleId: "synthwave",
      announce: false,
    });

    const state = registerRadioTrack({ ...defaultRadioState(), currentTrack: current, history: [current] }, next);

    expect(state.currentTrack?.filename).toBe("current.mp3");
    expect(state.history.map((track) => track.filename)).toEqual(["current.mp3", "next.mp3"]);
    expect(getRadioQueueAheadCount(state)).toBe(1);
    expect(shouldGenerateRadioQueueTrack(state, 3)).toBe(true);
  });

  it("queues generated tracks after a persisted current song when changing music styles", () => {
    const synthCurrent = createRadioTrackRecord({
      filename: "synth_current.mp3",
      title: "Synth Current",
      prompt: "warm bass",
      styleId: "synthwave",
      announce: false,
    });
    const ambientCurrent = createRadioTrackRecord({
      filename: "ambient_current.mp3",
      title: "Ambient Current",
      prompt: "soft pads",
      styleId: "ambient",
      announce: false,
    });
    const ambientQueued = createRadioTrackRecord({
      filename: "ambient_queued.mp3",
      title: "Ambient Queued",
      prompt: "tape drift",
      styleId: "ambient",
      announce: false,
    });
    const ambientNext = createRadioTrackRecord({
      filename: "ambient_next.mp3",
      title: "Ambient Next",
      prompt: "granular cloud",
      styleId: "ambient",
      announce: false,
    });
    const state = {
      ...defaultRadioState(),
      selectedStyleId: "ambient" as const,
      currentTrackByStyle: {
        synthwave: synthCurrent.filename,
        ambient: ambientCurrent.filename,
      },
      history: [synthCurrent, ambientCurrent, ambientQueued],
    };

    const queued = registerRadioTrack(state, ambientNext);

    expect(queued.currentTrack?.filename).toBe("ambient_current.mp3");
    expect(queued.history.map((track) => track.filename)).toEqual([
      "synth_current.mp3",
      "ambient_current.mp3",
      "ambient_queued.mp3",
      "ambient_next.mp3",
    ]);
    expect(getRadioQueueAheadCount(queued)).toBe(2);
  });

  it("stops queue generation when three songs are ahead of the current song", () => {
    const tracks = ["current", "one", "two", "three"].map((name) => createRadioTrackRecord({
      filename: `${name}.mp3`,
      title: name,
      prompt: name,
      styleId: "synthwave",
      announce: false,
    }));
    const state = { ...defaultRadioState(), currentTrack: tracks[0], history: tracks };

    expect(getRadioQueueAheadCount(state)).toBe(3);
    expect(shouldGenerateRadioQueueTrack(state, 3)).toBe(false);
  });

  it("exposes queue fill status in stream state", () => {
    const current = createRadioTrackRecord({
      filename: "current.mp3",
      title: "Current",
      prompt: "warm bass",
      styleId: "synthwave",
      announce: false,
    });
    const next = createRadioTrackRecord({
      filename: "next.mp3",
      title: "Next",
      prompt: "wide pads",
      styleId: "synthwave",
      announce: false,
    });
    const state = buildRadioStreamState({ ...defaultRadioState(), currentTrack: current, history: [current, next] });

    expect(state.queueAheadCount).toBe(1);
    expect(state.queueTarget).toBe(3);
    expect(state.needsQueueFill).toBe(true);
  });

  it("finds old generated songs without thumbs up for cleanup", () => {
    const now = "2026-05-26T12:00:00.000Z";
    const oldUnliked = { ...createRadioTrackRecord({ filename: "old_unliked.mp3", title: "Old", prompt: "old", styleId: "synthwave", announce: false }), createdAt: "2026-05-25T11:59:00.000Z" };
    const oldLiked = { ...createRadioTrackRecord({ filename: "old_liked.mp3", title: "Liked", prompt: "liked", styleId: "synthwave", announce: false }), createdAt: "2026-05-24T11:00:00.000Z", rating: "up" as const };
    const newUnliked = { ...createRadioTrackRecord({ filename: "new_unliked.mp3", title: "New", prompt: "new", styleId: "synthwave", announce: false }), createdAt: "2026-05-25T12:01:00.000Z" };
    const state = { ...defaultRadioState(), currentTrack: oldUnliked, history: [oldUnliked, oldLiked, newUnliked] };

    expect(findRadioTracksForCleanup(state, now).map((track) => track.filename)).toEqual(["old_unliked.mp3"]);
  });

  it("uses configured unliked song expiration hours for cleanup", () => {
    const now = "2026-05-26T12:00:00.000Z";
    const oldUnliked = { ...createRadioTrackRecord({ filename: "old_unliked.mp3", title: "Old", prompt: "old", styleId: "synthwave", announce: false }), createdAt: "2026-05-25T11:59:00.000Z" };
    const dayOldUnliked = { ...createRadioTrackRecord({ filename: "day_old_unliked.mp3", title: "Day Old", prompt: "day old", styleId: "synthwave", announce: false }), createdAt: "2026-05-25T11:00:00.000Z" };
    const state = { ...defaultRadioState(), unlikedTrackExpirationHours: 48, history: [oldUnliked, dayOldUnliked] };

    expect(findRadioTracksForCleanup(state, now).map((track) => track.filename)).toEqual([]);
  });

  it("finds duplicate unliked queued titles for cleanup while keeping the current song", () => {
    const current = createRadioTrackRecord({ filename: "current.mp3", title: "Repeated Title", prompt: "current", styleId: "synthwave", announce: false });
    const duplicate = createRadioTrackRecord({ filename: "duplicate.mp3", title: "Repeated Title", prompt: "same", styleId: "synthwave", announce: false });
    const likedDuplicate = { ...createRadioTrackRecord({ filename: "liked.mp3", title: "Repeated Title", prompt: "liked", styleId: "synthwave", announce: false }), rating: "up" as const };
    const state = { ...defaultRadioState(), currentTrack: current, history: [current, duplicate, likedDuplicate] };

    expect(findDuplicateRadioTitleTracks(state).map((track) => track.filename)).toEqual(["duplicate.mp3"]);
  });

  it("removes cleaned tracks from the lineup and advances current when needed", () => {
    const oldUnliked = { ...createRadioTrackRecord({ filename: "old_unliked.mp3", title: "Old", prompt: "old", styleId: "synthwave", announce: false }), createdAt: "2026-05-24T11:59:00.000Z" };
    const next = createRadioTrackRecord({ filename: "next.mp3", title: "Next", prompt: "next", styleId: "synthwave", announce: false });
    const state = { ...defaultRadioState(), currentTrack: oldUnliked, history: [oldUnliked, next] };

    const updated = removeRadioTracksFromLineup(state, [oldUnliked]);

    expect(updated.currentTrack?.filename).toBe("next.mp3");
    expect(updated.history.map((track) => track.filename)).toEqual(["next.mp3"]);
  });
});
