import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, networkInterfaces } from "node:os";
import {
  advanceRadioCurrentTrack,
  buildRadioPromptGeneratorMessages,
  buildRadioLanStreamUrl,
  buildRadioPublicStreamUrl,
  buildRadioStreamState,
  buildAnnouncementText,
  buildRadioAnnouncementFilename,
  buildRadioTrackPlaybackFilenames,
  createFallbackRadioPromptDraft,
  createRadioTrackRecord,
  defaultRadioState,
  findDuplicateRadioTitleTracks,
  findRadioTracksForCleanup,
  normalizeOllamaPromptModel,
  normalizeRadioTtsConfig,
  normalizeRadioStyleId,
  parseRadioPromptDraft,
  recordRadioRating,
  removeRadioTracksFromLineup,
  replaceRadioTrackInLineup,
  readRadioEnvFileValue,
  resolveRadioAnnouncementFilename,
  rejectCurrentRadioTrack,
  registerRadioTrack,
  type RadioPromptProvider,
  type RadioState,
  type RadioTrackRecord,
} from "@/lib/radio";
import { isSafeAudioFilename, metadataPathForAudio, outputPathForAudio } from "@/lib/library";

export const runtime = "nodejs";
export const maxDuration = 180;

type TtsModule = {
  createSpeechPipeline: (config: { provider: string; apiKey: string; model?: string; voice?: string; options?: Record<string, unknown> }) => {
    synthesize: (text: string, request?: { voice?: string; model?: string; options?: Record<string, unknown> }) => Promise<{ audio: Uint8Array | ReadableStream<Uint8Array> }>;
  };
  collectAudio: (audio: Uint8Array | ReadableStream<Uint8Array>) => Promise<Uint8Array>;
};

const outputDir = () => path.join(process.cwd(), "public", "outputs");
const statePath = () => path.join(process.cwd(), ".stable-audio-radio", "state.json");
const RADIO_STREAM_IDLE_WAIT_MS = 1200;
const RADIO_STREAM_MAX_IDLE_POLLS = 120;
const RADIO_STREAM_BYTES_PER_SECOND = 24_000;
const RADIO_STREAM_CHUNK_BYTES = 24_000;

export async function GET(request: NextRequest) {
  try {
    const state = await readRadioState();
    if (request.nextUrl.searchParams.get("stream") === "1") {
      return streamCurrentTrack(state);
    }
    const promptModels = await listOllamaPromptModels();
    return NextResponse.json({ ok: true, state: buildRadioResponseState(state, request), promptModels });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown radio error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const state = await readRadioState();

    if (action === "configure") {
      const nextState = {
        ...state,
        selectedStyleId: normalizeRadioStyleId(body.styleId ?? state.selectedStyleId),
        promptModel: normalizeOllamaPromptModel(body.promptModel ?? state.promptModel),
        announceEnabled: typeof body.announceEnabled === "boolean" ? body.announceEnabled : state.announceEnabled,
        ...normalizeRadioTtsConfig({
          ttsProvider: body.ttsProvider ?? state.ttsProvider,
          ttsVoice: body.ttsVoice ?? state.ttsVoice,
          announcementPrefix: body.announcementPrefix ?? state.announcementPrefix,
          announcementSuffix: body.announcementSuffix ?? state.announcementSuffix,
        }),
        updatedAt: new Date().toISOString(),
      };
      await writeRadioState(nextState);
      return NextResponse.json({ ok: true, state: buildRadioResponseState(nextState, request) });
    }

    if (action === "draft") {
      const styleId = normalizeRadioStyleId(body.styleId ?? state.selectedStyleId);
      const promptModel = normalizeOllamaPromptModel(body.promptModel ?? state.promptModel);
      const draft = await draftWithOllama(state, styleId, promptModel);
      const nextState = { ...state, selectedStyleId: styleId, promptModel, currentDraft: draft, updatedAt: new Date().toISOString() };
      await writeRadioState(nextState);
      return NextResponse.json({ ok: true, draft, state: buildRadioResponseState(nextState, request) });
    }

    if (action === "track") {
      const filename = typeof body.filename === "string" ? body.filename : "";
      if (!isSafeAudioFilename(filename)) return NextResponse.json({ ok: false, error: "Invalid track filename" }, { status: 400 });
      const styleId = normalizeRadioStyleId(body.styleId ?? state.selectedStyleId);
      const promptProvider = normalizePromptProvider(body.promptProvider);
      const promptModel = normalizeOllamaPromptModel(body.promptModel ?? state.currentDraft?.promptModel ?? state.promptModel);
      const track = createRadioTrackRecord({
        filename,
        title: typeof body.title === "string" && body.title.trim() ? body.title : state.currentDraft?.title ?? filename,
        prompt: typeof body.prompt === "string" && body.prompt.trim() ? body.prompt : state.currentDraft?.prompt ?? "",
        styleId,
        announce: typeof body.announce === "boolean" ? body.announce : state.announceEnabled,
        ...(promptProvider ? { promptProvider } : {}),
        promptModel,
        durationSeconds: typeof body.durationSeconds === "number" ? body.durationSeconds : undefined,
      });
      const announcementFilename = await createAnnouncementIfEnabled(track, state);
      const finalTrack = announcementFilename ? { ...track, announcementFilename } : track;
      await writeTrackRadioMetadata(finalTrack, state);
      const nextState = registerRadioTrack({ ...state, currentDraft: undefined }, finalTrack);
      await writeRadioState(nextState);
      return NextResponse.json({ ok: true, track: finalTrack, state: buildRadioResponseState(nextState, request) });
    }

    if (action === "rating") {
      const styleId = normalizeRadioStyleId(body.styleId ?? state.currentTrack?.styleId ?? state.selectedStyleId);
      const phrase = typeof body.phrase === "string" && body.phrase.trim()
        ? body.phrase
        : state.currentTrack?.prompt ?? state.currentDraft?.prompt ?? "";
      const ratedState = recordRadioRating(state, styleId, phrase, body.rating);
      const rejectResult = body.rating === "down" ? rejectCurrentRadioTrack(ratedState) : { state: ratedState, rejectedTrack: undefined };
      if (rejectResult.rejectedTrack) await removeRejectedTrackAudio(rejectResult.rejectedTrack);
      const nextState = rejectResult.state;
      await writeRadioState(nextState);
      return NextResponse.json({ ok: true, rejectedTrack: rejectResult.rejectedTrack, state: buildRadioResponseState(nextState, request) });
    }

    if (action === "cleanup") {
      const expiredTracks = findRadioTracksForCleanup(state);
      const duplicateTracks = findDuplicateRadioTitleTracks(removeRadioTracksFromLineup(state, expiredTracks));
      const cleanedTracks = [...expiredTracks, ...duplicateTracks];
      for (const track of expiredTracks) {
        await removeExpiredTrackAudio(track);
      }
      for (const track of duplicateTracks) {
        await removeDuplicateTrackAudio(track);
      }
      const nextState = removeRadioTracksFromLineup(state, cleanedTracks);
      if (cleanedTracks.length) await writeRadioState(nextState);
      return NextResponse.json({ ok: true, cleanedTracks, state: buildRadioResponseState(nextState, request) });
    }

    return NextResponse.json({ ok: false, error: "Unknown radio action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown radio error" }, { status: 500 });
  }
}

function buildRadioResponseState(state: RadioState, request: NextRequest) {
  const port = request.nextUrl.port || process.env.PORT || "3007";
  const publicStreamUrl = buildRadioPublicStreamUrl(resolvePublicRadioOrigin(request));
  const lanStreamUrl = buildRadioLanStreamUrl(resolveLanIp(), port);
  return {
    ...buildRadioStreamState(state),
    ...(publicStreamUrl ? { streamUrl: publicStreamUrl } : {}),
    ...(!publicStreamUrl && lanStreamUrl ? { lanStreamUrl } : {}),
  };
}

function resolvePublicRadioOrigin(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!host) return undefined;
  const proto = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(/:$/, "")) || "https";
  return `${proto}://${host}`;
}

function resolveLanIp() {
  const override = process.env.RADIO_LAN_HOST || process.env.LAN_IP;
  if (override) return override;
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return undefined;
}

async function draftWithOllama(state: RadioState, styleId: ReturnType<typeof normalizeRadioStyleId>, promptModel: string) {
  const messages = buildRadioPromptGeneratorMessages(state, styleId, promptModel);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.RADIO_OLLAMA_TIMEOUT_MS || 120000));

  try {
    const response = await fetch(ollamaGenerateUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: messages.model, system: messages.system, prompt: messages.prompt, stream: false }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Ollama prompt generation failed: ${response.status}`);
    const data = await response.json() as { response?: string };
    return parseRadioPromptDraft(data.response ?? "", state, styleId, promptModel);
  } catch {
    return createFallbackRadioPromptDraft(state, styleId, promptModel);
  } finally {
    clearTimeout(timeout);
  }
}

function ollamaGenerateUrl() {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? `http://${process.env.OLLAMA_HOST ?? "127.0.0.1"}:${process.env.OLLAMA_PORT ?? "11434"}`;
  return new URL("/api/generate", baseUrl).toString();
}

async function listOllamaPromptModels() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.RADIO_OLLAMA_MODELS_TIMEOUT_MS || 1000));
  try {
    const response = await fetch(ollamaTagsUrl(), { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json() as { models?: Array<{ name?: unknown; model?: unknown }> };
    return [...new Set((data.models ?? [])
      .map((model) => typeof model.name === "string" ? model.name : typeof model.model === "string" ? model.model : "")
      .map((name) => name.trim())
      .filter(Boolean))];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function ollamaTagsUrl() {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? `http://${process.env.OLLAMA_HOST ?? "127.0.0.1"}:${process.env.OLLAMA_PORT ?? "11434"}`;
  return new URL("/api/tags", baseUrl).toString();
}

async function streamCurrentTrack(state: RadioState) {
  const initialFilename = state.currentTrack?.filename;
  if (!initialFilename || !isSafeAudioFilename(initialFilename) || !initialFilename.toLowerCase().endsWith(".mp3")) {
    return new NextResponse("No MP3 radio track is ready", { status: 404 });
  }
  let streamState = state;
  let pendingFilenames: string[] = [];
  let pendingTrack: RadioTrackRecord | undefined;
  let activeAudio: Uint8Array | undefined;
  let activeAudioOffset = 0;
  let activeFilename: string | undefined;
  let activeFileStarted = false;
  let completedTrackFilename: string | undefined;
  let idlePolls = 0;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        if (activeAudio && activeFilename) {
          const chunk = activeAudio.slice(activeAudioOffset, activeAudioOffset + RADIO_STREAM_CHUNK_BYTES);
          activeAudioOffset += chunk.length;
          if (activeFileStarted) await sleep(Math.round(chunk.length / RADIO_STREAM_BYTES_PER_SECOND * 1000));
          activeFileStarted = true;
          if (activeAudioOffset >= activeAudio.length) {
            activeAudio = undefined;
            activeAudioOffset = 0;
            activeFilename = undefined;
            activeFileStarted = false;
          }
          controller.enqueue(chunk);
          return;
        }

        if (!pendingFilenames.length) {
          if (pendingTrack) {
            streamState = await advanceStreamStateAfterTrack(pendingTrack, streamState);
            completedTrackFilename = streamState.currentTrack?.filename === pendingTrack.filename ? pendingTrack.filename : undefined;
            pendingTrack = undefined;
          }

          streamState = await readRadioState();
          if (completedTrackFilename && streamState.currentTrack?.filename === completedTrackFilename) {
            const advanced = advanceRadioCurrentTrack(streamState);
            if (advanced.currentTrack?.filename !== streamState.currentTrack?.filename) {
              await writeRadioState(advanced);
              streamState = advanced;
              completedTrackFilename = undefined;
            }
          }

          const track = streamState.currentTrack;
          if (!track || !isSafeAudioFilename(track.filename) || !track.filename.toLowerCase().endsWith(".mp3") || track.filename === completedTrackFilename) {
            idlePolls += 1;
            if (idlePolls > RADIO_STREAM_MAX_IDLE_POLLS) {
              controller.close();
              return;
            }
            await sleep(RADIO_STREAM_IDLE_WAIT_MS);
            continue;
          }

          const playableTrack = await prepareTrackForStreamPlayback(track, streamState);
          if (playableTrack !== track) {
            streamState = replaceRadioTrackInLineup(streamState, playableTrack);
            await writeTrackRadioMetadata(playableTrack, streamState);
            await writeRadioState(streamState);
          }

          pendingTrack = playableTrack;
          pendingFilenames = buildRadioTrackPlaybackFilenames(playableTrack)
            .filter((filename) => isSafeAudioFilename(filename) && filename.toLowerCase().endsWith(".mp3"));
          idlePolls = 0;
          if (!pendingFilenames.length) continue;
        }

        const filename = pendingFilenames.shift();
        if (!filename) continue;
        try {
          const audio = await readFile(outputPathForAudio(outputDir(), filename));
          activeAudio = new Uint8Array(audio);
          activeFilename = filename;
          activeAudioOffset = 0;
          activeFileStarted = false;
          continue;
        } catch (error) {
          if (filename !== pendingTrack?.filename && isNotFoundError(error)) continue;
          throw error;
        }
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "no-store",
      "icy-name": "Stable Audio 3 Lab Radio",
      "icy-description": state.currentTrack?.title ?? "AI-generated local radio",
    },
  });
}

async function advanceStreamStateAfterTrack(track: RadioTrackRecord, fallbackState: RadioState) {
  const latestState = await readRadioState();
  const stateToAdvance = latestState.currentTrack?.filename === track.filename ? latestState : fallbackState;
  const advanced = advanceRadioCurrentTrack(stateToAdvance);
  if (advanced.currentTrack?.filename !== stateToAdvance.currentTrack?.filename) await writeRadioState(advanced);
  return advanced;
}

async function prepareTrackForStreamPlayback(track: RadioTrackRecord, state: RadioState) {
  if (!state.announceEnabled && !track.announce) return track;
  const announcementFilename = await createAnnouncementIfEnabled({ ...track, announce: true }, state);
  if (!announcementFilename) return track;
  if (announcementFilename === track.announcementFilename && track.announce) return track;
  return { ...track, announce: true, announcementFilename };
}

function isNotFoundError(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readRadioState(): Promise<RadioState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), "utf8")) as Partial<RadioState>;
    return {
      ...defaultRadioState(),
      ...parsed,
      selectedStyleId: normalizeRadioStyleId(parsed.selectedStyleId),
      promptModel: normalizeOllamaPromptModel(parsed.promptModel),
      ...normalizeRadioTtsConfig(parsed as Record<string, unknown>),
      preferences: parsed.preferences ?? {},
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return defaultRadioState();
  }
}

async function writeRadioState(state: RadioState) {
  await mkdir(path.dirname(statePath()), { recursive: true });
  await writeFile(statePath(), JSON.stringify(buildRadioStreamState(state), null, 2));
}

function normalizePromptProvider(value: unknown): RadioPromptProvider | undefined {
  return value === "ollama" || value === "fallback" ? value : undefined;
}

async function writeTrackRadioMetadata(track: RadioTrackRecord, state: RadioState) {
  const audioPath = outputPathForAudio(outputDir(), track.filename);
  const metaPath = metadataPathForAudio(audioPath);
  let meta: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(metaPath, "utf8"));
    if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
  } catch {
    meta = { filename: track.filename, audioUrl: `/outputs/${track.filename}` };
  }
  const updated = {
    ...meta,
    radio: {
      styleId: track.styleId,
      title: track.title,
      registeredAt: track.createdAt,
      announce: track.announce,
      announcementFilename: track.announcementFilename,
      tts: {
        provider: state.ttsProvider,
        voice: state.ttsVoice,
        announcementPrefix: state.announcementPrefix,
        announcementSuffix: state.announcementSuffix,
      },
      promptGeneration: {
        provider: track.promptProvider,
        model: track.promptModel,
      },
    },
  };
  await writeFile(metaPath, JSON.stringify(updated, null, 2));
}

async function removeRejectedTrackAudio(track: RadioTrackRecord) {
  await removeTrackAudio(track, { rejectedAt: new Date().toISOString(), removalReason: "thumbs_down" });
}

async function removeExpiredTrackAudio(track: RadioTrackRecord) {
  await removeTrackAudio(track, { expiredAt: new Date().toISOString(), removalReason: "expired_unliked" });
}

async function removeDuplicateTrackAudio(track: RadioTrackRecord) {
  await removeTrackAudio(track, { duplicateRemovedAt: new Date().toISOString(), removalReason: "duplicate_title" });
}

async function removeTrackAudio(track: RadioTrackRecord, removalMetadata: Record<string, unknown>) {
  const meta = await markRemovedTrackMetadata(track, removalMetadata);
  const announcementFilename = resolveRadioAnnouncementFilename(track, meta);
  await unlinkIfPresent(outputPathForAudio(outputDir(), track.filename));
  if (announcementFilename) await unlinkIfPresent(outputPathForAudio(outputDir(), announcementFilename));
}

async function markRemovedTrackMetadata(track: RadioTrackRecord, removalMetadata: Record<string, unknown>) {
  const audioPath = outputPathForAudio(outputDir(), track.filename);
  const metaPath = metadataPathForAudio(audioPath);
  let meta: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(metaPath, "utf8"));
    if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
  } catch {
    meta = { filename: track.filename, audioUrl: `/outputs/${track.filename}` };
  }
  const previousRadio = meta.radio && typeof meta.radio === "object" ? meta.radio as Record<string, unknown> : {};
  const updated = {
    ...meta,
    radio: {
      ...previousRadio,
      ...removalMetadata,
      audioRemovedAt: new Date().toISOString(),
      removedAudioFilename: track.filename,
    },
  };
  await writeFile(metaPath, JSON.stringify(updated, null, 2));
  return updated;
}

async function unlinkIfPresent(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    if (code !== "ENOENT") throw error;
  }
}

async function createAnnouncementIfEnabled(track: RadioTrackRecord, state: RadioState) {
  if (!track.announce) return undefined;
  const model = process.env.RADIO_TTS_MODEL;
  const previousAnnouncementFilename = await existingTrackAnnouncementFilename(track);
  if (previousAnnouncementFilename) return previousAnnouncementFilename;
  const filename = buildRadioAnnouncementFilename(track, { ...state, ttsModel: model });
  if (await fileExists(outputPathForAudio(outputDir(), filename))) return filename;
  const apiKey = await providerApiKey(state.ttsProvider);
  if (!apiKey) return undefined;
  try {
    const modulePath = process.env.RADIO_TTS_MODULE_PATH || path.join(path.sep, "Users", "probello", "Repos", "par-tts-core-ts", "dist", "index.cjs");
    const loadModule = new Function("createRequireFn", "moduleUrl", "specifier", "return createRequireFn(moduleUrl)(specifier);") as (createRequireFn: typeof createRequire, moduleUrl: string, specifier: string) => TtsModule;
    const tts = loadModule(createRequire, import.meta.url, modulePath);
    const provider = state.ttsProvider;
    const voice = state.ttsVoice;
    const pipeline = tts.createSpeechPipeline({ provider, apiKey, voice, model, options: { format: "mp3" } });
    const result = await pipeline.synthesize(buildAnnouncementText(track.title, state), { voice, model, options: { format: "mp3" } });
    const bytes = await tts.collectAudio(result.audio);
    await mkdir(outputDir(), { recursive: true });
    await writeFile(outputPathForAudio(outputDir(), filename), Buffer.from(bytes));
    return filename;
  } catch {
    return undefined;
  }
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
  const envValue = keys.map((key) => process.env[key]).find(Boolean);
  if (envValue) return envValue;
  return readLocalEnvApiKey(keys);
}

function providerApiKeyNames(provider: string) {
  if (provider === "elevenlabs") return ["ELEVENLABS_API_KEY"];
  if (provider === "deepgram") return ["DEEPGRAM_API_KEY", "DG_API_KEY"];
  if (provider === "gemini") return ["GEMINI_API_KEY", "GOOGLE_API_KEY"];
  return ["OPENAI_API_KEY"];
}

async function readLocalEnvApiKey(keys: string[]) {
  try {
    const contents = await readFile(path.join(homedir(), ".claude", ".env"), "utf8");
    return keys.map((key) => readRadioEnvFileValue(contents, key)).find(Boolean);
  } catch {
    return undefined;
  }
}
