import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { createRadioTrackRecord, defaultRadioState } from "@/lib/radio";

const originalCwd = process.cwd();
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalElevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const originalDeepgramApiKey = process.env.DEEPGRAM_API_KEY;
const originalDeepgramShortApiKey = process.env.DG_API_KEY;
const originalParTtsConfigPath = process.env.PAR_TTS_CONFIG_PATH;
const originalRadioTtsModulePath = process.env.RADIO_TTS_MODULE_PATH;
const originalFfmpegPath = process.env.FFMPEG_PATH;
const originalPathEnv = process.env.PATH;
const originalRadioCodexTasteModel = process.env.RADIO_CODEX_TASTE_MODEL;
const originalStableAudioPython = process.env.STABLE_AUDIO_PYTHON;
const originalStableAudioMock = process.env.STABLE_AUDIO_MOCK;
const originalStableAudioTimeoutMs = process.env.STABLE_AUDIO_TIMEOUT_MS;
const originalRadioOllamaTimeoutMs = process.env.RADIO_OLLAMA_TIMEOUT_MS;
const originalRadioQueueAutoFill = process.env.RADIO_QUEUE_AUTO_FILL;
let tempCwd: string | undefined;
const icyMetaInterval = 24_000;

describe("radio stream route", () => {
  beforeEach(() => {
    process.env.RADIO_QUEUE_AUTO_FILL = "false";
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    if (originalElevenLabsApiKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalElevenLabsApiKey;
    if (originalDeepgramApiKey === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = originalDeepgramApiKey;
    if (originalDeepgramShortApiKey === undefined) delete process.env.DG_API_KEY;
    else process.env.DG_API_KEY = originalDeepgramShortApiKey;
    if (originalParTtsConfigPath === undefined) delete process.env.PAR_TTS_CONFIG_PATH;
    else process.env.PAR_TTS_CONFIG_PATH = originalParTtsConfigPath;
    if (originalRadioTtsModulePath === undefined) delete process.env.RADIO_TTS_MODULE_PATH;
    else process.env.RADIO_TTS_MODULE_PATH = originalRadioTtsModulePath;
    if (originalFfmpegPath === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = originalFfmpegPath;
    if (originalPathEnv === undefined) delete process.env.PATH;
    else process.env.PATH = originalPathEnv;
    if (originalRadioCodexTasteModel === undefined) delete process.env.RADIO_CODEX_TASTE_MODEL;
    else process.env.RADIO_CODEX_TASTE_MODEL = originalRadioCodexTasteModel;
    if (originalStableAudioPython === undefined) delete process.env.STABLE_AUDIO_PYTHON;
    else process.env.STABLE_AUDIO_PYTHON = originalStableAudioPython;
    if (originalStableAudioMock === undefined) delete process.env.STABLE_AUDIO_MOCK;
    else process.env.STABLE_AUDIO_MOCK = originalStableAudioMock;
    if (originalStableAudioTimeoutMs === undefined) delete process.env.STABLE_AUDIO_TIMEOUT_MS;
    else process.env.STABLE_AUDIO_TIMEOUT_MS = originalStableAudioTimeoutMs;
    if (originalRadioOllamaTimeoutMs === undefined) delete process.env.RADIO_OLLAMA_TIMEOUT_MS;
    else process.env.RADIO_OLLAMA_TIMEOUT_MS = originalRadioOllamaTimeoutMs;
    if (originalRadioQueueAutoFill === undefined) delete process.env.RADIO_QUEUE_AUTO_FILL;
    else process.env.RADIO_QUEUE_AUTO_FILL = originalRadioQueueAutoFill;
    if (tempCwd) {
      await rm(tempCwd, { recursive: true, force: true });
      tempCwd = undefined;
    }
  });

  it("opens a continuous audio stream even before the first mp3 is ready", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);

    const response = await GET(new NextRequest("http://localhost:3007/api/radio?stream=1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await response.body?.cancel();
  });

  it("registers a starred library mp3 as a marked fallback track", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.from("current"));
    await writeFile(path.join(outputDir, "keeper.mp3"), Buffer.from("keeper"));
    await writeFile(path.join(outputDir, "keeper.mp3.json"), JSON.stringify({
      favorite: true,
      title: "Starred Keeper",
      settings: { prompt: "favorite library prompt", duration: 42 },
    }));
    const current = createRadioTrackRecord({ filename: "current.mp3", title: "Current", prompt: "current", styleId: "synthwave", announce: false });
    await writeFile(stateFile, JSON.stringify({ ...defaultRadioState(), announceEnabled: false, currentTrack: current, history: [current] }, null, 2));

    const response = await POST(new NextRequest("http://localhost:3007/api/radio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "fallbackTrack", reason: "queue_refill_timeout" }),
    }));
    const json = await response.json() as {
      ok: boolean;
      fallbackTrack?: { filename?: string; source?: string; fallbackReason?: string; prompt?: string; durationSeconds?: number };
      state?: { history?: Array<{ filename?: string; source?: string; fallbackReason?: string }> };
    };
    const saved = JSON.parse(await readFile(stateFile, "utf8")) as { history?: Array<{ filename?: string; source?: string; fallbackReason?: string }> };
    const metadata = JSON.parse(await readFile(path.join(outputDir, "keeper.mp3.json"), "utf8")) as { radio?: { source?: string; fallbackReason?: string } };

    expect(json.ok).toBe(true);
    expect(json.fallbackTrack).toMatchObject({
      filename: "keeper.mp3",
      source: "library-fallback",
      fallbackReason: "queue_refill_timeout",
      prompt: "favorite library prompt",
      durationSeconds: 42,
    });
    expect(json.state?.history?.map((track) => track.filename)).toEqual(["current.mp3", "keeper.mp3"]);
    expect(saved.history?.at(-1)).toMatchObject({ filename: "keeper.mp3", source: "library-fallback", fallbackReason: "queue_refill_timeout" });
    expect(metadata.radio).toMatchObject({ source: "library-fallback", fallbackReason: "queue_refill_timeout" });
  });

  it("fills the radio queue from the server when the state endpoint is polled", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const scriptsDir = path.join(tempCwd, "scripts");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(scriptsDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(scriptsDir, "generate_audio.py"), `
const fs = require("node:fs");
const outIndex = process.argv.indexOf("--out");
fs.writeFileSync(process.argv[outIndex + 1], Buffer.from("ID3 server queue audio"));
`);
    const current = createRadioTrackRecord({ filename: "current.mp3", title: "Current", prompt: "current", styleId: "synthwave", announce: false });
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.from("current"));
    await writeFile(stateFile, JSON.stringify({ ...defaultRadioState(), announceEnabled: false, currentTrack: current, history: [current] }, null, 2));
    process.env.STABLE_AUDIO_PYTHON = process.execPath;
    process.env.RADIO_OLLAMA_TIMEOUT_MS = "1";
    process.env.RADIO_QUEUE_AUTO_FILL = "true";

    const response = await GET(new NextRequest("http://localhost:3007/api/radio"));
    const json = await response.json() as { ok: boolean; state?: { queueAheadCount?: number } };
    const saved = await waitForRadioState(stateFile, (state) => state.queueAheadCount === 3);

    expect(json.ok).toBe(true);
    expect(json.state?.queueAheadCount).toBe(0);
    expect(saved.history.map((track) => track.filename)).toHaveLength(4);
    expect(saved.history.slice(1).every((track) => track.styleId === "synthwave")).toBe(true);
    expect(saved.history.slice(1).every((track) => track.promptProvider === "fallback")).toBe(true);
  });

  it("streams a starred library fallback when the lineup has no current mp3", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "keeper.mp3"), Buffer.from("fallback-audio"));
    await writeFile(path.join(outputDir, "keeper.mp3.json"), JSON.stringify({
      favorite: true,
      title: "Starred Keeper",
      settings: { prompt: "favorite library prompt", duration: 42 },
    }));
    await writeFile(stateFile, JSON.stringify({ ...defaultRadioState(), announceEnabled: false }, null, 2));

    const response = await GET(new NextRequest("http://localhost:3007/api/radio?stream=1"));
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader!.read();
    const saved = JSON.parse(await readFile(stateFile, "utf8")) as { currentTrack?: { filename?: string; source?: string } };

    expect(Buffer.from(first.value ?? []).toString()).toBe("fallback-audio");
    expect(saved.currentTrack).toMatchObject({ filename: "keeper.mp3", source: "library-fallback" });
    await reader!.cancel();
  }, 5000);

  it("deletes an unrated radio queue track audio, announcement, and metadata", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.from("current"));
    await writeFile(path.join(outputDir, "next.mp3"), Buffer.from("next"));
    await writeFile(path.join(outputDir, "radio_announce_current.mp3"), Buffer.from("announce"));
    await writeFile(path.join(outputDir, "current.mp3.json"), JSON.stringify({
      title: "Current",
      radio: { announcementFilename: "radio_announce_current.mp3" },
    }));
    const current = createRadioTrackRecord({ filename: "current.mp3", title: "Current", prompt: "current", styleId: "synthwave", announce: false });
    const next = createRadioTrackRecord({ filename: "next.mp3", title: "Next", prompt: "next", styleId: "synthwave", announce: false });
    await writeFile(stateFile, JSON.stringify({ ...defaultRadioState(), currentTrack: current, history: [current, next] }, null, 2));

    const response = await POST(new NextRequest("http://localhost:3007/api/radio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "deleteTrack", filename: "current.mp3" }),
    }));
    const json = await response.json() as { ok: boolean; deletedTrack?: { filename?: string }; state?: { currentTrack?: { filename?: string }; history?: Array<{ filename?: string }> } };

    expect(json.ok).toBe(true);
    expect(json.deletedTrack?.filename).toBe("current.mp3");
    expect(json.state?.currentTrack?.filename).toBe("next.mp3");
    expect(json.state?.history?.map((track) => track.filename)).toEqual(["next.mp3"]);
    await expect(readFile(path.join(outputDir, "current.mp3"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(outputDir, "radio_announce_current.mp3"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(outputDir, "current.mp3.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps feedback metadata when deleting a rated radio queue track", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.from("current"));
    await writeFile(path.join(outputDir, "liked.mp3"), Buffer.from("liked"));
    await writeFile(path.join(outputDir, "liked.mp3.json"), JSON.stringify({ title: "Liked" }));
    const current = createRadioTrackRecord({ filename: "current.mp3", title: "Current", prompt: "current", styleId: "synthwave", announce: false });
    const liked = { ...createRadioTrackRecord({ filename: "liked.mp3", title: "Liked", prompt: "liked", styleId: "synthwave", announce: false }), rating: "up" as const };
    await writeFile(stateFile, JSON.stringify({ ...defaultRadioState(), currentTrack: current, history: [current, liked] }, null, 2));

    const response = await POST(new NextRequest("http://localhost:3007/api/radio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "deleteTrack", filename: "liked.mp3" }),
    }));
    const json = await response.json() as { ok: boolean; state?: { history?: Array<{ filename?: string }> } };
    const metadata = JSON.parse(await readFile(path.join(outputDir, "liked.mp3.json"), "utf8")) as { radio?: { removalReason?: string; deletedAt?: string; removedAudioFilename?: string } };

    expect(json.ok).toBe(true);
    expect(json.state?.history?.map((track) => track.filename)).toEqual(["current.mp3"]);
    await expect(readFile(path.join(outputDir, "liked.mp3"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(metadata.radio).toMatchObject({ removalReason: "manual_delete", removedAudioFilename: "liked.mp3" });
    expect(typeof metadata.radio?.deletedAt).toBe("string");
  });

  it("keeps feedback metadata when shared preferences record thumbs feedback", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.from("current"));
    await writeFile(path.join(outputDir, "shared_feedback.mp3"), Buffer.from("liked"));
    await writeFile(path.join(outputDir, "shared_feedback.mp3.json"), JSON.stringify({ title: "Shared Feedback" }));
    const current = createRadioTrackRecord({ filename: "current.mp3", title: "Current", prompt: "current", styleId: "synthwave", announce: false });
    const sharedFeedback = createRadioTrackRecord({ filename: "shared_feedback.mp3", title: "Shared Feedback", prompt: "shared prompt", styleId: "synthwave", announce: false });
    await writeFile(stateFile, JSON.stringify({
      ...defaultRadioState(),
      currentTrack: current,
      history: [current, sharedFeedback],
      preferences: { synthwave: { likes: [], dislikes: [sharedFeedback.prompt] } },
    }, null, 2));

    const response = await POST(new NextRequest("http://localhost:3007/api/radio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "deleteTrack", filename: "shared_feedback.mp3" }),
    }));
    const json = await response.json() as { ok: boolean; state?: { history?: Array<{ filename?: string }> } };
    const metadata = JSON.parse(await readFile(path.join(outputDir, "shared_feedback.mp3.json"), "utf8")) as { radio?: { removalReason?: string; removedAudioFilename?: string } };

    expect(json.ok).toBe(true);
    expect(json.state?.history?.map((track) => track.filename)).toEqual(["current.mp3"]);
    await expect(readFile(path.join(outputDir, "shared_feedback.mp3"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(metadata.radio).toMatchObject({ removalReason: "manual_delete", removedAudioFilename: "shared_feedback.mp3" });
  });

  it("keeps duplicate-titled queued songs while the queue is still under target", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.from("current"));
    await writeFile(path.join(outputDir, "duplicate_next.mp3"), Buffer.from("next"));
    const current = createRadioTrackRecord({ filename: "current.mp3", title: "Repeated Title", prompt: "current", styleId: "synthwave", announce: false });
    const duplicateNext = createRadioTrackRecord({ filename: "duplicate_next.mp3", title: "Repeated Title", prompt: "next", styleId: "synthwave", announce: false });
    await writeFile(stateFile, JSON.stringify({ ...defaultRadioState(), currentTrack: current, history: [current, duplicateNext] }, null, 2));

    const response = await POST(new NextRequest("http://localhost:3007/api/radio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cleanup" }),
    }));
    const json = await response.json() as { ok: boolean; cleanedTracks?: Array<{ filename?: string }>; state?: { history?: Array<{ filename?: string }>; queueAheadCount?: number } };

    expect(json.ok).toBe(true);
    expect(json.cleanedTracks).toEqual([]);
    expect(json.state?.queueAheadCount).toBe(1);
    expect(json.state?.history?.map((track) => track.filename)).toEqual(["current.mp3", "duplicate_next.mp3"]);
    await expect(readFile(path.join(outputDir, "duplicate_next.mp3"))).resolves.toBeTruthy();
  });

  it("streams the current track for the requested style query", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "synth_current.mp3"), Buffer.from("synth-audio"));
    await writeFile(path.join(outputDir, "ambient_current.mp3"), Buffer.from("ambient-audio"));
    const synthCurrent = createRadioTrackRecord({ filename: "synth_current.mp3", title: "Synth Current", prompt: "synth", styleId: "synthwave", announce: false });
    const ambientCurrent = createRadioTrackRecord({ filename: "ambient_current.mp3", title: "Ambient Current", prompt: "ambient", styleId: "ambient", announce: false });
    await writeFile(stateFile, JSON.stringify({
      ...defaultRadioState(),
      announceEnabled: false,
      selectedStyleId: "synthwave",
      currentTrack: synthCurrent,
      currentTrackByStyle: {
        synthwave: synthCurrent.filename,
        ambient: ambientCurrent.filename,
      },
      history: [synthCurrent, ambientCurrent],
    }, null, 2));

    const response = await GET(new NextRequest("http://localhost:3007/api/radio?stream=1&style=ambient"));
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader!.read();

    expect(Buffer.from(first.value ?? []).toString()).toBe("ambient-audio");
    await reader!.cancel();
  }, 5000);

  it("serves TuneIn-friendly m3u and pls playlist files without changing the stream URL", async () => {
    const m3uResponse = await GET(new NextRequest("https://radio.pardev.net/api/radio?playlist=m3u", {
      headers: { host: "radio.pardev.net", "x-forwarded-proto": "https" },
    }));
    const plsResponse = await GET(new NextRequest("http://192.168.1.50:3007/api/radio?playlist=pls", {
      headers: { host: "192.168.1.50:3007", "x-forwarded-proto": "http" },
    }));

    expect(m3uResponse.headers.get("content-type")).toBe("audio/x-mpegurl; charset=utf-8");
    expect(await m3uResponse.text()).toContain("https://radio.pardev.net/api/radio?stream=1&icy=1");
    expect(plsResponse.headers.get("content-type")).toBe("audio/x-scpls; charset=utf-8");
    expect(await plsResponse.text()).toContain("File1=http://192.168.1.50:3007/api/radio?stream=1&icy=1");
  });

  it("distills thumbs into the rated style taste profile with Codex CLI gpt-5.5", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    const codexPath = path.join(tempCwd, "codex");
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(codexPath, `#!/bin/sh
printf '%s\\n' "$@" > codex-args.txt
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    out="$1"
  fi
  shift || true
done
cat > codex-stdin.txt
printf '%s' '{"likedTraits":["wide neon pads"],"dislikedTraits":["thin supersaw leads"],"promptDirectives":["write a stronger B section"],"negativePromptDirectives":["avoid brittle fizz"],"explorationNotes":["try outrun bass movement"]}' > "$out"
`);
    await chmod(codexPath, 0o755);
    process.env.PATH = `${tempCwd}:${originalPathEnv ?? ""}`;
    const current = createRadioTrackRecord({
      filename: "liked.mp3",
      title: "Liked",
      prompt: "warm bass with wide neon pads",
      styleId: "synthwave",
      announce: false,
    });
    await writeFile(stateFile, JSON.stringify({
      ...defaultRadioState(),
      currentTrack: current,
      history: [current],
      preferences: {
        ambient: { likes: ["granular cloud drift"], dislikes: [] },
      },
    }, null, 2));

    const response = await POST(new NextRequest("http://localhost:3007/api/radio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "rating", rating: "up", styleId: "synthwave", phrase: current.prompt }),
    }));
    const json = await response.json() as { ok: boolean };
    const saved = JSON.parse(await readFile(stateFile, "utf8")) as {
      preferences?: {
        synthwave?: { tasteProfile?: { likedTraits?: string[]; model?: string; provider?: string } };
        ambient?: { likes?: string[]; tasteProfile?: unknown };
      };
    };
    const args = await readFile(path.join(tempCwd, "codex-args.txt"), "utf8");
    const stdin = await readFile(path.join(tempCwd, "codex-stdin.txt"), "utf8");

    expect(json.ok).toBe(true);
    expect(args).toContain("-m\ngpt-5.5");
    expect(stdin).toContain("Style: Synthwave Night Drive");
    expect(stdin).toContain("warm bass with wide neon pads");
    expect(stdin).not.toContain("granular cloud drift");
    expect(saved.preferences?.synthwave?.tasteProfile).toMatchObject({
      likedTraits: ["wide neon pads"],
      model: "gpt-5.5",
      provider: "codex-cli",
    });
    expect(saved.preferences?.ambient).toEqual({ likes: ["granular cloud drift"], dislikes: [] });
  });

  it("switches an open stream to the selected current track after a skip", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.alloc(48_000, "a"));
    await writeFile(path.join(outputDir, "next.mp3"), Buffer.alloc(48_000, "b"));
    const current = createRadioTrackRecord({ filename: "current.mp3", title: "Current", prompt: "current", styleId: "synthwave", announce: false });
    const next = createRadioTrackRecord({ filename: "next.mp3", title: "Next", prompt: "next", styleId: "synthwave", announce: false });
    const state = { ...defaultRadioState(), announceEnabled: false };
    await writeFile(stateFile, JSON.stringify({ ...state, currentTrack: current, history: [current, next] }, null, 2));

    const response = await GET(new NextRequest("http://localhost:3007/api/radio?stream=1"));
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader!.read();
    expect(first.value?.[0]).toBe("a".charCodeAt(0));

    await writeFile(stateFile, JSON.stringify({ ...state, currentTrack: next, history: [next] }, null, 2));
    const second = await reader!.read();

    expect(second.value?.[0]).toBe("b".charCodeAt(0));
    await reader!.cancel();
  }, 5000);

  it("strips ID3 tags before streaming MP3 frame bytes", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.from([
      0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04,
      0x74, 0x61, 0x67, 0x21,
      0xff, 0xfb, 0x90, 0x64,
    ]));
    const current = createRadioTrackRecord({ filename: "current.mp3", title: "Current", prompt: "current", styleId: "synthwave", announce: false });
    const state = { ...defaultRadioState(), announceEnabled: false, currentTrack: current, history: [current] };
    await writeFile(stateFile, JSON.stringify(state, null, 2));

    const response = await GET(new NextRequest("http://localhost:3007/api/radio?stream=1"));
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader!.read();

    expect([...first.value!.slice(0, 4)]).toEqual([0xff, 0xfb, 0x90, 0x64]);
    await reader!.cancel();
  }, 5000);

  it("skips the announcement segment for browser song playback and advances after the song bytes", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "radio_announce_current.mp3"), Buffer.from("announcement"));
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.from("song"));
    await writeFile(path.join(outputDir, "next.mp3"), Buffer.from("next"));
    const current = createRadioTrackRecord({
      filename: "current.mp3",
      title: "Current",
      prompt: "current",
      styleId: "synthwave",
      announce: true,
      announcementFilename: "radio_announce_current.mp3",
    });
    const next = createRadioTrackRecord({ filename: "next.mp3", title: "Next", prompt: "next", styleId: "synthwave", announce: false });
    const state = { ...defaultRadioState(), currentTrack: current, history: [current, next] };
    await writeFile(stateFile, JSON.stringify(state, null, 2));

    const response = await GET(new NextRequest("http://localhost:3007/api/radio?stream=1&skipAnnouncement=1"));
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader!.read();
    const savedState = JSON.parse(await readFile(stateFile, "utf8")) as { currentTrack?: { filename?: string } };

    expect(Buffer.from(first.value ?? []).toString()).toBe("song");
    expect(savedState.currentTrack?.filename).toBe("next.mp3");
    await reader!.cancel();
  }, 5000);

  it("skips existing announcement audio when announcements are disabled", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "radio_announce_current.mp3"), Buffer.from("announcement"));
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.from("song"));
    const current = createRadioTrackRecord({
      filename: "current.mp3",
      title: "Current",
      prompt: "current",
      styleId: "synthwave",
      announce: true,
      announcementFilename: "radio_announce_current.mp3",
    });
    const state = { ...defaultRadioState(), announceEnabled: false, currentTrack: current, history: [current] };
    await writeFile(stateFile, JSON.stringify(state, null, 2));

    const response = await GET(new NextRequest("http://localhost:3007/api/radio?stream=1"));
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader!.read();

    expect(Buffer.from(first.value ?? []).toString()).toBe("song");
    await reader!.cancel();
  }, 5000);

  it("sends changing ICY now-playing metadata when clients opt in", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.alloc(icyMetaInterval, "a"));
    await writeFile(path.join(outputDir, "next.mp3"), Buffer.alloc(icyMetaInterval, "b"));
    const current = createRadioTrackRecord({ filename: "current.mp3", title: "Current Signal", prompt: "current", styleId: "synthwave", announce: false });
    const next = createRadioTrackRecord({ filename: "next.mp3", title: "Next Signal", prompt: "next", styleId: "synthwave", announce: false });
    const state = { ...defaultRadioState(), announceEnabled: false, currentTrack: current, history: [current, next] };
    await writeFile(stateFile, JSON.stringify(state, null, 2));

    const response = await GET(new NextRequest("http://localhost:3007/api/radio?stream=1", {
      headers: { "Icy-MetaData": "1" },
    }));
    const reader = response.body?.getReader();
    expect(response.headers.get("icy-metaint")).toBe(String(icyMetaInterval));
    expect(reader).toBeTruthy();

    const first = await reader!.read();
    expect(first.value?.[0]).toBe("a".charCodeAt(0));
    expect(decodeIcyMetadata(first.value)).toContain("StreamTitle='Current Signal';");

    const second = await reader!.read();
    expect(second.value?.[0]).toBe("b".charCodeAt(0));
    expect(decodeIcyMetadata(second.value)).toContain("StreamTitle='Next Signal';");
    await reader!.cancel();
  }, 5000);

  it("keeps spoken announcement audio for ICY radio clients by default", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "radio_announce_current.mp3"), Buffer.concat([Buffer.from("ID3"), Buffer.alloc(icyMetaInterval - 3, "a")]));
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.alloc(icyMetaInterval, "s"));
    await writeFile(path.join(outputDir, "current.mp3.json"), JSON.stringify({
      radio: { announcementFilename: "radio_announce_current.mp3" },
    }));
    const current = createRadioTrackRecord({
      filename: "current.mp3",
      title: "Current Signal",
      prompt: "current",
      styleId: "synthwave",
      announce: true,
      announcementFilename: "radio_announce_current.mp3",
    });
    const state = { ...defaultRadioState(), currentTrack: current, history: [current] };
    await writeFile(stateFile, JSON.stringify(state, null, 2));

    const response = await GET(new NextRequest("http://localhost:3007/api/radio?stream=1", {
      headers: { "Icy-MetaData": "1" },
    }));
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();

    const first = await reader!.read();

    expect(first.value?.[0]).toBe(0xff);
    expect(decodeIcyMetadata(first.value)).toContain("StreamTitle='Current Signal';");
    await reader!.cancel();
  }, 5000);

  it("repairs WAV announcement files before placing them in the MP3 stream", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    const ffmpegPath = path.join(tempCwd, "mock-ffmpeg.sh");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(ffmpegPath, "#!/bin/sh\ncat >/dev/null\nprintf ID3converted-announcement\n");
    await chmod(ffmpegPath, 0o755);
    process.env.FFMPEG_PATH = ffmpegPath;
    await writeFile(path.join(outputDir, "radio_announce_current.mp3"), Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.from("wav-body")]));
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.from("ID3song"));
    await writeFile(path.join(outputDir, "current.mp3.json"), JSON.stringify({
      radio: { announcementFilename: "radio_announce_current.mp3" },
    }));
    const current = createRadioTrackRecord({
      filename: "current.mp3",
      title: "Current Signal",
      prompt: "current",
      styleId: "synthwave",
      announce: true,
      announcementFilename: "radio_announce_current.mp3",
    });
    const state = { ...defaultRadioState(), currentTrack: current, history: [current] };
    await writeFile(stateFile, JSON.stringify(state, null, 2));

    const response = await GET(new NextRequest("http://localhost:3007/api/radio?stream=1"));
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();

    const first = await reader!.read();
    const repaired = await readFile(path.join(outputDir, "radio_announce_current.mp3"));

    expect(Buffer.from(first.value ?? []).toString()).toBe("ID3converted-announcement");
    expect(repaired.toString()).toBe("ID3converted-announcement");
    await reader!.cancel();
  }, 5000);

  it("can use ICY metadata instead of inline announcement audio for metadata-only clients", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "radio_announce_current.mp3"), Buffer.from("announcement"));
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.alloc(icyMetaInterval, "s"));
    const current = createRadioTrackRecord({
      filename: "current.mp3",
      title: "Current Signal",
      prompt: "current",
      styleId: "synthwave",
      announce: true,
      announcementFilename: "radio_announce_current.mp3",
    });
    const state = { ...defaultRadioState(), currentTrack: current, history: [current] };
    await writeFile(stateFile, JSON.stringify(state, null, 2));

    const response = await GET(new NextRequest("http://localhost:3007/api/radio?stream=1&metadataOnly=1", {
      headers: { "Icy-MetaData": "1" },
    }));
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();

    const first = await reader!.read();

    expect(first.value?.[0]).toBe("s".charCodeAt(0));
    expect(Buffer.from(first.value ?? []).toString()).not.toContain("announcement");
    expect(decodeIcyMetadata(first.value)).toContain("StreamTitle='Current Signal';");
    await reader!.cancel();
  }, 5000);

  it("forces ICY metadata from the stream URL for TuneIn custom streams", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(path.join(outputDir, "radio_announce_current.mp3"), Buffer.from("announcement"));
    await writeFile(path.join(outputDir, "current.mp3"), Buffer.alloc(icyMetaInterval, "s"));
    const current = createRadioTrackRecord({
      filename: "current.mp3",
      title: "Current Signal",
      prompt: "current",
      styleId: "synthwave",
      announce: true,
      announcementFilename: "radio_announce_current.mp3",
    });
    const state = { ...defaultRadioState(), currentTrack: current, history: [current] };
    await writeFile(stateFile, JSON.stringify(state, null, 2));

    const response = await GET(new NextRequest("http://localhost:3007/api/radio?stream=1&icy=1"));
    const reader = response.body?.getReader();
    expect(response.headers.get("icy-metaint")).toBe(String(icyMetaInterval));
    expect(reader).toBeTruthy();

    const first = await reader!.read();

    expect(first.value?.[0]).toBe("s".charCodeAt(0));
    expect(Buffer.from(first.value ?? []).toString()).not.toContain("announcement");
    expect(decodeIcyMetadata(first.value)).toContain("StreamTitle='Current Signal';");
    await reader!.cancel();
  }, 5000);

  it("generates a playable test voice mp3 with the selected TTS settings", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const modulePath = path.join(tempCwd, "mock-tts.cjs");
    const ffmpegPath = path.join(tempCwd, "mock-ffmpeg.sh");
    await mkdir(outputDir, { recursive: true });
    await writeFile(ffmpegPath, "#!/bin/sh\ncat\n");
    await chmod(ffmpegPath, 0o755);
    await writeFile(modulePath, `
      exports.createSpeechPipeline = (config) => ({
        synthesize: async (text, request) => ({
          audio: Buffer.from(JSON.stringify({ config, request, text }))
        })
      });
      exports.collectAudio = async (audio) => audio;
    `);
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.RADIO_TTS_MODULE_PATH = modulePath;
    process.env.FFMPEG_PATH = ffmpegPath;

    const response = await POST(new NextRequest("http://localhost:3007/api/radio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "testVoice",
        ttsProvider: "openai",
        ttsVoice: "alloy",
        announcementPrefix: "Testing ",
        announcementSuffix: " now.",
      }),
    }));
    const json = await response.json() as { ok: boolean; audioUrl?: string };

    expect(json.ok).toBe(true);
    expect(json.audioUrl).toMatch(/^\/outputs\/radio_voice_test_.*\.mp3$/);
    const saved = await readFile(path.join(tempCwd, "public", json.audioUrl!));
    const payload = JSON.parse(saved.toString()) as { config: { provider: string; voice: string }; request: { voice: string }; text: string };
    expect(payload.config.provider).toBe("openai");
    expect(payload.config.voice).toBe("alloy");
    expect(payload.request.voice).toBe("alloy");
    expect(payload.text).toBe("Testing Voice test now.");
  });

  it("uses par-tts config API keys as the TTS source of truth", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const modulePath = path.join(tempCwd, "mock-tts.cjs");
    const configPath = path.join(tempCwd, "par-tts-config.yaml");
    const ffmpegPath = path.join(tempCwd, "mock-ffmpeg.sh");
    await mkdir(outputDir, { recursive: true });
    await writeFile(configPath, "deepgram_api_key: \"test-deepgram-config-key\"\n");
    await writeFile(ffmpegPath, "#!/bin/sh\ncat\n");
    await chmod(ffmpegPath, 0o755);
    await writeFile(modulePath, `
      exports.createSpeechPipeline = (config) => ({
        synthesize: async (text, request) => ({
          audio: Buffer.from(JSON.stringify({ config, request, text }))
        })
      });
      exports.collectAudio = async (audio) => audio;
    `);
    process.env.DEEPGRAM_API_KEY = "test-deepgram-env-key";
    delete process.env.DG_API_KEY;
    process.env.PAR_TTS_CONFIG_PATH = configPath;
    process.env.RADIO_TTS_MODULE_PATH = modulePath;
    process.env.FFMPEG_PATH = ffmpegPath;

    const response = await POST(new NextRequest("http://localhost:3007/api/radio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "testVoice",
        ttsProvider: "deepgram",
        ttsVoice: "aura-2-thalia-en",
      }),
    }));
    const json = await response.json() as { ok: boolean; audioUrl?: string };

    expect(json.ok).toBe(true);
    const saved = await readFile(path.join(tempCwd, "public", json.audioUrl!));
    const payload = JSON.parse(saved.toString()) as { config: { provider: string; apiKey: string; voice: string } };
    expect(payload.config.provider).toBe("deepgram");
    expect(payload.config.apiKey).toBe("test-deepgram-config-key");
    expect(payload.config.voice).toBe("aura-2-thalia-en");
  });

  it("lists account voices for providers that support dynamic voice catalogs", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const modulePath = path.join(tempCwd, "mock-tts.cjs");
    await writeFile(modulePath, `
      exports.createSpeechPipeline = (config) => ({
        listVoices: async () => [
          { id: "voice-alpha", name: "Alpha", labels: ["warm"], category: "premade" },
          { id: "voice-beta", name: "Beta", labels: ["bright"], category: "generated" }
        ],
        synthesize: async () => ({ audio: Buffer.from("ok") })
      });
      exports.collectAudio = async (audio) => audio;
    `);
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
    process.env.RADIO_TTS_MODULE_PATH = modulePath;

    const response = await POST(new NextRequest("http://localhost:3007/api/radio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "ttsVoices",
        ttsProvider: "elevenlabs",
        ttsVoice: "voice-alpha",
      }),
    }));
    const json = await response.json() as { ok: boolean; voices?: Array<{ id: string; label: string; description?: string }> };

    expect(json.ok).toBe(true);
    expect(json.voices).toEqual([
      { id: "voice-alpha", label: "Alpha", description: "warm" },
      { id: "voice-beta", label: "Beta", description: "bright" },
    ]);
  });

  it("restores the persisted current track for the configured music style", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(path.dirname(stateFile), { recursive: true });
    const synthCurrent = createRadioTrackRecord({ filename: "synth_current.mp3", title: "Synth Current", prompt: "synth", styleId: "synthwave", announce: false });
    const ambientCurrent = createRadioTrackRecord({ filename: "ambient_current.mp3", title: "Ambient Current", prompt: "ambient", styleId: "ambient", announce: false });
    const ambientNext = createRadioTrackRecord({ filename: "ambient_next.mp3", title: "Ambient Next", prompt: "ambient next", styleId: "ambient", announce: false });
    await writeFile(stateFile, JSON.stringify({
      ...defaultRadioState(),
      selectedStyleId: "synthwave",
      currentTrack: synthCurrent,
      currentTrackByStyle: {
        synthwave: synthCurrent.filename,
        ambient: ambientCurrent.filename,
      },
      history: [synthCurrent, ambientCurrent, ambientNext],
    }, null, 2));

    const response = await POST(new NextRequest("http://localhost:3007/api/radio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "configure", styleId: "ambient" }),
    }));
    const json = await response.json() as { ok: boolean; state?: { currentTrack?: { filename?: string }; queueAheadCount?: number } };
    const saved = JSON.parse(await readFile(stateFile, "utf8")) as { currentTrack?: { filename?: string } };

    expect(json.ok).toBe(true);
    expect(json.state?.currentTrack?.filename).toBe("ambient_current.mp3");
    expect(json.state?.queueAheadCount).toBe(1);
    expect(saved.currentTrack?.filename).toBe("ambient_current.mp3");
  });

  it("skips to the next track without recording thumbs-down feedback", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(path.dirname(stateFile), { recursive: true });
    const current = createRadioTrackRecord({ filename: "current.mp3", title: "Current", prompt: "current prompt", styleId: "synthwave", announce: false });
    const next = createRadioTrackRecord({ filename: "next.mp3", title: "Next", prompt: "next prompt", styleId: "synthwave", announce: false });
    await writeFile(stateFile, JSON.stringify({
      ...defaultRadioState(),
      currentTrack: current,
      history: [current, next],
      preferences: { synthwave: { likes: [], dislikes: [] } },
    }, null, 2));

    const response = await POST(new NextRequest("http://localhost:3007/api/radio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "skipTrack" }),
    }));
    const json = await response.json() as { ok: boolean; skippedTrack?: { filename?: string }; state?: { currentTrack?: { filename?: string }; history?: Array<{ filename?: string }>; preferences?: { synthwave?: { dislikes?: string[] } } } };
    const saved = JSON.parse(await readFile(stateFile, "utf8")) as { currentTrack?: { filename?: string }; history?: Array<{ filename?: string; rating?: string }>; preferences?: { synthwave?: { dislikes?: string[] } } };

    expect(json.ok).toBe(true);
    expect(json.skippedTrack?.filename).toBe("current.mp3");
    expect(json.state?.currentTrack?.filename).toBe("next.mp3");
    expect(json.state?.history?.map((track) => track.filename)).toEqual(["current.mp3", "next.mp3"]);
    expect(json.state?.preferences?.synthwave?.dislikes).toEqual([]);
    expect(saved.currentTrack?.filename).toBe("next.mp3");
    expect(saved.history?.map((track) => track.filename)).toEqual(["current.mp3", "next.mp3"]);
    expect(saved.history?.some((track) => track.rating === "down")).toBe(false);
    expect(saved.preferences?.synthwave?.dislikes).toEqual([]);
  });

  it("persists configured radio song length in whole minutes", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-radio-"));
    process.chdir(tempCwd);
    const stateFile = path.join(tempCwd, ".stable-audio-radio", "state.json");
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify(defaultRadioState(), null, 2));

    const response = await POST(new NextRequest("http://localhost:3007/api/radio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "configure", songLengthMinutes: 5 }),
    }));
    const json = await response.json() as { ok: boolean; state?: { songLengthMinutes?: number } };
    const saved = JSON.parse(await readFile(stateFile, "utf8")) as { songLengthMinutes?: number };

    expect(json.ok).toBe(true);
    expect(json.state?.songLengthMinutes).toBe(5);
    expect(saved.songLengthMinutes).toBe(5);
  });
});

type RadioStateTestSnapshot = { queueAheadCount?: number; history: Array<{ filename: string; styleId?: string; promptProvider?: string }> };

async function waitForRadioState(stateFile: string, predicate: (state: RadioStateTestSnapshot) => boolean): Promise<RadioStateTestSnapshot> {
  const deadline = Date.now() + 2_000;
  let lastState: RadioStateTestSnapshot = JSON.parse(await readFile(stateFile, "utf8"));
  while (Date.now() < deadline) {
    try {
      lastState = JSON.parse(await readFile(stateFile, "utf8"));
      if (predicate(lastState)) return lastState;
    } catch {
      // The route writes state.json directly; retry if the poll lands mid-write.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Radio state did not match before timeout: ${JSON.stringify(lastState)}`);
}

function decodeIcyMetadata(chunk: Uint8Array | undefined) {
  if (!chunk) return "";
  const lengthByte = chunk[icyMetaInterval];
  const metadataLength = lengthByte * 16;
  return Buffer.from(chunk.slice(icyMetaInterval + 1, icyMetaInterval + 1 + metadataLength)).toString("utf8").replace(/\0+$/, "");
}
