// Radio queue maintenance, generation+registration, fallback scanning, and
// track lifecycle (metadata writes + audio removal).
//
// Extracted verbatim from `app/api/radio/route.ts`. Every state mutation goes
// through `mutateRadioState` from the locked, atomic state store
// (`@/lib/server/radio-state-store`) — there are no direct `fs` reads/writes of
// `.stable-audio-radio/state.json` here.
//
// The background queue loop (`maintainRadioQueue`) holds a state snapshot
// across multi-minute generations; it re-reads state INSIDE the lock when it
// registers a track so a thumbs-up recorded by a POST during that window is
// preserved rather than clobbered (the ARC-002 fix).

import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildRadioPromptGeneratorMessages,
  buildRadioStreamState,
  createFallbackRadioPromptDraft,
  createRadioTrackRecord,
  findDuplicateRadioTitleTracks,
  findRadioTracksForCleanup,
  normalizeRadioSongLengthMinutes,
  normalizeRadioStyleId,
  parseRadioPromptDraft,
  registerRadioTrack,
  removeRadioTracksFromLineup,
  resolveRadioAnnouncementFilename,
  type RadioState,
  type RadioTrackRecord,
} from "@/lib/radio";
import { normalizeGenerationRequest } from "@/lib/generation";
import { buildGeneratorArgs, resolveGenerationBackend } from "@/lib/generator-backend";
import { buildLibraryMetadata, isFavoriteMetadata, isSafeAudioFilename, metadataPathForAudio, outputPathForAudio, titleToFilename } from "@/lib/library";
import { withGenerationSlot } from "./concurrency";
import { mutateRadioState, readRadioState, statePath } from "./radio-state-store";
import { ollamaGenerateUrl } from "./ollama";
import { createAnnouncementIfEnabled } from "./radio-tts";
import { runCommand } from "./subprocess";
import { logError, logWarn } from "./logger";
import {
  radioQueueAutoFillDisabled,
  radioOllamaTimeoutMs,
  stableAudioBackend,
  stableAudioMock,
  stableAudioPython,
  stableAudioTimeoutMs,
} from "./config";

const outputDir = () => path.join(process.cwd(), "public", "outputs");

// In-flight maintenance tasks keyed by state-file path. The Map is pinned to
// globalThis so the "only one maintenance loop per state file" invariant
// survives Next.js dev HMR (which re-evaluates module scope and would otherwise
// build a fresh Map and spawn a parallel loop against the same state file). The
// generation slot semaphore (@/lib/server/concurrency) bounds actual
// concurrency; this Map only deduplicates the loop.
const RADIO_QUEUE_SINGLETON_KEY = "__stableAudioRadioQueue__";
type RadioQueueSingletons = { maintenance: Map<string, Promise<void>> };
function radioQueueStore(): RadioQueueSingletons {
  const g = globalThis as unknown as Partial<Record<typeof RADIO_QUEUE_SINGLETON_KEY, RadioQueueSingletons>>;
  if (!g[RADIO_QUEUE_SINGLETON_KEY]) g[RADIO_QUEUE_SINGLETON_KEY] = { maintenance: new Map() };
  return g[RADIO_QUEUE_SINGLETON_KEY]!;
}
const radioQueueMaintenance = radioQueueStore().maintenance;

export function startRadioQueueMaintenance(state: RadioState) {
  if (radioQueueAutoFillDisabled()) return;
  if (!buildRadioStreamState(state).needsQueueFill) return;
  const key = statePath();
  if (radioQueueMaintenance.has(key)) return;
  const task = maintainRadioQueue(state).finally(() => {
    if (radioQueueMaintenance.get(key) === task) radioQueueMaintenance.delete(key);
  });
  radioQueueMaintenance.set(key, task);
}

export function isRadioQueueMaintenanceActive() {
  return radioQueueMaintenance.has(statePath());
}

async function maintainRadioQueue(initialState?: RadioState) {
  let state = await cleanRadioQueue(initialState ?? await readRadioState());
  let generatedCount = 0;
  const maxGenerations = buildRadioStreamState(state).queueTarget + 1;

  while (buildRadioStreamState(state).needsQueueFill && generatedCount < maxGenerations) {
    const draft = await draftWithOllama(state, state.selectedStyleId, state.promptModel);
    try {
      state = await generateAndRegisterRadioTrack(state, draft);
    } catch (error) {
      // Behavior-changing fallback: a failed queue generation is replaced by a
      // starred library track (if any). Log so a chronically failing generator
      // (model OOM, bad config) is visible instead of the station quietly
      // replaying favorites forever (QA-006).
      logError("Radio queue generation failed; substituting a starred library fallback track", error, {
        styleId: state.selectedStyleId,
      });
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
  const nextState = cleanedTracks.length
    ? await mutateRadioState((s) => removeRadioTracksFromLineup(s, cleanedTracks))
    : state;
  return nextState;
}

export async function draftWithOllama(state: RadioState, styleId: ReturnType<typeof normalizeRadioStyleId>, promptModel: string) {
  const messages = buildRadioPromptGeneratorMessages(state, styleId, promptModel);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), radioOllamaTimeoutMs());

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
  } catch (error) {
    // Behavior-changing fallback: the Ollama-drafted prompt is replaced by a
    // deterministic fallback draft so the queue keeps filling, but the station
    // becomes repetitive. Warn so Ollama being down is diagnosable (QA-006).
    logWarn("Radio Ollama prompt draft failed; using fallback prompt draft", {
      error: error instanceof Error ? error.message : String(error),
      styleId,
      promptModel,
    });
    return createFallbackRadioPromptDraft(state, styleId, promptModel);
  } finally {
    clearTimeout(timeout);
  }
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
  const python = stableAudioPython();
  const mock = stableAudioMock();
  const backend = resolveGenerationBackend({ envBackend: stableAudioBackend(), mock });
  const args = buildGeneratorArgs({
    scriptPath: path.join(process.cwd(), "scripts", "generate_audio.py"),
    outputPath: outPath,
    input,
    backend,
    mock,
  });
  const startedAt = Date.now();
  const result = await withGenerationSlot(() => runStableAudioGeneratorProcess(python, args, stableAudioTimeoutMs()));
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
  // Re-read state INSIDE the lock so a thumbs-up / taste change recorded by a
  // POST during this multi-minute generation is preserved rather than
  // overwritten by the stale snapshot held across `withGenerationSlot`.
  const nextState = await mutateRadioState((s) => registerRadioTrack({ ...s, currentDraft: undefined }, finalTrack));
  return nextState;
}

async function runStableAudioGeneratorProcess(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  // Delegates to the shared runner (ARC-007 / QA-002): previously this attached
  // only a `close` handler, so a missing Python binary (ENOENT) emitted `error`
  // without `close` and the queue loop hung silently. The shared runner always
  // attaches an `error` handler and escalates SIGTERM → SIGKILL on timeout.
  return runCommand(command, args, { timeoutMs });
}

export async function registerStarredLibraryFallbackTrack(state: RadioState, reason: string) {
  const track = await buildStarredLibraryFallbackTrack(state, reason);
  if (!track) return undefined;
  const announcementFilename = await createAnnouncementIfEnabled(track, state);
  const finalTrack = announcementFilename ? { ...track, announcementFilename } : track;
  await writeTrackRadioMetadata(finalTrack, state);
  const nextState = await mutateRadioState((s) => registerRadioTrack({ ...s, currentDraft: undefined }, finalTrack));
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

export async function writeTrackRadioMetadata(track: RadioTrackRecord, state: RadioState) {
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

export async function readAudioFileSizeBytes(filename: string) {
  try {
    return (await stat(outputPathForAudio(outputDir(), filename))).size;
  } catch {
    return undefined;
  }
}

export async function readTrackMetadata(track: RadioTrackRecord) {
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

export async function removeRejectedTrackAudio(track: RadioTrackRecord) {
  await markRetainedRejectedTrackMetadata(track, { rejectedAt: new Date().toISOString(), removalReason: "thumbs_down" });
}

export async function removeExpiredTrackAudio(track: RadioTrackRecord) {
  await removeTrackAudio(track, { expiredAt: new Date().toISOString(), removalReason: "expired_unliked" });
}

export async function removeDuplicateTrackAudio(track: RadioTrackRecord) {
  await removeTrackAudio(track, { duplicateRemovedAt: new Date().toISOString(), removalReason: "duplicate_title" });
}

export async function removeDeletedTrackAudio(track: RadioTrackRecord, state: RadioState) {
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

async function markRetainedRejectedTrackMetadata(track: RadioTrackRecord, removalMetadata: Record<string, unknown>) {
  const audioPath = outputPathForAudio(outputDir(), track.filename);
  const metaPath = metadataPathForAudio(audioPath);
  const meta = await readTrackMetadata(track);
  const previousRadio = meta.radio && typeof meta.radio === "object" ? meta.radio as Record<string, unknown> : {};
  const updated = {
    ...meta,
    radio: {
      ...previousRadio,
      ...removalMetadata,
      retainedForAssessment: true,
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
