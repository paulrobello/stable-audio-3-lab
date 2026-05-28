import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, networkInterfaces } from "node:os";
import {
  advanceRadioCurrentTrack,
  buildRadioPlaylistUrls,
  buildRadioPromptGeneratorMessages,
  buildRadioTasteDistillationPrompt,
  buildRadioLanStreamUrl,
  buildRadioPublicStreamUrl,
  buildRadioStats,
  buildRadioStreamState,
  buildRadioStyleGenerationPrompt,
  buildAnnouncementText,
  buildRadioAnnouncementFilename,
  buildRadioTrackPlaybackFilenames,
  createFallbackRadioPromptDraft,
  createRadioStyle,
  createRadioTrackRecord,
  deleteRadioStyle,
  defaultRadioState,
  findDuplicateRadioTitleTracks,
  findRadioTracksForCleanup,
  normalizeRadioState,
  normalizeOllamaPromptModel,
  normalizeRadioSongLengthMinutes,
  normalizeRadioUnlikedTrackExpirationHours,
  normalizeRadioTtsConfig,
  normalizeRadioStyleId,
  normalizeRadioStyleUrlParam,
  parseRadioPromptDraft,
  parseRadioStyleDraft,
  recordRadioRating,
  removeRadioTracksFromLineup,
  replaceRadioTrackInLineup,
  readRadioConfigFileValue,
  readRadioEnvFileValue,
  resolveRadioAnnouncementFilename,
  rejectCurrentRadioTrack,
  registerRadioTrack,
  selectRadioStyle,
  selectRadioTrack,
  getRadioTtsVoiceOptions,
  updateRadioTasteProfile,
  updateRadioStyle,
  type RadioStyleDraft,
  type RadioTasteProfileInput,
  type RadioTtsVoiceOption,
  type RadioPlaylistFormat,
  type RadioPromptProvider,
  type RadioState,
  type RadioTrackRecord,
} from "@/lib/radio";
import { buildRadioPlaylistRouteResponse } from "@/lib/radio-playlist-response";
import { normalizeGenerationRequest } from "@/lib/generation";
import { buildGeneratorArgs, resolveGenerationBackend } from "@/lib/generator-backend";
import { buildLibraryMetadata, isFavoriteMetadata, isSafeAudioFilename, metadataPathForAudio, outputPathForAudio, titleToFilename } from "@/lib/library";

export const runtime = "nodejs";
export const maxDuration = 180;

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
const statePath = () => path.join(process.cwd(), ".stable-audio-radio", "state.json");
const RADIO_STREAM_IDLE_WAIT_MS = 1200;
const RADIO_STREAM_BYTES_PER_SECOND = 24_000;
const RADIO_STREAM_CHUNK_BYTES = 24_000;
const RADIO_STREAM_ICY_META_INTERVAL = RADIO_STREAM_CHUNK_BYTES;
const radioQueueMaintenance = new Map<string, Promise<void>>();

export async function GET(request: NextRequest) {
  try {
    const playlistFormat = normalizePlaylistFormat(request.nextUrl.searchParams.get("playlist"));
    if (playlistFormat) return buildRadioPlaylistRouteResponse(playlistFormat, request);
    const state = await readRadioState();
    if (request.nextUrl.searchParams.get("stream") === "1") {
      const forceIcyMetadata = request.nextUrl.searchParams.get("icy") === "1";
      return streamCurrentTrack(state, {
        icyMetadataEnabled: forceIcyMetadata || request.headers.get("icy-metadata") === "1",
        metadataOnly: forceIcyMetadata || request.nextUrl.searchParams.get("metadataOnly") === "1",
        skipAnnouncement: request.nextUrl.searchParams.get("skipAnnouncement") === "1",
        styleId: radioStyleQueryParam(request, state),
      });
    }
    startRadioQueueMaintenance(state);
    const includePromptModels = request.nextUrl.searchParams.get("promptModels") !== "0";
    const promptModels = includePromptModels ? await listOllamaPromptModels() : undefined;
    return NextResponse.json({ ok: true, state: await buildRadioResponseState(state, request), ...(promptModels ? { promptModels } : {}) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown radio error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const state = await readRadioState();

    if (action === "createStyle") {
      const result = createRadioStyle(state, {
        label: body.label,
        seedPrompt: body.seedPrompt,
        negativePrompt: body.negativePrompt,
      });
      if (!result) return NextResponse.json({ ok: false, error: "Style name and prompt are required" }, { status: 400 });
      await writeRadioState(result.state);
      startRadioQueueMaintenance(result.state);
      return NextResponse.json({ ok: true, style: result.style, state: await buildRadioResponseState(result.state, request) });
    }

    if (action === "draftStyle") {
      const styleDraft = await draftRadioStyleWithCodex(body.request);
      if (!styleDraft) return NextResponse.json({ ok: false, error: "Could not draft a music style from that request" }, { status: 500 });
      return NextResponse.json({ ok: true, styleDraft });
    }

    if (action === "updateStyle") {
      const result = updateRadioStyle(state, {
        styleId: body.styleId,
        label: body.label,
        seedPrompt: body.seedPrompt,
        negativePrompt: body.negativePrompt,
      });
      if (!result) return NextResponse.json({ ok: false, error: "Custom style was not found or the style fields are invalid" }, { status: 400 });
      await writeRadioState(result.state);
      startRadioQueueMaintenance(result.state);
      return NextResponse.json({ ok: true, style: result.style, state: await buildRadioResponseState(result.state, request) });
    }

    if (action === "deleteStyle") {
      const result = deleteRadioStyle(state, body.styleId);
      if (!result) return NextResponse.json({ ok: false, error: "Custom style was not found" }, { status: 404 });
      await writeRadioState(result.state);
      startRadioQueueMaintenance(result.state);
      return NextResponse.json({ ok: true, deletedStyle: result.deletedStyle, state: await buildRadioResponseState(result.state, request) });
    }

    if (action === "configure") {
      const nextState = selectRadioStyle({
        ...state,
        selectedStyleId: normalizeRadioStyleId(body.styleId ?? state.selectedStyleId, state.customStyles, state.deletedStyleIds),
        promptModel: normalizeOllamaPromptModel(body.promptModel ?? state.promptModel),
        announceEnabled: typeof body.announceEnabled === "boolean" ? body.announceEnabled : state.announceEnabled,
        songLengthMinutes: normalizeRadioSongLengthMinutes(body.songLengthMinutes ?? state.songLengthMinutes),
        unlikedTrackExpirationHours: normalizeRadioUnlikedTrackExpirationHours(body.unlikedTrackExpirationHours ?? state.unlikedTrackExpirationHours),
        ...normalizeRadioTtsConfig({
          ttsProvider: body.ttsProvider ?? state.ttsProvider,
          ttsVoice: body.ttsVoice ?? state.ttsVoice,
          announcementPrefix: body.announcementPrefix ?? state.announcementPrefix,
          announcementSuffix: body.announcementSuffix ?? state.announcementSuffix,
        }),
        updatedAt: new Date().toISOString(),
      }, body.styleId ?? state.selectedStyleId);
      await writeRadioState(nextState);
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, state: await buildRadioResponseState(nextState, request) });
    }

    if (action === "testVoice") {
      const ttsConfig = normalizeRadioTtsConfig({
        ttsProvider: body.ttsProvider ?? state.ttsProvider,
        ttsVoice: body.ttsVoice ?? state.ttsVoice,
        announcementPrefix: body.announcementPrefix ?? state.announcementPrefix,
        announcementSuffix: body.announcementSuffix ?? state.announcementSuffix,
      });
      const audioUrl = await createTestVoiceAudio({ ...state, ...ttsConfig });
      return NextResponse.json({ ok: true, audioUrl });
    }

    if (action === "ttsVoices") {
      const ttsConfig = normalizeRadioTtsConfig({
        ttsProvider: body.ttsProvider ?? state.ttsProvider,
        ttsVoice: body.ttsVoice ?? state.ttsVoice,
        announcementPrefix: state.announcementPrefix,
        announcementSuffix: state.announcementSuffix,
      });
      const voices = await listTtsVoiceOptions(ttsConfig.ttsProvider, ttsConfig.ttsVoice);
      return NextResponse.json({ ok: true, voices });
    }

    if (action === "draft") {
      const styleId = normalizeRadioStyleId(body.styleId ?? state.selectedStyleId, state.customStyles, state.deletedStyleIds);
      const promptModel = normalizeOllamaPromptModel(body.promptModel ?? state.promptModel);
      const draft = await draftWithOllama(state, styleId, promptModel);
      const nextState = { ...state, selectedStyleId: styleId, promptModel, currentDraft: draft, updatedAt: new Date().toISOString() };
      await writeRadioState(nextState);
      return NextResponse.json({ ok: true, draft, state: await buildRadioResponseState(nextState, request) });
    }

    if (action === "track") {
      const filename = typeof body.filename === "string" ? body.filename : "";
      if (!isSafeAudioFilename(filename)) return NextResponse.json({ ok: false, error: "Invalid track filename" }, { status: 400 });
      const styleId = normalizeRadioStyleId(body.styleId ?? state.selectedStyleId, state.customStyles, state.deletedStyleIds);
      const promptProvider = normalizePromptProvider(body.promptProvider);
      const promptModel = normalizeOllamaPromptModel(body.promptModel ?? state.currentDraft?.promptModel ?? state.promptModel);
      const fileSizeBytes = await readAudioFileSizeBytes(filename);
      const track = createRadioTrackRecord({
        filename,
        title: typeof body.title === "string" && body.title.trim() ? body.title : state.currentDraft?.title ?? filename,
        prompt: typeof body.prompt === "string" && body.prompt.trim() ? body.prompt : state.currentDraft?.prompt ?? "",
        styleId,
        announce: typeof body.announce === "boolean" ? body.announce : state.announceEnabled,
        ...(promptProvider ? { promptProvider } : {}),
        promptModel,
        durationSeconds: typeof body.durationSeconds === "number" ? body.durationSeconds : undefined,
        fileSizeBytes,
      });
      const announcementFilename = await createAnnouncementIfEnabled(track, state);
      const finalTrack = announcementFilename ? { ...track, announcementFilename } : track;
      await writeTrackRadioMetadata(finalTrack, state);
      const nextState = registerRadioTrack({ ...state, currentDraft: undefined }, finalTrack);
      await writeRadioState(nextState);
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, track: finalTrack, state: await buildRadioResponseState(nextState, request) });
    }

    if (action === "fallbackTrack") {
      const fallback = await registerStarredLibraryFallbackTrack(state, normalizeFallbackReason(body.reason));
      if (!fallback) return NextResponse.json({ ok: false, error: "No starred library MP3 fallback is available" }, { status: 404 });
      startRadioQueueMaintenance(fallback.state);
      return NextResponse.json({ ok: true, fallbackTrack: fallback.track, state: await buildRadioResponseState(fallback.state, request) });
    }

    if (action === "selectTrack") {
      const result = selectRadioTrack(state, body.filename);
      if (!result.selectedTrack) return NextResponse.json({ ok: false, error: "Track is not in the radio lineup" }, { status: 404 });
      await writeRadioState(result.state);
      startRadioQueueMaintenance(result.state);
      return NextResponse.json({ ok: true, track: result.selectedTrack, state: await buildRadioResponseState(result.state, request) });
    }

    if (action === "skipTrack") {
      const previousTrack = state.currentTrack;
      const nextState = advanceRadioCurrentTrack(state);
      const skippedTrack = previousTrack && nextState.currentTrack?.filename !== previousTrack.filename ? previousTrack : undefined;
      if (skippedTrack) await writeRadioState(nextState);
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, skippedTrack, state: await buildRadioResponseState(nextState, request) });
    }

    if (action === "deleteTrack") {
      const filename = typeof body.filename === "string" ? body.filename.trim() : "";
      if (!isSafeAudioFilename(filename)) return NextResponse.json({ ok: false, error: "Invalid track filename" }, { status: 400 });
      const deletedTrack = state.history.find((track) => track.filename === filename);
      if (!deletedTrack) return NextResponse.json({ ok: false, error: "Track is not in the radio lineup" }, { status: 404 });
      const nextState = removeRadioTracksFromLineup(state, [deletedTrack]);
      await removeDeletedTrackAudio(deletedTrack, state);
      await writeRadioState(nextState);
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, deletedTrack, state: await buildRadioResponseState(nextState, request) });
    }

    if (action === "rating") {
      const styleId = normalizeRadioStyleId(body.styleId ?? state.currentTrack?.styleId ?? state.selectedStyleId, state.customStyles, state.deletedStyleIds);
      const phrase = typeof body.phrase === "string" && body.phrase.trim()
        ? body.phrase
        : state.currentTrack?.prompt ?? state.currentDraft?.prompt ?? "";
      const ratedState = recordRadioRating(state, styleId, phrase, body.rating);
      const rejectResult = body.rating === "down" ? rejectCurrentRadioTrack(ratedState) : { state: ratedState, rejectedTrack: undefined };
      if (rejectResult.rejectedTrack) await removeRejectedTrackAudio(rejectResult.rejectedTrack);
      const nextState = await distillRadioTasteIfPossible(rejectResult.state, styleId);
      await writeRadioState(nextState);
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, rejectedTrack: rejectResult.rejectedTrack, state: await buildRadioResponseState(nextState, request) });
    }

    if (action === "cleanup") {
      const expiredTracks = findRadioTracksForCleanup(state);
      const cleanupBaseState = removeRadioTracksFromLineup(state, expiredTracks);
      const cleanupBaseStreamState = buildRadioStreamState(cleanupBaseState);
      const duplicateTracks = cleanupBaseStreamState.queueAheadCount >= cleanupBaseStreamState.queueTarget
        ? findDuplicateRadioTitleTracks(cleanupBaseState)
        : [];
      const cleanedTracks = [...expiredTracks, ...duplicateTracks];
      for (const track of expiredTracks) {
        await removeExpiredTrackAudio(track);
      }
      for (const track of duplicateTracks) {
        await removeDuplicateTrackAudio(track);
      }
      const nextState = duplicateTracks.length ? removeRadioTracksFromLineup(cleanupBaseState, duplicateTracks) : cleanupBaseState;
      if (cleanedTracks.length) await writeRadioState(nextState);
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, cleanedTracks, state: await buildRadioResponseState(nextState, request) });
    }

    return NextResponse.json({ ok: false, error: "Unknown radio action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown radio error" }, { status: 500 });
  }
}

async function buildRadioResponseState(state: RadioState, request: NextRequest) {
  const port = request.nextUrl.port || process.env.PORT || "3007";
  const publicOrigin = resolvePublicRadioOrigin(request);
  const publicStreamUrl = buildRadioPublicStreamUrl(publicOrigin);
  const publicPlaylistUrls = buildRadioPlaylistUrls(resolveConfiguredPublicRadioOrigin(request));
  const lanStreamUrl = buildRadioLanStreamUrl(resolveLanIp(), port);
  const lanPlaylistUrls = buildRadioPlaylistUrls(lanStreamUrl);
  return {
    ...buildRadioStreamState(state),
    stats: buildRadioStats(state, await getRadioAudioDiskBytes(state)),
    ...(publicStreamUrl ? { streamUrl: publicStreamUrl } : {}),
    ...(lanStreamUrl ? { lanStreamUrl } : {}),
    ...(publicPlaylistUrls ? { publicPlaylistUrls } : {}),
    ...(lanPlaylistUrls ? { lanPlaylistUrls } : {}),
  };
}

async function getRadioAudioDiskBytes(state: RadioState) {
  const filenames = new Set<string>();
  for (const track of state.history) {
    if (isSafeAudioFilename(track.filename) && track.filename.toLowerCase().endsWith(".mp3")) filenames.add(track.filename);
    if (track.announcementFilename && isSafeAudioFilename(track.announcementFilename) && track.announcementFilename.toLowerCase().endsWith(".mp3")) {
      filenames.add(track.announcementFilename);
    }
  }

  let bytes = 0;
  for (const filename of filenames) {
    try {
      const info = await stat(outputPathForAudio(outputDir(), filename));
      if (info.isFile()) bytes += info.size;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
  return bytes;
}

function normalizePlaylistFormat(value: string | null): RadioPlaylistFormat | undefined {
  return value === "m3u" || value === "pls" ? value : undefined;
}

function resolvePublicRadioOrigin(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!host) return undefined;
  const proto = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(/:$/, "")) || "https";
  return `${proto}://${host}`;
}

function resolveConfiguredPublicRadioOrigin(request: NextRequest) {
  const requestOrigin = resolvePublicRadioOrigin(request);
  return process.env.RADIO_PUBLIC_ORIGIN || (requestOrigin?.includes("radio.pardev.net") ? requestOrigin : "https://radio.pardev.net");
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

function startRadioQueueMaintenance(state: RadioState) {
  if (process.env.RADIO_QUEUE_AUTO_FILL === "false") return;
  if (!buildRadioStreamState(state).needsQueueFill) return;
  const key = statePath();
  if (radioQueueMaintenance.has(key)) return;
  const task = maintainRadioQueue().finally(() => {
    if (radioQueueMaintenance.get(key) === task) radioQueueMaintenance.delete(key);
  });
  radioQueueMaintenance.set(key, task);
}

async function maintainRadioQueue() {
  let state = await cleanRadioQueue(await readRadioState());
  let generatedCount = 0;
  const maxGenerations = buildRadioStreamState(state).queueTarget + 1;

  while (buildRadioStreamState(state).needsQueueFill && generatedCount < maxGenerations) {
    const draft = await draftWithOllama(state, state.selectedStyleId, state.promptModel);
    try {
      state = await generateAndRegisterRadioTrack(state, draft);
    } catch {
      const fallback = await registerStarredLibraryFallbackTrack(state, "server_queue_refill_failed");
      if (!fallback) break;
      state = fallback.state;
    }
    generatedCount += 1;
  }
}

async function cleanRadioQueue(state: RadioState) {
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
  return nextState;
}

async function generateAndRegisterRadioTrack(state: RadioState, draft: Awaited<ReturnType<typeof draftWithOllama>>) {
  await mkdir(outputDir(), { recursive: true });
  const input = normalizeGenerationRequest({
    prompt: draft.prompt,
    negativePrompt: draft.negativePrompt,
    mode: "music",
    model: "small-music",
    duration: normalizeRadioSongLengthMinutes(state.songLengthMinutes) * 60,
    steps: 8,
    cfgScale: 1,
    format: "mp3",
    title: draft.title,
  });
  const filename = await titleToFilename(draft.title, input.format, outputDir(), input.mode);
  const outPath = path.join(outputDir(), filename);
  const python = process.env.STABLE_AUDIO_PYTHON || "python3";
  const mock = process.env.STABLE_AUDIO_MOCK === "true";
  const backend = resolveGenerationBackend({ envBackend: process.env.STABLE_AUDIO_BACKEND, mock });
  const args = buildGeneratorArgs({
    scriptPath: path.join(process.cwd(), "scripts", "generate_audio.py"),
    outputPath: outPath,
    input,
    backend,
    mock,
  });
  const startedAt = Date.now();
  const result = await runStableAudioGeneratorProcess(python, args, Number(process.env.STABLE_AUDIO_TIMEOUT_MS || 900000));
  const generationDurationMs = Date.now() - startedAt;
  if (result.code !== 0) throw new Error("Stable Audio queue generation failed");
  const meta = buildLibraryMetadata({ filename, input, python: result, backend, generationDurationMs, title: draft.title });
  await writeFile(metadataPathForAudio(outPath), JSON.stringify(meta, null, 2));
  const fileSizeBytes = await readAudioFileSizeBytes(filename);
  const track = createRadioTrackRecord({
    filename,
    title: draft.title,
    prompt: draft.prompt,
    styleId: draft.styleId,
    announce: state.announceEnabled,
    promptProvider: draft.promptProvider,
    promptModel: draft.promptModel,
    durationSeconds: input.duration,
    fileSizeBytes,
  });
  const announcementFilename = await createAnnouncementIfEnabled(track, state);
  const finalTrack = announcementFilename ? { ...track, announcementFilename } : track;
  await writeTrackRadioMetadata(finalTrack, state);
  const nextState = registerRadioTrack({ ...state, currentDraft: undefined }, finalTrack);
  await writeRadioState(nextState);
  return nextState;
}

async function runStableAudioGeneratorProcess(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = await spawnRuntimeProcess(command, args, { env: { ...process.env }, cwd: process.cwd() });
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      stderr += `\nTimed out after ${timeoutMs}ms`;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.slice(-8000), stderr: stderr.slice(-8000) });
    });
  });
}

async function streamCurrentTrack(state: RadioState, options: { icyMetadataEnabled?: boolean; metadataOnly?: boolean; skipAnnouncement?: boolean; styleId?: ReturnType<typeof normalizeRadioStyleUrlParam> } = {}) {
  const icyMetadataEnabled = options.icyMetadataEnabled ?? false;
  const clientSkipsAnnouncementAudio = options.skipAnnouncement || options.metadataOnly;
  let streamState = resolveStreamStyleState(state, options.styleId);
  let pendingFilenames: string[] = [];
  let pendingTrack: RadioTrackRecord | undefined;
  let activeAudio: Uint8Array | undefined;
  let activeAudioOffset = 0;
  let activeFilename: string | undefined;
  let activeFileStarted = false;
  let completedTrackFilename: string | undefined;
  let icyBytesUntilMetadata = RADIO_STREAM_ICY_META_INTERVAL;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        if (activeAudio && activeFilename) {
          if (pendingTrack) {
            const latestState = resolveStreamStyleState(await readRadioState(), options.styleId);
            if (latestState.currentTrack?.filename !== pendingTrack.filename) {
              streamState = latestState;
              pendingFilenames = [];
              pendingTrack = undefined;
              activeAudio = undefined;
              activeAudioOffset = 0;
              activeFilename = undefined;
              activeFileStarted = false;
              completedTrackFilename = undefined;
              continue;
            }
          }
          const chunkSize = icyMetadataEnabled ? Math.min(RADIO_STREAM_CHUNK_BYTES, icyBytesUntilMetadata) : RADIO_STREAM_CHUNK_BYTES;
          const chunk = activeAudio.slice(activeAudioOffset, activeAudioOffset + chunkSize);
          activeAudioOffset += chunk.length;
          if (activeFileStarted) await sleep(Math.round(chunk.length / RADIO_STREAM_BYTES_PER_SECOND * 1000));
          activeFileStarted = true;
          const finishedFilename = activeAudioOffset >= activeAudio.length ? activeFilename : undefined;
          const metadataTitle = pendingTrack?.title;
          if (activeAudioOffset >= activeAudio.length) {
            activeAudio = undefined;
            activeAudioOffset = 0;
            activeFilename = undefined;
            activeFileStarted = false;
          }
          if (finishedFilename && pendingTrack && finishedFilename === pendingTrack.filename && pendingFilenames.length === 0) {
            streamState = await advanceStreamStateAfterTrack(pendingTrack, options.styleId);
            completedTrackFilename = streamState.currentTrack?.filename === pendingTrack.filename ? pendingTrack.filename : undefined;
            pendingTrack = undefined;
          }
          let outputChunk = chunk;
          if (icyMetadataEnabled) {
            icyBytesUntilMetadata -= chunk.length;
            if (icyBytesUntilMetadata <= 0) {
              outputChunk = concatenateBytes(chunk, buildIcyMetadataBlock(metadataTitle));
              icyBytesUntilMetadata = RADIO_STREAM_ICY_META_INTERVAL;
            }
          }
          controller.enqueue(outputChunk);
          return;
        }

        if (!pendingFilenames.length) {
          if (pendingTrack) {
            streamState = await advanceStreamStateAfterTrack(pendingTrack, options.styleId);
            completedTrackFilename = streamState.currentTrack?.filename === pendingTrack.filename ? pendingTrack.filename : undefined;
            pendingTrack = undefined;
          }

          streamState = resolveStreamStyleState(await readRadioState(), options.styleId);
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
            const fallback = await registerStarredLibraryFallbackTrack(streamState, "stream_starvation");
            if (fallback) {
              streamState = fallback.state;
              completedTrackFilename = undefined;
              continue;
            }
            await sleep(RADIO_STREAM_IDLE_WAIT_MS);
            continue;
          }

          const skipAnnouncementAudio = clientSkipsAnnouncementAudio || !streamState.announceEnabled;
          const playableTrack = skipAnnouncementAudio ? track : await prepareTrackForStreamPlayback(track, streamState);
          if (playableTrack !== track) {
            streamState = replaceRadioTrackInLineup(streamState, playableTrack);
            await writeTrackRadioMetadata(playableTrack, streamState);
            await writeRadioState(streamState);
          }

          pendingTrack = playableTrack;
          pendingFilenames = buildRadioTrackPlaybackFilenames(playableTrack, { skipAnnouncement: skipAnnouncementAudio })
            .filter((filename) => isSafeAudioFilename(filename) && filename.toLowerCase().endsWith(".mp3"));
          if (!pendingFilenames.length) continue;
        }

        const segmentFilenames = pendingFilenames.splice(0);
        if (!segmentFilenames.length) continue;
        try {
          const segmentFiles = [];
          for (const segmentFilename of segmentFilenames) {
            try {
              segmentFiles.push({ filename: segmentFilename, filePath: outputPathForAudio(outputDir(), segmentFilename) });
              await readFile(outputPathForAudio(outputDir(), segmentFilename));
            } catch (error) {
              if (segmentFilename !== pendingTrack?.filename && isNotFoundError(error)) continue;
              throw error;
            }
          }
          if (!segmentFiles.length) continue;
          activeAudio = await readRadioStreamSegment(segmentFiles.map((file) => file.filePath));
          activeFilename = pendingTrack?.filename ?? segmentFiles.at(-1)?.filename;
          activeAudioOffset = 0;
          activeFileStarted = false;
          continue;
        } catch (error) {
          throw error;
        }
      }
    },
  });
  const headers: Record<string, string> = {
    "content-type": "audio/mpeg",
    "cache-control": "no-store",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
    "icy-name": "Stable Audio 3 Lab Radio",
    "icy-description": streamState.currentTrack?.title ?? "AI-generated local radio",
  };
  if (icyMetadataEnabled) headers["icy-metaint"] = String(RADIO_STREAM_ICY_META_INTERVAL);

  return new NextResponse(stream, {
    headers,
  });
}

function buildIcyMetadataBlock(title: string | undefined) {
  const metadata = Buffer.from(`StreamTitle='${cleanIcyMetadataValue(title ?? "Stable Audio 3 Lab Radio")}';`, "utf8").subarray(0, 4080);
  const blockCount = Math.ceil(metadata.length / 16);
  const block = new Uint8Array(1 + blockCount * 16);
  block[0] = blockCount;
  block.set(metadata, 1);
  return block;
}

function cleanIcyMetadataValue(value: string) {
  return value.replace(/[\0\r\n;]/g, " ").replace(/'/g, "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function concatenateBytes(first: Uint8Array, second: Uint8Array) {
  const output = new Uint8Array(first.length + second.length);
  output.set(first);
  output.set(second, first.length);
  return output;
}

function stripLeadingId3Tag(bytes: Uint8Array) {
  if (bytes.length < 10 || String.fromCharCode(...bytes.slice(0, 3)) !== "ID3") return bytes;
  const tagSize = (bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f);
  const footerSize = (bytes[5] & 0x10) === 0x10 ? 10 : 0;
  const offset = 10 + tagSize + footerSize;
  return offset > 10 && offset < bytes.length ? bytes.slice(offset) : bytes;
}

async function readRadioStreamSegment(filePaths: string[]) {
  if (filePaths.length === 1) return stripLeadingId3Tag(new Uint8Array(await readFile(filePaths[0])));
  try {
    return stripLeadingId3Tag(await transcodeFilesToRadioMp3(filePaths));
  } catch {
    const chunks = await Promise.all(filePaths.map(async (filePath) => stripLeadingId3Tag(new Uint8Array(await readFile(filePath)))));
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
}

async function advanceStreamStateAfterTrack(track: RadioTrackRecord, styleId: ReturnType<typeof normalizeRadioStyleUrlParam>) {
  const latestState = resolveStreamStyleState(await readRadioState(), styleId);
  if (latestState.currentTrack?.filename !== track.filename) return latestState;
  const advanced = advanceRadioCurrentTrack(latestState);
  if (advanced.currentTrack?.filename !== latestState.currentTrack?.filename) await writeRadioState(advanced);
  return advanced;
}

function radioStyleQueryParam(request: NextRequest, state: RadioState) {
  return normalizeRadioStyleUrlParam(
    request.nextUrl.searchParams.get("style") ?? request.nextUrl.searchParams.get("styleId"),
    state.customStyles,
    state.deletedStyleIds,
  );
}

function resolveStreamStyleState(state: RadioState, styleId: ReturnType<typeof normalizeRadioStyleUrlParam>) {
  return styleId ? normalizeRadioState({ ...state, selectedStyleId: styleId }) : state;
}

async function distillRadioTasteIfPossible(state: RadioState, styleId: ReturnType<typeof normalizeRadioStyleId>) {
  const preference = state.preferences[styleId];
  if (!preference || preference.likes.length + preference.dislikes.length === 0) return state;
  try {
    const model = normalizeCodexTasteModel(process.env.RADIO_CODEX_TASTE_MODEL);
    const profile = await runCodexTasteDistillation(state, styleId, model);
    return profile ? updateRadioTasteProfile(state, styleId, profile, model) : state;
  } catch {
    return state;
  }
}

async function runCodexTasteDistillation(state: RadioState, styleId: ReturnType<typeof normalizeRadioStyleId>, model: string): Promise<RadioTasteProfileInput | undefined> {
  const stateDir = path.dirname(statePath());
  await mkdir(stateDir, { recursive: true });
  const outputPath = path.join(stateDir, `codex-taste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  const prompt = buildRadioTasteDistillationPrompt(state, styleId);
  try {
    await runCodexCli(prompt, outputPath, model);
    return parseCodexTasteProfile(await readFile(outputPath, "utf8"));
  } finally {
    await unlink(outputPath).catch((error: unknown) => {
      if (!isNotFoundError(error)) throw error;
    });
  }
}

async function draftRadioStyleWithCodex(requestInput: unknown): Promise<RadioStyleDraft | undefined> {
  const request = typeof requestInput === "string" ? requestInput.trim() : "";
  if (request.length < 3) return undefined;
  const model = normalizeCodexTasteModel(process.env.RADIO_CODEX_STYLE_MODEL ?? process.env.RADIO_CODEX_TASTE_MODEL);
  const stateDir = path.dirname(statePath());
  await mkdir(stateDir, { recursive: true });
  const outputPath = path.join(stateDir, `codex-style-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  const prompt = buildRadioStyleGenerationPrompt(request);
  try {
    await runCodexCli(prompt, outputPath, model, "Codex style generation");
    const draft = parseRadioStyleDraft(await readFile(outputPath, "utf8"), request);
    return draft ? { ...draft, model } : undefined;
  } finally {
    await unlink(outputPath).catch((error: unknown) => {
      if (!isNotFoundError(error)) throw error;
    });
  }
}

async function runCodexCli(prompt: string, outputPath: string, model: string, taskLabel = "Codex taste distillation") {
  const codexBin = process.env.RADIO_CODEX_BIN || "codex";
  const timeoutMs = Number(process.env.RADIO_CODEX_TASTE_TIMEOUT_MS || 120000);
  const args = [
    "exec",
    "-m",
    model,
    "--cd",
    process.cwd(),
    "--sandbox",
    "read-only",
    "--ask-for-approval",
    "never",
    "--ephemeral",
    "--ignore-rules",
    "-o",
    outputPath,
    "-",
  ];
  const child = await spawnRuntimeProcess(codexBin, args, { cwd: process.cwd(), stdio: ["pipe", "ignore", "pipe"] });

  return new Promise<void>((resolve, reject) => {
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000);

    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`${taskLabel} timed out`));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`${taskLabel} failed: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    child.stdin.end(prompt);
  });
}

async function spawnRuntimeProcess(command: string, args: string[], options?: SpawnOptions): Promise<ChildProcessWithoutNullStreams> {
  const { spawn } = await import("node:child_process");
  return spawn(command, args, options ?? {}) as ChildProcessWithoutNullStreams;
}

function parseCodexTasteProfile(value: string): RadioTasteProfileInput | undefined {
  const parsed = JSON.parse(extractJsonObject(value)) as Record<string, unknown>;
  const profile = {
    likedTraits: readTasteArray(parsed, "likedTraits"),
    dislikedTraits: readTasteArray(parsed, "dislikedTraits"),
    promptDirectives: readTasteArray(parsed, "promptDirectives"),
    negativePromptDirectives: readTasteArray(parsed, "negativePromptDirectives"),
    explorationNotes: readTasteArray(parsed, "explorationNotes"),
  };
  return Object.values(profile).some((values) => values.length > 0) ? profile : undefined;
}

function readTasteArray(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeCodexTasteModel(value: unknown) {
  if (typeof value !== "string") return "gpt-5.5";
  const model = value.trim();
  return model && model.length <= 80 && !/[\s"'<>]/.test(model) ? model : "gpt-5.5";
}

function extractJsonObject(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return value;
  return value.slice(start, end + 1);
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
    return normalizeRadioState(parsed);
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

function normalizeFallbackReason(value: unknown) {
  if (typeof value !== "string") return "queue_refill_timeout";
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "queue_refill_timeout";
}

async function registerStarredLibraryFallbackTrack(state: RadioState, reason: string) {
  const track = await buildStarredLibraryFallbackTrack(state, reason);
  if (!track) return undefined;
  const announcementFilename = await createAnnouncementIfEnabled(track, state);
  const finalTrack = announcementFilename ? { ...track, announcementFilename } : track;
  await writeTrackRadioMetadata(finalTrack, state);
  const nextState = registerRadioTrack({ ...state, currentDraft: undefined }, finalTrack);
  await writeRadioState(nextState);
  return { track: finalTrack, state: nextState };
}

async function buildStarredLibraryFallbackTrack(state: RadioState, reason: string): Promise<RadioTrackRecord | undefined> {
  const candidates = await readStarredLibraryFallbackCandidates(state);
  const candidate = candidates[0];
  if (!candidate) return undefined;
  return createRadioTrackRecord({
    filename: candidate.filename,
    title: candidate.title,
    prompt: candidate.prompt,
    styleId: state.selectedStyleId,
    announce: state.announceEnabled,
    promptProvider: "fallback",
    promptModel: "starred-library",
    source: "library-fallback",
    fallbackReason: reason,
    durationSeconds: candidate.durationSeconds,
    fileSizeBytes: candidate.fileSizeBytes,
  });
}

async function readStarredLibraryFallbackCandidates(state: RadioState) {
  await mkdir(outputDir(), { recursive: true });
  const names = await readdir(outputDir());
  const queuedFilenames = new Set(state.history.map((track) => track.filename));
  const candidates: Array<{
    filename: string;
    title: string;
    prompt: string;
    durationSeconds?: number;
    fileSizeBytes: number;
    queued: boolean;
    createdAtMs: number;
  }> = [];

  for (const filename of names) {
    if (!isSafeAudioFilename(filename) || !filename.toLowerCase().endsWith(".mp3") || filename.startsWith("radio_announce_")) continue;
    const audioPath = outputPathForAudio(outputDir(), filename);
    let meta: unknown;
    try {
      meta = JSON.parse(await readFile(metadataPathForAudio(audioPath), "utf8"));
      if (!isFavoriteMetadata(meta)) continue;
      const info = await stat(audioPath);
      candidates.push({
        filename,
        ...readFallbackTrackMetadata(filename, meta),
        fileSizeBytes: info.size,
        queued: queuedFilenames.has(filename),
        createdAtMs: info.birthtimeMs,
      });
    } catch {
      continue;
    }
  }

  return candidates.sort((a, b) => Number(a.queued) - Number(b.queued) || b.createdAtMs - a.createdAtMs);
}

function readFallbackTrackMetadata(filename: string, meta: unknown) {
  const record = meta && typeof meta === "object" ? meta as Record<string, unknown> : {};
  const settings = record.settings && typeof record.settings === "object" ? record.settings as Record<string, unknown> : {};
  const request = record.request && typeof record.request === "object" ? record.request as Record<string, unknown> : {};
  const radio = record.radio && typeof record.radio === "object" ? record.radio as Record<string, unknown> : {};
  const title = firstString(record.title, radio.title, filename.replace(/\.(mp3|wav)$/i, ""));
  const prompt = firstString(settings.prompt, request.prompt, radio.title, title);
  const duration = firstNumber(settings.duration, request.duration);
  return {
    title,
    prompt,
    ...(duration ? { durationSeconds: duration } : {}),
  };
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

function firstNumber(...values: unknown[]) {
  const value = values.find((item): item is number => typeof item === "number" && Number.isFinite(item) && item > 0);
  return value;
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
      source: track.source,
      fallbackReason: track.fallbackReason,
      registeredAt: track.createdAt,
      announce: track.announce,
      announcementFilename: track.announcementFilename,
      fileSizeBytes: track.fileSizeBytes,
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

async function readAudioFileSizeBytes(filename: string) {
  try {
    return (await stat(outputPathForAudio(outputDir(), filename))).size;
  } catch {
    return undefined;
  }
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

async function removeDeletedTrackAudio(track: RadioTrackRecord, state: RadioState) {
  const removalMetadata = { deletedAt: new Date().toISOString(), removalReason: "manual_delete" };
  if (hasRadioTrackFeedback(track, state)) {
    await removeTrackAudio(track, removalMetadata);
    return;
  }
  await deleteTrackAudioAndMetadata(track);
}

function hasRadioTrackFeedback(track: RadioTrackRecord, state: RadioState) {
  if (track.rating === "up" || track.rating === "down") return true;
  const preference = state.preferences[track.styleId];
  return !!preference && (preference.likes.includes(track.prompt) || preference.dislikes.includes(track.prompt));
}

async function removeTrackAudio(track: RadioTrackRecord, removalMetadata: Record<string, unknown>) {
  const meta = await markRemovedTrackMetadata(track, removalMetadata);
  const announcementFilename = resolveRadioAnnouncementFilename(track, meta);
  await unlinkIfPresent(outputPathForAudio(outputDir(), track.filename));
  if (announcementFilename) await unlinkIfPresent(outputPathForAudio(outputDir(), announcementFilename));
}

async function deleteTrackAudioAndMetadata(track: RadioTrackRecord) {
  const audioPath = outputPathForAudio(outputDir(), track.filename);
  const metaPath = metadataPathForAudio(audioPath);
  const meta = await readTrackMetadata(track);
  const announcementFilename = resolveRadioAnnouncementFilename(track, meta);
  await unlinkIfPresent(audioPath);
  if (announcementFilename) await unlinkIfPresent(outputPathForAudio(outputDir(), announcementFilename));
  await unlinkIfPresent(metaPath);
}

async function markRemovedTrackMetadata(track: RadioTrackRecord, removalMetadata: Record<string, unknown>) {
  const audioPath = outputPathForAudio(outputDir(), track.filename);
  const metaPath = metadataPathForAudio(audioPath);
  const meta = await readTrackMetadata(track);
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

async function readTrackMetadata(track: RadioTrackRecord) {
  const audioPath = outputPathForAudio(outputDir(), track.filename);
  const metaPath = metadataPathForAudio(audioPath);
  let meta: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(metaPath, "utf8"));
    if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
  } catch {
    meta = { filename: track.filename, audioUrl: `/outputs/${track.filename}` };
  }
  return meta;
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

async function createTestVoiceAudio(state: RadioState) {
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

async function transcodeFilesToRadioMp3(filePaths: string[]) {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const inputArgs = filePaths.flatMap((filePath) => ["-i", filePath]);
  const concatInputs = filePaths.map((_, index) => `[${index}:a]`).join("");
  const child = await spawnRuntimeProcess(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputArgs,
    "-filter_complex",
    `${concatInputs}concat=n=${filePaths.length}:v=0:a=1[a]`,
    "-map",
    "[a]",
    "-vn",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "128k",
    "-f",
    "mp3",
    "pipe:1",
  ]);
  return new Promise<Buffer>((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`ffmpeg radio segment conversion failed: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    child.stdin.end();
  });
}

function bytesEqual(first: Uint8Array, second: Uint8Array) {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

async function listTtsVoiceOptions(provider: string, currentVoice: string): Promise<RadioTtsVoiceOption[]> {
  const fallback = getRadioTtsVoiceOptions(provider, currentVoice);
  if (provider !== "elevenlabs") return fallback;

  try {
    const apiKey = await providerApiKey(provider);
    if (!apiKey) return fallback;
    const tts = loadTtsModule(resolveRadioTtsModulePath(provider));
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

function loadTtsModule(modulePath: string) {
  const loadModule = new Function("createRequireFn", "moduleUrl", "specifier", "return createRequireFn(moduleUrl)(specifier);") as (createRequireFn: typeof createRequire, moduleUrl: string, specifier: string) => TtsModule;
  return loadModule(createRequire, import.meta.url, modulePath);
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

function resolveRadioTtsModulePath(provider: string) {
  if (isKokoroTtsProvider(provider)) {
    return process.env.RADIO_TTS_NODE_MODULE_PATH || path.join(path.sep, "Users", "probello", "Repos", "par-tts-core-ts", "dist", "node", "index.cjs");
  }
  return process.env.RADIO_TTS_MODULE_PATH || path.join(path.sep, "Users", "probello", "Repos", "par-tts-core-ts", "dist", "index.cjs");
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
