// Multi-provider TTS synthesis pipeline for the radio station.
//
// Owns: announcement generation (`createAnnouncementIfEnabled`), the voice-test
// endpoint helper (`createTestVoiceAudio`), provider dispatch, the
// `loadTtsModule` / `resolveRadioTtsModulePath` resolution, MP3 transcoding,
// and the provider API-key fallback chain (process env → par-tts config →
// `~/.claude/.env`). Extracted verbatim from `app/api/radio/route.ts`;
// behavior is unchanged.
//
// The TTS module is loaded via `createRequire` from `RADIO_TTS_MODULE_PATH`
// (or `RADIO_TTS_NODE_MODULE_PATH` for kokoro). API-key resolution in
// `readLocalEnvApiKey` is preserved exactly — it is the `~/.claude/.env`
// fallback flagged for manual review by SEC-006 and is NOT changed here.

import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import {
  buildAnnouncementText,
  buildRadioAnnouncementFilename,
  getRadioTtsVoiceOptions,
  readRadioConfigFileValue,
  readRadioEnvFileValue,
  resolveRadioAnnouncementFilename,
  type RadioState,
  type RadioTrackRecord,
  type RadioTtsVoiceOption,
} from "@/lib/radio";
import { metadataPathForAudio, outputPathForAudio } from "@/lib/library";

type TtsModule = {
  createSpeechPipeline: (config: { provider: string; apiKey?: string; model?: string; voice?: string; options?: Record<string, unknown> }) => TtsPipeline;
  createSpeechPipelineFromEnv?: (config: { provider: string; apiKey?: string; model?: string; voice?: string; options?: Record<string, unknown> }) => TtsPipeline;
  collectAudio: (audio: Uint8Array | ReadableStream<Uint8Array>) => Promise<Uint8Array>;
};

type TtsPipeline = {
  synthesize: (text: string, request?: { voice?: string; model?: string; options?: Record<string, unknown> }) => Promise<{ audio: Uint8Array | ReadableStream<Uint8Array> }>;
  listVoices?: () => Promise<Array<{ id: string; name?: string; labels?: string[]; category?: string }>>;
};

const outputDir = () => path.join(process.cwd(), "public", "outputs");

export async function createAnnouncementIfEnabled(track: RadioTrackRecord, state: RadioState) {
  if (!track.announce) return undefined;
  const model = process.env.RADIO_TTS_MODEL;
  const previousAnnouncementFilename = await existingTrackAnnouncementFilename(track);
  if (previousAnnouncementFilename && await ensureMp3File(outputPathForAudio(outputDir(), previousAnnouncementFilename))) return previousAnnouncementFilename;
  const filename = buildRadioAnnouncementFilename(track, { ...state, ttsModel: model });
  const finalPath = outputPathForAudio(outputDir(), filename);
  if (await ensureMp3File(finalPath)) return filename;
  try {
    const bytes = await synthesizeTtsMp3(buildAnnouncementText(track.title, state), state);
    await mkdir(outputDir(), { recursive: true });
    await writeFile(finalPath, Buffer.from(bytes));
    return filename;
  } catch {
    return undefined;
  }
}

export async function createTestVoiceAudio(state: RadioState) {
  const filename = `radio_voice_test_${Date.now()}.mp3`;
  const finalPath = outputPathForAudio(outputDir(), filename);
  const bytes = await synthesizeTtsMp3(buildAnnouncementText("Voice test", state), state);
  await mkdir(outputDir(), { recursive: true });
  await writeFile(finalPath, Buffer.from(bytes));
  return `/outputs/${filename}`;
}

async function synthesizeTtsMp3(text: string, state: RadioState) {
  const model = process.env.RADIO_TTS_MODEL;
  const apiKey = await providerApiKey(state.ttsProvider);
  if (!apiKey && !isKokoroTtsProvider(state.ttsProvider)) throw new Error(`Missing API key for ${state.ttsProvider} TTS`);
  const modulePath = resolveRadioTtsModulePath(state.ttsProvider);
  if (!modulePath) {
    const envVar = isKokoroTtsProvider(state.ttsProvider) ? "RADIO_TTS_NODE_MODULE_PATH" : "RADIO_TTS_MODULE_PATH";
    const message = `Radio TTS is not configured: set ${envVar} to the par-tts-core-ts module entry (e.g. /path/to/par-tts-core-ts/dist/index.cjs).`;
    console.error(`[radio-tts] ${message}`);
    throw new Error(message);
  }
  const tts = loadTtsModule(modulePath);
  const provider = state.ttsProvider;
  const voice = state.ttsVoice;
  const pipeline = isKokoroTtsProvider(provider) && tts.createSpeechPipelineFromEnv
    ? tts.createSpeechPipelineFromEnv({ provider, voice, model, options: { format: "mp3" } })
    : tts.createSpeechPipeline({ provider, apiKey, voice, model, options: { format: "mp3" } });
  const result = await pipeline.synthesize(text, { voice, model, options: { format: "mp3" } });
  return transcodeToRadioMp3(await tts.collectAudio(result.audio));
}

async function ensureMp3File(filePath: string) {
  try {
    const bytes = await readFile(filePath);
    const mp3Bytes = await transcodeToRadioMp3(bytes);
    if (!bytesEqual(mp3Bytes, bytes)) await writeFile(filePath, Buffer.from(mp3Bytes));
    return true;
  } catch {
    return false;
  }
}

async function transcodeToRadioMp3(bytes: Uint8Array) {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const child = await spawnRuntimeProcess(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ar", "44100", "-ac", "2", "-codec:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "pipe:1"]);
  return new Promise<Buffer>((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`ffmpeg TTS conversion failed: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    child.stdin.end(Buffer.from(bytes));
  });
}

function bytesEqual(first: Uint8Array, second: Uint8Array) {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

export async function listTtsVoiceOptions(provider: string, currentVoice: string): Promise<RadioTtsVoiceOption[]> {
  const fallback = getRadioTtsVoiceOptions(provider, currentVoice);
  if (provider !== "elevenlabs") return fallback;

  try {
    const apiKey = await providerApiKey(provider);
    if (!apiKey) return fallback;
    const modulePath = resolveRadioTtsModulePath(provider);
    if (!modulePath) return fallback;
    const tts = loadTtsModule(modulePath);
    const pipeline = tts.createSpeechPipeline({ provider, apiKey, voice: currentVoice, options: { format: "mp3" } });
    if (!pipeline.listVoices) return fallback;
    const voices = await pipeline.listVoices();
    const options = voices.map((voice) => ({
      id: voice.id,
      label: voice.name?.trim() || voice.id,
      ...(voice.labels?.length ? { description: voice.labels.join(", ") } : voice.category ? { description: voice.category } : {}),
    }));
    return mergeCurrentVoiceOption(options, currentVoice);
  } catch {
    return fallback;
  }
}

function mergeCurrentVoiceOption(options: RadioTtsVoiceOption[], currentVoice: string) {
  if (!currentVoice || options.some((voice) => voice.id === currentVoice)) return options;
  return [{ id: currentVoice, label: currentVoice }, ...options];
}

// Load the configured TTS module via a standard dynamic require resolved from
// `import.meta.url`. The previous implementation built the require call with
// `new Function` to hide it from bundler static analysis; `createRequire` is
// the documented Node escape hatch for the same thing without `eval`, so the
// dependency is visible to tooling while still resolving a runtime path.
function loadTtsModule(modulePath: string): TtsModule {
  const moduleRequire = createRequire(import.meta.url);
  return moduleRequire(modulePath) as TtsModule;
}

async function existingTrackAnnouncementFilename(track: RadioTrackRecord) {
  try {
    const metaPath = metadataPathForAudio(outputPathForAudio(outputDir(), track.filename));
    const parsed = JSON.parse(await readFile(metaPath, "utf8"));
    const filename = resolveRadioAnnouncementFilename(track, parsed);
    if (filename && await fileExists(outputPathForAudio(outputDir(), filename))) return filename;
  } catch {
    return undefined;
  }
  return undefined;
}

async function fileExists(filePath: string) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function providerApiKey(provider: string) {
  const keys = providerApiKeyNames(provider);
  const configKeys = providerConfigApiKeyNames(provider);
  const configValue = await readParTtsConfigApiKey(configKeys);
  if (configValue) return configValue;
  const envValue = keys.map((key) => process.env[key]).find(Boolean);
  if (envValue) return envValue;
  return readLocalEnvApiKey(keys);
}

function providerApiKeyNames(provider: string) {
  if (isKokoroTtsProvider(provider)) return [];
  if (provider === "elevenlabs") return ["ELEVENLABS_API_KEY"];
  if (provider === "deepgram") return ["DEEPGRAM_API_KEY", "DG_API_KEY"];
  if (provider === "gemini") return ["GEMINI_API_KEY", "GOOGLE_API_KEY"];
  return ["OPENAI_API_KEY"];
}

function providerConfigApiKeyNames(provider: string) {
  if (isKokoroTtsProvider(provider)) return [];
  if (provider === "elevenlabs") return ["elevenlabs_api_key"];
  if (provider === "deepgram") return ["deepgram_api_key"];
  if (provider === "gemini") return ["gemini_api_key"];
  return ["openai_api_key"];
}

function isKokoroTtsProvider(provider: string) {
  return provider === "kokoro-onnx" || provider === "kokoro";
}

// Resolve the TTS module path from configuration ONLY — never a hardcoded
// machine-specific default. Returns undefined when TTS is not configured; the
// caller fails with a clear message and the station degrades gracefully (no
// announcement) rather than crashing the stream.
function resolveRadioTtsModulePath(provider: string): string | undefined {
  if (isKokoroTtsProvider(provider)) {
    return process.env.RADIO_TTS_NODE_MODULE_PATH;
  }
  return process.env.RADIO_TTS_MODULE_PATH;
}

async function readParTtsConfigApiKey(keys: string[]) {
  for (const filePath of parTtsConfigPaths()) {
    try {
      const contents = await readFile(filePath, "utf8");
      const value = keys.map((key) => readRadioConfigFileValue(contents, key)).find(Boolean);
      if (value) return value;
    } catch {
      // Try the next configured location.
    }
  }
  return undefined;
}

function parTtsConfigPaths() {
  return [
    process.env.PAR_TTS_CONFIG_PATH,
    path.join(homedir(), "Library", "Application Support", "par-tts", "config.yaml"),
    path.join(homedir(), ".config", "par-tts", "config.yaml"),
  ].filter((filePath): filePath is string => Boolean(filePath));
}

async function readLocalEnvApiKey(keys: string[]) {
  try {
    const contents = await readFile(path.join(homedir(), ".claude", ".env"), "utf8");
    return keys.map((key) => readRadioEnvFileValue(contents, key)).find(Boolean);
  } catch {
    return undefined;
  }
}

// NOTE: duplicated spawn helper — see codex-client.ts note. Consolidated by
// ARC-007 / QA-010.
async function spawnRuntimeProcess(command: string, args: string[], options?: SpawnOptions): Promise<ChildProcessWithoutNullStreams> {
  const { spawn } = await import("node:child_process");
  return spawn(command, args, options ?? {}) as ChildProcessWithoutNullStreams;
}
