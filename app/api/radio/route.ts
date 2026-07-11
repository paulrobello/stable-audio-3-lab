import { NextRequest, NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import {
  advanceRadioCurrentTrack,
  buildRadioLanStreamUrl,
  buildRadioPlaylistUrls,
  buildRadioPublicStreamUrl,
  buildRadioQueueGenerationStatus,
  buildRadioStats,
  buildRadioStreamState,
  createRadioStyle,
  createRadioTrackRecord,
  deleteRadioStyle,
  findDuplicateRadioTitleTracks,
  findRadioTracksForCleanup,
  normalizeOllamaPromptModel,
  normalizeRadioSongLengthMinutes,
  normalizeRadioStyleId,
  normalizeRadioStyleUrlParam,
  normalizeRadioTtsConfig,
  normalizeRadioUnlikedTrackExpirationHours,
  recordRadioRating,
  registerRadioTrack,
  rejectCurrentRadioTrack,
  removeRadioTracksFromLineup,
  selectRadioStyle,
  selectRadioTrack,
  updateRadioStyle,
  updateRadioTasteProfile,
  type RadioPlaylistFormat,
  type RadioPromptProvider,
  type RadioRating,
  type RadioState,
  type RadioTrackRecord,
} from "@/lib/radio";
import { buildRadioPlaylistRouteResponse } from "@/lib/radio-playlist-response";
import { isSafeAudioFilename, outputPathForAudio } from "@/lib/library";
import { enqueueAudioAssessment, getAudioAssessmentQueueStatus, startAudioAssessmentQueueProcessing } from "@/lib/audio-assessment";
import { mutateRadioState, readRadioState } from "@/lib/server/radio-state-store";
import { ollamaTagsUrl } from "@/lib/server/ollama";
import { distillRadioTasteProfile, draftRadioStyleWithCodex } from "@/lib/server/codex-client";
import { createAnnouncementIfEnabled, createTestVoiceAudio, listTtsVoiceOptions } from "@/lib/server/radio-tts";
import {
  draftWithOllama,
  isRadioQueueMaintenanceActive,
  readAudioFileSizeBytes,
  readTrackMetadata,
  registerStarredLibraryFallbackTrack,
  removeDeletedTrackAudio,
  removeDuplicateTrackAudio,
  removeExpiredTrackAudio,
  removeRejectedTrackAudio,
  startRadioQueueMaintenance,
  writeTrackRadioMetadata,
} from "@/lib/server/radio-queue-service";
import { resolveStreamStyleState, streamCurrentTrack } from "@/lib/server/radio-stream";
import { lanIp, radioLanHost, radioOllamaModelsTimeoutMs, radioPublicOrigin, serverPort } from "@/lib/server/config";
import { radioActionRequestSchema } from "@/lib/server/radio-actions";

export const runtime = "nodejs";
export const maxDuration = 180;

const outputDir = () => path.join(process.cwd(), "public", "outputs");

export async function GET(request: NextRequest) {
  try {
    const playlistFormat = normalizePlaylistFormat(request.nextUrl.searchParams.get("playlist"));
    if (playlistFormat) return buildRadioPlaylistRouteResponse(playlistFormat, request);
    if (request.nextUrl.searchParams.get("stream") === "1") {
      // ARC-012: the stream entry is read-only. Advancement is owned solely by
      // the listener-gated wall-clock ticker (registered inside
      // `streamCurrentTrack`); neither this read nor the listener's per-pull
      // reads mutate state. The non-stream GET below likewise uses plain
      // `readRadioState`, so a state poll never advances playback.
      const state = await readRadioState();
      const styleId = radioStyleQueryParam(request, state);
      startRadioQueueMaintenance(resolveStreamStyleState(state, styleId));
      const forceIcyMetadata = request.nextUrl.searchParams.get("icy") === "1";
      return streamCurrentTrack(state, {
        icyMetadataEnabled: forceIcyMetadata || request.headers.get("icy-metadata") === "1",
        metadataOnly: forceIcyMetadata || request.nextUrl.searchParams.get("metadataOnly") === "1",
        skipAnnouncement: request.nextUrl.searchParams.get("skipAnnouncement") === "1",
        styleId,
        signal: request.signal,
      });
    }
    const state = await readRadioState();
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
    // Single Zod-validated parse of the action payload (ARC-009). An unknown or
    // missing action is rejected here with the same 400 the previous sequential
    // fall-through returned. Payload fields stay `unknown` and are normalized at
    // each handler — `.passthrough()` preserves every key the handlers read.
    const parsed = radioActionRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Unknown radio action" }, { status: 400 });
    }
    const body = parsed.data;
    const state = await readRadioState();

    if (body.action === "createStyle") {
      const result = createRadioStyle(state, {
        label: body.label,
        seedPrompt: body.seedPrompt,
        negativePrompt: body.negativePrompt,
      });
      if (!result) return NextResponse.json({ ok: false, error: "Style name and prompt are required" }, { status: 400 });
      const nextState = await mutateRadioState((s) => createRadioStyle(s, {
        label: body.label,
        seedPrompt: body.seedPrompt,
        negativePrompt: body.negativePrompt,
      })?.state ?? s);
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, style: result.style, state: await buildRadioResponseState(nextState, request) });
    }

    if (body.action === "draftStyle") {
      const styleDraft = await draftRadioStyleWithCodex(body.request);
      if (!styleDraft) return NextResponse.json({ ok: false, error: "Could not draft a music style from that request" }, { status: 500 });
      return NextResponse.json({ ok: true, styleDraft });
    }

    if (body.action === "updateStyle") {
      const result = updateRadioStyle(state, {
        styleId: body.styleId,
        label: body.label,
        seedPrompt: body.seedPrompt,
        negativePrompt: body.negativePrompt,
      });
      if (!result) return NextResponse.json({ ok: false, error: "Custom style was not found or the style fields are invalid" }, { status: 400 });
      const nextState = await mutateRadioState((s) => updateRadioStyle(s, {
        styleId: body.styleId,
        label: body.label,
        seedPrompt: body.seedPrompt,
        negativePrompt: body.negativePrompt,
      })?.state ?? s);
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, style: result.style, state: await buildRadioResponseState(nextState, request) });
    }

    if (body.action === "deleteStyle") {
      const result = deleteRadioStyle(state, body.styleId);
      if (!result) return NextResponse.json({ ok: false, error: "Custom style was not found" }, { status: 404 });
      const nextState = await mutateRadioState((s) => deleteRadioStyle(s, body.styleId)?.state ?? s);
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, deletedStyle: result.deletedStyle, state: await buildRadioResponseState(nextState, request) });
    }

    if (body.action === "configure") {
      const nextState = await mutateRadioState((s) => selectRadioStyle({
        ...s,
        selectedStyleId: normalizeRadioStyleId(body.styleId ?? s.selectedStyleId, s.customStyles, s.deletedStyleIds),
        promptModel: normalizeOllamaPromptModel(body.promptModel ?? s.promptModel),
        announceEnabled: typeof body.announceEnabled === "boolean" ? body.announceEnabled : s.announceEnabled,
        songLengthMinutes: normalizeRadioSongLengthMinutes(body.songLengthMinutes ?? s.songLengthMinutes),
        unlikedTrackExpirationHours: normalizeRadioUnlikedTrackExpirationHours(body.unlikedTrackExpirationHours ?? s.unlikedTrackExpirationHours),
        ...normalizeRadioTtsConfig({
          ttsProvider: body.ttsProvider ?? s.ttsProvider,
          ttsVoice: body.ttsVoice ?? s.ttsVoice,
          announcementPrefix: body.announcementPrefix ?? s.announcementPrefix,
          announcementSuffix: body.announcementSuffix ?? s.announcementSuffix,
        }),
        updatedAt: new Date().toISOString(),
      }, body.styleId ?? s.selectedStyleId));
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, state: await buildRadioResponseState(nextState, request) });
    }

    if (body.action === "testVoice") {
      const ttsConfig = normalizeRadioTtsConfig({
        ttsProvider: body.ttsProvider ?? state.ttsProvider,
        ttsVoice: body.ttsVoice ?? state.ttsVoice,
        announcementPrefix: body.announcementPrefix ?? state.announcementPrefix,
        announcementSuffix: body.announcementSuffix ?? state.announcementSuffix,
      });
      const audioUrl = await createTestVoiceAudio({ ...state, ...ttsConfig });
      return NextResponse.json({ ok: true, audioUrl });
    }

    if (body.action === "ttsVoices") {
      const ttsConfig = normalizeRadioTtsConfig({
        ttsProvider: body.ttsProvider ?? state.ttsProvider,
        ttsVoice: body.ttsVoice ?? state.ttsVoice,
        announcementPrefix: state.announcementPrefix,
        announcementSuffix: state.announcementSuffix,
      });
      const voices = await listTtsVoiceOptions(ttsConfig.ttsProvider, ttsConfig.ttsVoice);
      return NextResponse.json({ ok: true, voices });
    }

    if (body.action === "draft") {
      const styleId = normalizeRadioStyleId(body.styleId ?? state.selectedStyleId, state.customStyles, state.deletedStyleIds);
      const promptModel = normalizeOllamaPromptModel(body.promptModel ?? state.promptModel);
      const draft = await draftWithOllama(state, styleId, promptModel);
      const nextState = await mutateRadioState((s) => ({ ...s, selectedStyleId: styleId, promptModel, currentDraft: draft, updatedAt: new Date().toISOString() }));
      return NextResponse.json({ ok: true, draft, state: await buildRadioResponseState(nextState, request) });
    }

    if (body.action === "track") {
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
      const nextState = await mutateRadioState((s) => registerRadioTrack({ ...s, currentDraft: undefined }, finalTrack));
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, track: finalTrack, state: await buildRadioResponseState(nextState, request) });
    }

    if (body.action === "fallbackTrack") {
      const fallback = await registerStarredLibraryFallbackTrack(state, normalizeFallbackReason(body.reason));
      if (!fallback) return NextResponse.json({ ok: false, error: "No starred library MP3 fallback is available" }, { status: 404 });
      startRadioQueueMaintenance(fallback.state);
      return NextResponse.json({ ok: true, fallbackTrack: fallback.track, state: await buildRadioResponseState(fallback.state, request) });
    }

    if (body.action === "selectTrack") {
      const result = selectRadioTrack(state, body.filename);
      if (!result.selectedTrack) return NextResponse.json({ ok: false, error: "Track is not in the radio lineup" }, { status: 404 });
      const nextState = await mutateRadioState((s) => selectRadioTrack(s, body.filename).state ?? s);
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, track: result.selectedTrack, state: await buildRadioResponseState(nextState, request) });
    }

    if (body.action === "skipTrack") {
      const previousTrack = state.currentTrack;
      const nextState = await mutateRadioState((s) => {
        const advanced = advanceRadioCurrentTrack(s);
        return advanced.currentTrack?.filename !== s.currentTrack?.filename ? advanced : s;
      });
      const skippedTrack = previousTrack && nextState.currentTrack?.filename !== previousTrack.filename ? previousTrack : undefined;
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, skippedTrack, state: await buildRadioResponseState(nextState, request) });
    }

    if (body.action === "deleteTrack") {
      const filename = typeof body.filename === "string" ? body.filename.trim() : "";
      if (!isSafeAudioFilename(filename)) return NextResponse.json({ ok: false, error: "Invalid track filename" }, { status: 400 });
      const deletedTrack = state.history.find((track) => track.filename === filename);
      if (!deletedTrack) return NextResponse.json({ ok: false, error: "Track is not in the radio lineup" }, { status: 404 });
      await removeDeletedTrackAudio(deletedTrack, state);
      const nextState = await mutateRadioState((s) => removeRadioTracksFromLineup(s, [deletedTrack]));
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, deletedTrack, state: await buildRadioResponseState(nextState, request) });
    }

    if (body.action === "rating") {
      const ratedFilename = typeof body.filename === "string" ? body.filename.trim() : "";
      const ratedTrack = ratedFilename && isSafeAudioFilename(ratedFilename)
        ? state.history.find((track) => track.filename === ratedFilename)
        : undefined;
      const styleId = normalizeRadioStyleId(body.styleId ?? ratedTrack?.styleId ?? state.currentTrack?.styleId ?? state.selectedStyleId, state.customStyles, state.deletedStyleIds);
      const phrase = typeof body.phrase === "string" && body.phrase.trim()
        ? body.phrase
        : ratedTrack?.prompt ?? state.currentTrack?.prompt ?? state.currentDraft?.prompt ?? "";
      const rating = normalizeRadioRatingPayload(body.rating);
      const assessmentTrack = findRatedAssessmentTrack(ratedTrack ?? state.currentTrack, rating);
      if (assessmentTrack && rating) {
        await enqueueAudioAssessment({
          filename: assessmentTrack.filename,
          source: "radio",
          title: assessmentTrack.title,
          prompt: assessmentTrack.prompt,
          styleId: assessmentTrack.styleId,
          rating,
        });
        void startAudioAssessmentQueueProcessing();
      }
      // The rating + reject transforms are decided on the seed snapshot; the
      // expensive taste distillation runs against that snapshot too. Their
      // *effects* are re-applied to the freshest state inside the lock below so
      // a concurrent writer (queue loop, another POST) cannot be clobbered by
      // this handler's stale write.
      const ratedState = recordRadioRating(state, styleId, phrase, body.rating);
      const shouldRejectCurrentTrack = body.rating === "down" && (!ratedTrack || ratedTrack.filename === state.currentTrack?.filename);
      const rejectResult = shouldRejectCurrentTrack ? rejectCurrentRadioTrack(ratedState) : undefined;
      if (rejectResult?.rejectedTrack) await removeRejectedTrackAudio(rejectResult.rejectedTrack);
      const taste = await distillRadioTasteProfile(ratedState, styleId);
      const rejectFilename = rejectResult?.rejectedTrack?.filename;
      const nextState = await mutateRadioState((s) => {
        let next = recordRadioRating(s, styleId, phrase, body.rating);
        if (rejectFilename && next.currentTrack?.filename === rejectFilename) {
          next = rejectCurrentRadioTrack(next).state;
        }
        if (taste) next = updateRadioTasteProfile(next, styleId, taste.profile, taste.model);
        return next;
      });
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, rejectedTrack: rejectResult?.rejectedTrack, state: await buildRadioResponseState(nextState, request) });
    }

    if (body.action === "deleteFeedback") {
      const rating = normalizeRadioRatingPayload(body.rating);
      const phrase = typeof body.phrase === "string" ? body.phrase.trim().slice(0, 180) : "";
      if (!rating || !phrase) return NextResponse.json({ ok: false, error: "Feedback rating and phrase are required" }, { status: 400 });
      const styleId = normalizeRadioStyleId(body.styleId ?? state.selectedStyleId, state.customStyles, state.deletedStyleIds);
      const nextState = await mutateRadioState((s) => removeRadioFeedback(s, styleId, phrase, rating));
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, state: await buildRadioResponseState(nextState, request) });
    }

    if (body.action === "cleanup") {
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
      const nextState = cleanedTracks.length
        ? await mutateRadioState((s) => removeRadioTracksFromLineup(s, cleanedTracks))
        : state;
      startRadioQueueMaintenance(nextState);
      return NextResponse.json({ ok: true, cleanedTracks, state: await buildRadioResponseState(nextState, request) });
    }

    return NextResponse.json({ ok: false, error: "Unknown radio action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown radio error" }, { status: 500 });
  }
}

async function buildRadioResponseState(state: RadioState, request: NextRequest) {
  await enqueueMissingRatedTrackAssessments(state);
  const port = request.nextUrl.port || serverPort();
  const publicOrigin = resolvePublicRadioOrigin(request);
  const publicStreamUrl = buildRadioPublicStreamUrl(publicOrigin);
  const publicPlaylistUrls = buildRadioPlaylistUrls(resolveConfiguredPublicRadioOrigin(request));
  const lanStreamUrl = buildRadioLanStreamUrl(resolveLanIp(), port);
  const lanPlaylistUrls = buildRadioPlaylistUrls(lanStreamUrl);
  const streamState = buildRadioStreamState(state);
  const history = await attachLatestAssessmentsToTracks(streamState.history);
  const currentTrack = streamState.currentTrack
    ? history.find((track) => track.filename === streamState.currentTrack?.filename) ?? await attachLatestAssessmentToTrack(streamState.currentTrack)
    : undefined;
  return {
    ...streamState,
    history,
    currentTrack,
    stats: buildRadioStats(state, await getRadioAudioDiskBytes(state)),
    assessmentQueue: await getAudioAssessmentQueueStatus(),
    queueGeneration: buildRadioQueueGenerationStatus(state, isRadioQueueMaintenanceActive()),
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

function normalizeRadioRatingPayload(value: unknown): RadioRating | undefined {
  return value === "up" || value === "down" ? value : undefined;
}

function removeRadioFeedback(state: RadioState, styleId: string, phrase: string, rating: RadioRating): RadioState {
  const previous = state.preferences[styleId] ?? { likes: [], dislikes: [] };
  const nextPreference = {
    ...previous,
    likes: rating === "up" ? previous.likes.filter((item) => item !== phrase) : previous.likes,
    dislikes: rating === "down" ? previous.dislikes.filter((item) => item !== phrase) : previous.dislikes,
  };
  const preferences = { ...state.preferences };
  if (nextPreference.likes.length || nextPreference.dislikes.length || nextPreference.tasteProfile) {
    preferences[styleId] = nextPreference;
  } else {
    delete preferences[styleId];
  }

  const clearMatchingRating = (track: RadioTrackRecord) => {
    if (track.styleId !== styleId || track.prompt !== phrase || track.rating !== rating) return track;
    const { rating: _rating, ratedAt: _ratedAt, ...rest } = track;
    return rest;
  };

  return {
    ...state,
    preferences,
    currentTrack: state.currentTrack ? clearMatchingRating(state.currentTrack) : state.currentTrack,
    history: state.history.map(clearMatchingRating),
    updatedAt: new Date().toISOString(),
  };
}

function resolvePublicRadioOrigin(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!host) return undefined;
  const proto = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(/:$/, "")) || "https";
  return `${proto}://${host}`;
}

function resolveConfiguredPublicRadioOrigin(request: NextRequest) {
  const requestOrigin = resolvePublicRadioOrigin(request);
  return radioPublicOrigin() || (requestOrigin?.includes("radio.pardev.net") ? requestOrigin : "https://radio.pardev.net");
}

function resolveLanIp() {
  const override = radioLanHost() ?? lanIp();
  if (override) return override;
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return undefined;
}

async function listOllamaPromptModels() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), radioOllamaModelsTimeoutMs());
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

function radioStyleQueryParam(request: NextRequest, state: RadioState) {
  return normalizeRadioStyleUrlParam(
    request.nextUrl.searchParams.get("style") ?? request.nextUrl.searchParams.get("styleId"),
    state.customStyles,
    state.deletedStyleIds,
  );
}

function normalizePromptProvider(value: unknown): RadioPromptProvider | undefined {
  return value === "ollama" || value === "fallback" ? value : undefined;
}

function normalizeFallbackReason(value: unknown) {
  if (typeof value !== "string") return "queue_refill_timeout";
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "queue_refill_timeout";
}

function findRatedAssessmentTrack(track: RadioTrackRecord | undefined, rating: RadioRating | undefined) {
  if (!track || !rating) return undefined;
  return track;
}

async function attachLatestAssessmentsToTracks(tracks: RadioTrackRecord[]) {
  return Promise.all(tracks.map(attachLatestAssessmentToTrack));
}

async function attachLatestAssessmentToTrack(track: RadioTrackRecord): Promise<RadioTrackRecord> {
  const metadata = await readTrackMetadata(track);
  const latestAssessment = metadata.latestAssessment;
  if (!latestAssessment || typeof latestAssessment !== "object") return track;
  return { ...track, latestAssessment: latestAssessment as RadioTrackRecord["latestAssessment"] };
}

async function enqueueMissingRatedTrackAssessments(state: RadioState) {
  let queuedCount = 0;
  const seenFilenames = new Set<string>();
  for (const track of state.history) {
    if (seenFilenames.has(track.filename)) continue;
    seenFilenames.add(track.filename);
    const rating = resolveTrackAssessmentRating(track, state);
    if (!rating || !isSafeAudioFilename(track.filename) || !track.filename.toLowerCase().endsWith(".mp3")) continue;
    try {
      const audioInfo = await stat(outputPathForAudio(outputDir(), track.filename));
      if (!audioInfo.isFile()) continue;
    } catch {
      continue;
    }
    const metadata = await readTrackMetadata(track);
    if (hasAssessmentMetadata(metadata)) continue;
    await enqueueAudioAssessment({
      filename: track.filename,
      source: "radio",
      title: track.title,
      prompt: track.prompt,
      styleId: track.styleId,
      rating,
    });
    queuedCount += 1;
  }
  if (queuedCount > 0) void startAudioAssessmentQueueProcessing();
}

function resolveTrackAssessmentRating(track: RadioTrackRecord, state: RadioState): RadioRating | undefined {
  if (track.rating === "up" || track.rating === "down") return track.rating;
  const preference = state.preferences[track.styleId];
  if (preference?.likes.includes(track.prompt)) return "up";
  if (preference?.dislikes.includes(track.prompt)) return "down";
  return undefined;
}

function hasAssessmentMetadata(metadata: Record<string, unknown>) {
  if (metadata.latestAssessment && typeof metadata.latestAssessment === "object") return true;
  if (Array.isArray(metadata.assessments) && metadata.assessments.length > 0) return true;
  const assessmentQueue = metadata.assessmentQueue && typeof metadata.assessmentQueue === "object"
    ? metadata.assessmentQueue as Record<string, unknown>
    : undefined;
  const status = assessmentQueue?.status;
  return status === "queued" || status === "done" || status === "failed";
}

function isNotFoundError(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
