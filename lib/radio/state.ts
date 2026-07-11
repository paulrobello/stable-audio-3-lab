// Pure radio state-machine: defaults, state normalization, all state transitions,
// track-record creation, queue introspection, cleanup, and stream-state/stats
// builders. Every function here is pure (takes state, returns state) —
// persistence is owned by `lib/server/radio-state-store.ts`.
//
// The style *mutators* (`createRadioStyle`, `updateRadioStyle`,
// `deleteRadioStyle`) live here rather than in `./styles` because they apply
// state-machine transitions (they call `selectRadioStyle`); placing them in
// `./styles` would create a styles↔state import cycle.

import type {
  RadioState,
  RadioStyleId,
  RadioStyle,
  RadioRating,
  RadioPromptProvider,
  RadioTrackSource,
  RadioTrackRecord,
  RadioStats,
  RadioQueueGenerationStatus,
  RadioStreamState,
  RadioQueuePositions,
  RadioPreference,
} from "./types";
import { cleanShortText, compactTimestamp, randomSuffix, nextTimestamp } from "./_internal";
import {
  radioStyles,
  getAvailableRadioStyles,
  normalizeRadioStyleId,
  getRadioStyle,
  normalizeCustomRadioStyles,
  normalizeDeletedRadioStyleIds,
  makeUniqueRadioStyleId,
} from "./styles";
import { normalizeOllamaPromptModel, DEFAULT_PROMPT_MODEL } from "./prompts";
import {
  normalizeRadioTtsConfig,
  DEFAULT_TTS_PROVIDER,
  DEFAULT_TTS_VOICE,
  DEFAULT_ANNOUNCEMENT_PREFIX,
  DEFAULT_ANNOUNCEMENT_SUFFIX,
} from "./tts";

const DEFAULT_RADIO_SONG_LENGTH_MINUTES = 2;
const DEFAULT_UNLIKED_TRACK_EXPIRATION_HOURS = 24;
const RADIO_QUEUE_TARGET = 3;
const RADIO_HISTORY_LIMIT = 50;
const STREAM_URL = "/api/radio?stream=1";
/** Allowed song-length options (in minutes) for generated radio tracks. */
export const radioSongLengthMinuteOptions = [1, 2, 3, 4, 5, 6] as const;
/** Allowed unliked-track expiration options (in hours) before cleanup eligibility. */
export const radioUnlikedTrackExpirationHourOptions = [1, 6, 12, 24, 48, 72, 168] as const;

/** Returns a fresh radio state populated with built-in defaults, stamped at `now`. */
export function defaultRadioState(now = new Date().toISOString()): RadioState {
  return {
    selectedStyleId: "synthwave",
    announceEnabled: true,
    songLengthMinutes: DEFAULT_RADIO_SONG_LENGTH_MINUTES,
    unlikedTrackExpirationHours: DEFAULT_UNLIKED_TRACK_EXPIRATION_HOURS,
    promptModel: DEFAULT_PROMPT_MODEL,
    ttsProvider: DEFAULT_TTS_PROVIDER,
    ttsVoice: DEFAULT_TTS_VOICE,
    announcementPrefix: DEFAULT_ANNOUNCEMENT_PREFIX,
    announcementSuffix: DEFAULT_ANNOUNCEMENT_SUFFIX,
    customStyles: [],
    deletedStyleIds: [],
    preferences: {},
    currentTrackByStyle: {},
    history: [],
    updatedAt: now,
  };
}

/** Coerces arbitrary persisted input into a valid `RadioState`, filling defaults and reconciling per-style queue positions. */
export function normalizeRadioState(input: Partial<RadioState> | undefined): RadioState {
  const parsed = input ?? {};
  const defaults = defaultRadioState();
  const history = Array.isArray(parsed.history) ? parsed.history : [];
  const customStyles = normalizeCustomRadioStyles(parsed.customStyles);
  const deletedStyleIds = normalizeDeletedRadioStyleIds(parsed.deletedStyleIds);
  const selectedStyleId = normalizeRadioStyleId(parsed.selectedStyleId, customStyles, deletedStyleIds);
  const currentTrackByStyle = normalizeRadioQueuePositions(parsed.currentTrackByStyle, history, customStyles, deletedStyleIds);
  if (parsed.currentTrack?.filename && parsed.currentTrack.styleId) {
    currentTrackByStyle[normalizeRadioStyleId(parsed.currentTrack.styleId, customStyles, deletedStyleIds)] ??= parsed.currentTrack.filename;
  }
  const currentTrackStartedAt = parsed.currentTrack
    ? normalizeRadioTimestamp(parsed.currentTrackStartedAt) ?? defaults.updatedAt
    : undefined;
  return alignRadioStateToSelectedStyle({
    ...defaults,
    ...parsed,
    selectedStyleId,
    songLengthMinutes: normalizeRadioSongLengthMinutes(parsed.songLengthMinutes),
    unlikedTrackExpirationHours: normalizeRadioUnlikedTrackExpirationHours(parsed.unlikedTrackExpirationHours),
    promptModel: normalizeOllamaPromptModel(parsed.promptModel),
    ...normalizeRadioTtsConfig(parsed as Record<string, unknown>),
    customStyles,
    deletedStyleIds,
    preferences: parsed.preferences ?? {},
    currentTrackByStyle,
    currentTrackStartedAt,
    history,
  });
}

/** Returns `"up"` or `"down"` only for the recognized rating literals, otherwise `null`. */
export function normalizeRadioRating(value: unknown): RadioRating | null {
  return value === "up" || value === "down" ? value : null;
}

/** Coerces a value to a valid song-length minute option, falling back to the default. */
export function normalizeRadioSongLengthMinutes(value: unknown): number {
  const minutes = typeof value === "number" ? value : Number(value);
  return radioSongLengthMinuteOptions.includes(minutes as (typeof radioSongLengthMinuteOptions)[number])
    ? minutes
    : DEFAULT_RADIO_SONG_LENGTH_MINUTES;
}

/** Coerces a value to a valid expiration-hour option, falling back to the default. */
export function normalizeRadioUnlikedTrackExpirationHours(value: unknown): number {
  const hours = typeof value === "number" ? value : Number(value);
  return radioUnlikedTrackExpirationHourOptions.includes(hours as (typeof radioUnlikedTrackExpirationHourOptions)[number])
    ? hours
    : DEFAULT_UNLIKED_TRACK_EXPIRATION_HOURS;
}

/** Creates a custom style and selects it, returning the new state and style; `undefined` if label/prompt validation fails. */
export function createRadioStyle(
  state: RadioState,
  input: { label?: unknown; seedPrompt?: unknown; negativePrompt?: unknown },
): { state: RadioState; style: RadioStyle } | undefined {
  const label = typeof input.label === "string" ? cleanShortText(input.label, "", 80) : "";
  const seedPrompt = typeof input.seedPrompt === "string" ? cleanShortText(input.seedPrompt, "", 1000) : "";
  const negativePrompt = typeof input.negativePrompt === "string"
    ? cleanShortText(input.negativePrompt, "vocals, clipping, harsh noise", 500)
    : "vocals, clipping, harsh noise";
  if (label.length < 2 || seedPrompt.length < 8) return undefined;

  const style: RadioStyle = {
    id: makeUniqueRadioStyleId(label, getAvailableRadioStyles(state)),
    label,
    seedPrompt,
    negativePrompt,
  };
  const nextState = selectRadioStyle({
    ...state,
    customStyles: [...state.customStyles, style],
    updatedAt: nextTimestamp(state.updatedAt),
  }, style.id);
  return { state: nextState, style };
}

/** Updates an existing style's fields (promoting a deleted built-in back into customStyles); `undefined` if not found or invalid. */
export function updateRadioStyle(
  state: RadioState,
  input: { styleId?: unknown; label?: unknown; seedPrompt?: unknown; negativePrompt?: unknown },
): { state: RadioState; style: RadioStyle } | undefined {
  const styleId = typeof input.styleId === "string" ? input.styleId.trim() : "";
  const existing = getAvailableRadioStyles(state).find((style) => style.id === styleId);
  if (!existing) return undefined;
  const label = typeof input.label === "string" ? cleanShortText(input.label, "", 80) : "";
  const seedPrompt = typeof input.seedPrompt === "string" ? cleanShortText(input.seedPrompt, "", 1000) : "";
  const negativePrompt = typeof input.negativePrompt === "string"
    ? cleanShortText(input.negativePrompt, "vocals, clipping, harsh noise", 500)
    : "vocals, clipping, harsh noise";
  if (label.length < 2 || seedPrompt.length < 8) return undefined;
  const style: RadioStyle = { id: existing.id, label, seedPrompt, negativePrompt };
  const hasCustomStyle = state.customStyles.some((item) => item.id === existing.id);
  const nextState = {
    ...state,
    customStyles: hasCustomStyle
      ? state.customStyles.map((item) => item.id === existing.id ? style : item)
      : [...state.customStyles, style],
    deletedStyleIds: state.deletedStyleIds.filter((id) => id !== existing.id),
    updatedAt: nextTimestamp(state.updatedAt),
  };
  return { state: nextState, style };
}

/** Removes a style (soft-deletes built-ins, prunes custom) and realigns the selection; `undefined` if not found. */
export function deleteRadioStyle(state: RadioState, styleIdInput: unknown): { state: RadioState; deletedStyle: RadioStyle } | undefined {
  const styleId = typeof styleIdInput === "string" ? styleIdInput.trim() : "";
  const deletedStyle = getAvailableRadioStyles(state).find((style) => style.id === styleId);
  if (!deletedStyle) return undefined;
  const isBuiltInStyle = radioStyles.some((style) => style.id === styleId);
  const customStyles = state.customStyles.filter((style) => style.id !== styleId);
  const deletedStyleIds = isBuiltInStyle ? pushUniqueLimited(state.deletedStyleIds, styleId, 30) : state.deletedStyleIds;
  const { [styleId]: _removedPreference, ...preferences } = state.preferences;
  const { [styleId]: _removedPosition, ...currentTrackByStyle } = state.currentTrackByStyle;
  const selectedStyleId = state.selectedStyleId === styleId
    ? normalizeRadioStyleId(undefined, customStyles, deletedStyleIds)
    : normalizeRadioStyleId(state.selectedStyleId, customStyles, deletedStyleIds);
  const stateWithoutDeletedStyle = alignRadioStateToSelectedStyle({
    ...state,
    selectedStyleId,
    customStyles,
    deletedStyleIds,
    preferences,
    currentTrack: state.currentTrack?.styleId === styleId ? undefined : state.currentTrack,
    currentTrackByStyle,
    updatedAt: nextTimestamp(state.updatedAt),
  });
  return { state: stateWithoutDeletedStyle, deletedStyle };
}

/** Sets the active style and realigns the current track, resetting playback start if the current track changed. */
export function selectRadioStyle(state: RadioState, styleIdInput: unknown): RadioState {
  const selectedStyleId = normalizeRadioStyleId(styleIdInput, state.customStyles, state.deletedStyleIds);
  const updatedAt = nextTimestamp(state.updatedAt);
  const aligned = alignRadioStateToSelectedStyle({ ...state, selectedStyleId });
  return setRadioPlaybackStartIfCurrentChanged({ ...aligned, updatedAt }, state.currentTrack, updatedAt);
}

/** Applies a thumbs up/down phrase to a style's preferences and stamps the current/history track record with the rating. */
export function recordRadioRating(state: RadioState, styleIdInput: unknown, phraseInput: unknown, ratingInput: unknown): RadioState {
  const rating = normalizeRadioRating(ratingInput);
  const phrase = typeof phraseInput === "string" ? phraseInput.trim().slice(0, 180) : "";
  if (!rating || !phrase) return state;

  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles, state.deletedStyleIds);
  const previous = state.preferences[styleId] ?? { likes: [], dislikes: [] };
  const removesExistingLike = rating === "up" && previous.likes.includes(phrase);
  const nextPreference: RadioPreference = {
    likes: rating === "up"
      ? (removesExistingLike ? previous.likes.filter((item) => item !== phrase) : pushUniqueLimited(previous.likes, phrase, 20))
      : previous.likes.filter((item) => item !== phrase),
    dislikes: rating === "down" ? pushUniqueLimited(previous.dislikes, phrase, 20) : previous.dislikes.filter((item) => item !== phrase),
    ...(previous.tasteProfile ? { tasteProfile: previous.tasteProfile } : {}),
  };
  const applyRating = (track: RadioTrackRecord) => {
    if (track.filename !== state.currentTrack?.filename) return track;
    if (removesExistingLike) {
      const { rating: _rating, ratedAt: _ratedAt, ...rest } = track;
      return rest;
    }
    return { ...track, rating, ratedAt: nextTimestamp(track.ratedAt ?? state.updatedAt) };
  };

  return {
    ...state,
    preferences: { ...state.preferences, [styleId]: nextPreference },
    currentTrack: state.currentTrack ? applyRating(state.currentTrack) : state.currentTrack,
    history: state.history.map(applyRating),
    updatedAt: nextTimestamp(state.updatedAt),
  };
}

/** Builds a `RadioTrackRecord` from generation outputs with cleaned, clamped metadata and a unique id. */
export function createRadioTrackRecord({
  filename,
  title,
  prompt,
  styleId,
  announce,
  promptProvider,
  promptModel,
  source,
  fallbackReason,
  announcementFilename,
  durationSeconds,
  fileSizeBytes,
}: {
  filename: string;
  title: string;
  prompt: string;
  styleId: RadioStyleId;
  announce: boolean;
  promptProvider?: RadioPromptProvider;
  promptModel?: string;
  source?: RadioTrackSource;
  fallbackReason?: string;
  announcementFilename?: string;
  durationSeconds?: number;
  fileSizeBytes?: number;
}): RadioTrackRecord {
  const createdAt = new Date().toISOString();
  return {
    id: `track-${compactTimestamp(createdAt)}-${randomSuffix()}`,
    filename,
    title: cleanShortText(title, filename.replace(/\.(mp3|wav)$/i, ""), 120),
    prompt: cleanShortText(prompt, getRadioStyle(styleId).seedPrompt, 1000),
    styleId,
    announce,
    createdAt,
    ...(promptProvider ? { promptProvider } : {}),
    ...(promptModel ? { promptModel: normalizeOllamaPromptModel(promptModel) } : {}),
    ...(source ? { source } : {}),
    ...(fallbackReason ? { fallbackReason: cleanShortText(fallbackReason, "fallback", 120) } : {}),
    ...(announcementFilename ? { announcementFilename } : {}),
    ...(durationSeconds && Number.isFinite(durationSeconds) ? { durationSeconds: Math.max(1, Math.min(Math.round(durationSeconds), 3600)) } : {}),
    ...(fileSizeBytes && Number.isFinite(fileSizeBytes) ? { fileSizeBytes: Math.max(1, Math.round(fileSizeBytes)) } : {}),
  };
}

/** Inserts a track into the per-style lineup, updates the current pointer, caps history, and selects its style. */
export function registerRadioTrack(state: RadioState, track: RadioTrackRecord): RadioState {
  const existing = state.history.filter((item) => item.filename !== track.filename);
  const existingCurrentTrack = findCurrentTrackForStyle({ ...state, history: existing }, track.styleId);
  const currentIndex = existingCurrentTrack
    ? existing.findIndex((item) => item.filename === existingCurrentTrack.filename)
    : -1;
  const insertIndex = currentIndex >= 0
    ? findRadioQueueInsertIndex(existing, currentIndex, track.styleId)
    : existing.length;
  const history = existing.length
    ? [...existing.slice(0, insertIndex), track, ...existing.slice(insertIndex)]
    : [track];
  const currentTrack = findCurrentTrackForStyle({ ...state, history }, track.styleId) ?? track;
  const cappedHistory = capRadioHistory(history, currentTrack);
  const updatedAt = nextTimestamp(state.updatedAt);
  return setRadioPlaybackStartIfCurrentChanged({
    ...state,
    selectedStyleId: track.styleId,
    currentTrack,
    currentTrackByStyle: {
      ...state.currentTrackByStyle,
      [track.styleId]: currentTrack.filename,
    },
    history: cappedHistory,
    updatedAt,
  }, state.currentTrack, updatedAt);
}

function findRadioQueueInsertIndex(history: RadioTrackRecord[], currentIndex: number, styleId: RadioStyleId) {
  let insertIndex = currentIndex + 1;
  for (let index = currentIndex + 1; index < history.length; index += 1) {
    if (history[index].styleId === styleId) insertIndex = index + 1;
  }
  return insertIndex;
}

/** Overwrites a track record in-place across current/history without altering queue position. */
export function replaceRadioTrackInLineup(state: RadioState, track: RadioTrackRecord): RadioState {
  const currentTrackByStyle = state.currentTrackByStyle[track.styleId] === track.filename
    ? { ...state.currentTrackByStyle, [track.styleId]: track.filename }
    : state.currentTrackByStyle;
  return {
    ...state,
    currentTrack: state.currentTrack?.filename === track.filename ? track : state.currentTrack,
    currentTrackByStyle,
    history: state.history.map((item) => item.filename === track.filename ? track : item),
    updatedAt: nextTimestamp(state.updatedAt),
  };
}

/** Selects a history track (mp3 only) as current, switching to its style and resetting playback start. */
export function selectRadioTrack(state: RadioState, filenameInput: unknown): { state: RadioState; selectedTrack?: RadioTrackRecord } {
  const filename = typeof filenameInput === "string" ? filenameInput.trim() : "";
  const selectedTrack = state.history.find((track) => track.filename === filename && track.filename.toLowerCase().endsWith(".mp3"));
  if (!selectedTrack) return { state };
  const updatedAt = nextTimestamp(state.updatedAt);
  return {
    selectedTrack,
    state: {
      ...state,
      selectedStyleId: selectedTrack.styleId,
      currentTrack: selectedTrack,
      currentTrackByStyle: {
        ...state.currentTrackByStyle,
        [selectedTrack.styleId]: selectedTrack.filename,
      },
      currentTrackStartedAt: updatedAt,
      updatedAt,
    },
  };
}

/** Removes the current track from history and advances to the next same-style mp3 (or clears it). */
export function rejectCurrentRadioTrack(state: RadioState): { state: RadioState; rejectedTrack?: RadioTrackRecord } {
  const rejectedTrack = state.currentTrack;
  if (!rejectedTrack) return { state };
  const currentIndex = state.history.findIndex((track) => track.filename === rejectedTrack.filename);
  const remainingHistory = state.history.filter((track) => track.filename !== rejectedTrack.filename);
  const nextTrack = remainingHistory
    .slice(Math.max(currentIndex, 0))
    .find((track) => track.styleId === rejectedTrack.styleId && isRadioMp3Track(track))
    ?? remainingHistory.find((track) => track.styleId === rejectedTrack.styleId && isRadioMp3Track(track));
  const currentTrackByStyle = { ...state.currentTrackByStyle };
  if (nextTrack) currentTrackByStyle[rejectedTrack.styleId] = nextTrack.filename;
  else delete currentTrackByStyle[rejectedTrack.styleId];
  const updatedAt = nextTimestamp(state.updatedAt);
  return {
    rejectedTrack,
    state: {
      ...state,
      currentTrack: nextTrack,
      currentTrackByStyle,
      history: remainingHistory,
      currentTrackStartedAt: nextTrack ? updatedAt : undefined,
      updatedAt,
    },
  };
}

/** Advances the current pointer to the next same-style mp3 in the queue; no-op if none remains. */
export function advanceRadioCurrentTrack(state: RadioState, nowInput?: string): RadioState {
  if (!state.currentTrack) return state;
  const currentIndex = state.history.findIndex((track) => track.filename === state.currentTrack?.filename);
  const styleId = state.currentTrack.styleId;
  const nextTrack = state.history.slice(Math.max(currentIndex + 1, 0)).find((track) => track.styleId === styleId && isRadioMp3Track(track));
  if (!nextTrack) return state;
  const updatedAt = clampRadioAdvanceTimestampToTrackCreation(normalizeRadioTimestamp(nowInput) ?? nextTimestamp(state.updatedAt), nextTrack);
  return {
    ...state,
    currentTrack: nextTrack,
    currentTrackByStyle: {
      ...state.currentTrackByStyle,
      [styleId]: nextTrack.filename,
    },
    currentTrackStartedAt: updatedAt,
    updatedAt,
  };
}

function clampRadioAdvanceTimestampToTrackCreation(timestamp: string, track: RadioTrackRecord) {
  const timestampMs = Date.parse(timestamp);
  const createdAtMs = Date.parse(track.createdAt);
  if (!Number.isFinite(timestampMs) || !Number.isFinite(createdAtMs) || createdAtMs <= timestampMs) return timestamp;
  return new Date(createdAtMs).toISOString();
}

/** Advances the current track as far as elapsed playback duration warrants relative to `now`. */
export function synchronizeRadioPlayback(state: RadioState, nowInput = new Date().toISOString()): RadioState {
  const nowMs = Date.parse(nowInput);
  if (!Number.isFinite(nowMs) || !state.currentTrack) return state;
  let nextState = state.currentTrackStartedAt ? state : { ...state, currentTrackStartedAt: nowInput };
  let startedMs = Date.parse(nextState.currentTrackStartedAt ?? "");
  if (!Number.isFinite(startedMs)) return { ...nextState, currentTrackStartedAt: nowInput };

  while (nextState.currentTrack) {
    const durationMs = radioTrackDurationSeconds(nextState, nextState.currentTrack) * 1000;
    if (durationMs <= 0 || nowMs - startedMs < durationMs) break;
    const advancedAt = new Date(startedMs + durationMs).toISOString();
    const advanced = advanceRadioCurrentTrack(nextState, advancedAt);
    if (advanced.currentTrack?.filename === nextState.currentTrack.filename) break;
    nextState = advanced;
    startedMs = Date.parse(nextState.currentTrackStartedAt ?? advancedAt);
    if (!Number.isFinite(startedMs)) break;
  }

  return nextState;
}

/** Returns seconds elapsed in the current track, clamped to its duration (0 if not playing). */
export function getRadioPlaybackElapsedSeconds(state: RadioState, nowInput = new Date().toISOString()) {
  if (!state.currentTrack || !state.currentTrackStartedAt) return 0;
  const startedMs = Date.parse(state.currentTrackStartedAt);
  const nowMs = Date.parse(nowInput);
  if (!Number.isFinite(startedMs) || !Number.isFinite(nowMs) || nowMs <= startedMs) return 0;
  const elapsedSeconds = Math.floor((nowMs - startedMs) / 1000);
  return Math.min(elapsedSeconds, radioTrackDurationSeconds(state, state.currentTrack));
}

/** Returns how many same-style mp3 tracks remain after the current one in the queue. */
export function getRadioQueueAheadCount(state: RadioState) {
  if (!state.currentTrack) return state.history.filter((track) => track.styleId === state.selectedStyleId && isRadioMp3Track(track)).length;
  const currentIndex = state.history.findIndex((track) => track.filename === state.currentTrack?.filename);
  const styleId = state.currentTrack.styleId;
  if (currentIndex < 0) return state.history.filter((track) => track.styleId === styleId && isRadioMp3Track(track)).length;
  return state.history.slice(currentIndex + 1).filter((track) => track.styleId === styleId && isRadioMp3Track(track)).length;
}

/** Returns true when queued-ahead tracks fall below the target, signaling more generation is needed. */
export function shouldGenerateRadioQueueTrack(state: RadioState, targetAhead = 3) {
  return getRadioQueueAheadCount(state) < targetAhead;
}

/** Returns non-liked mp3 tracks older than the expiration window, eligible for deletion. */
export function findRadioTracksForCleanup(state: RadioState, nowInput = new Date().toISOString(), maxAgeHours = state.unlikedTrackExpirationHours) {
  const now = Date.parse(nowInput);
  if (!Number.isFinite(now)) return [];
  const maxAgeMs = normalizeRadioUnlikedTrackExpirationHours(maxAgeHours) * 60 * 60 * 1000;
  return state.history.filter((track) => {
    if (track.rating === "up") return false;
    if (!track.filename.toLowerCase().endsWith(".mp3")) return false;
    const createdAt = Date.parse(track.createdAt);
    return Number.isFinite(createdAt) && now - createdAt >= maxAgeMs;
  });
}

/** Returns later duplicate-title mp3 tracks (not current, not liked) past the minimum age, for dedupe cleanup. */
export function findDuplicateRadioTitleTracks(state: RadioState, nowInput = new Date().toISOString(), minAgeMinutes = 10) {
  const now = Date.parse(nowInput);
  if (!Number.isFinite(now)) return [];
  const minAgeMs = Math.max(0, minAgeMinutes) * 60 * 1000;
  const seen = new Set<string>();
  return state.history.filter((track) => {
    const titleKey = track.title.trim().toLowerCase();
    if (!titleKey) return false;
    if (!seen.has(titleKey)) {
      seen.add(titleKey);
      return false;
    }
    const createdAt = Date.parse(track.createdAt);
    if (!Number.isFinite(createdAt) || now - createdAt < minAgeMs) return false;
    return track.filename !== state.currentTrack?.filename && track.rating !== "up" && track.filename.toLowerCase().endsWith(".mp3");
  });
}

/** Drops the given tracks from history and recomputes the current pointer and queue positions. */
export function removeRadioTracksFromLineup(state: RadioState, tracks: RadioTrackRecord[]): RadioState {
  const filenames = new Set(tracks.map((track) => track.filename));
  if (!filenames.size) return state;
  const history = state.history.filter((track) => !filenames.has(track.filename));
  const currentTrack = state.currentTrack && !filenames.has(state.currentTrack.filename)
    ? state.currentTrack
    : findCurrentTrackForStyle({ ...state, history, currentTrack: undefined }, state.selectedStyleId);
  const updatedAt = nextTimestamp(state.updatedAt);
  return setRadioPlaybackStartIfCurrentChanged({
    ...alignRadioStateToSelectedStyle({
      ...state,
      currentTrack,
      currentTrackByStyle: rebuildRadioQueuePositions(state, history),
      history,
    }),
    currentTrack,
    history,
    updatedAt,
  }, state.currentTrack, updatedAt);
}

/** Projects state into a `RadioStreamState` snapshot with stream readiness, queue fill, and stream URL. */
export function buildRadioStreamState(state: RadioState): RadioStreamState {
  const streamReady = !!state.currentTrack?.filename.toLowerCase().endsWith(".mp3");
  const queueAheadCount = getRadioQueueAheadCount(state);
  const queueGeneration = buildRadioQueueGenerationStatus(state);
  return {
    ...state,
    styles: getAvailableRadioStyles(state),
    streamReady,
    queueAheadCount,
    queueTarget: RADIO_QUEUE_TARGET,
    needsQueueFill: queueAheadCount < RADIO_QUEUE_TARGET,
    queueGeneration,
    ...(streamReady ? { streamUrl: STREAM_URL } : {}),
  };
}

/** Builds the queue-generation status (generating/queued/idle) and pending-count from current fill. */
export function buildRadioQueueGenerationStatus(state: RadioState, active = false): RadioQueueGenerationStatus {
  const queueAheadCount = getRadioQueueAheadCount(state);
  const pendingCount = Math.max(0, RADIO_QUEUE_TARGET - queueAheadCount);
  return {
    status: active ? "generating" : pendingCount > 0 ? "queued" : "idle",
    pendingCount,
    queueAheadCount,
    queueTarget: RADIO_QUEUE_TARGET,
  };
}

/** Computes aggregate stats: generated-song count, thumbs up/down totals, and audio disk usage. */
export function buildRadioStats(state: RadioState, audioDiskBytes = 0): RadioStats {
  const preferences = Object.values(state.preferences);
  return {
    generatedSongCount: state.history.filter((track) => isRadioGeneratedSong(track)).length,
    thumbsUpCount: preferences.reduce((sum, preference) => sum + (preference?.likes.length ?? 0), 0),
    thumbsDownCount: preferences.reduce((sum, preference) => sum + (preference?.dislikes.length ?? 0), 0),
    audioDiskBytes: Math.max(0, Math.round(Number.isFinite(audioDiskBytes) ? audioDiskBytes : 0)),
  };
}

function isRadioGeneratedSong(track: RadioTrackRecord) {
  return track.source !== "library-fallback" && track.filename.toLowerCase().endsWith(".mp3");
}

function normalizeRadioQueuePositions(value: unknown, history: RadioTrackRecord[], customStyles: RadioStyle[] = [], deletedStyleIds: RadioStyleId[] = []): RadioQueuePositions {
  if (!value || typeof value !== "object") return {};
  const positions: RadioQueuePositions = {};
  for (const [styleIdInput, filename] of Object.entries(value)) {
    const styleId = normalizeRadioStyleId(styleIdInput, customStyles, deletedStyleIds);
    if (typeof filename !== "string") continue;
    if (history.some((track) => track.styleId === styleId && track.filename === filename)) {
      positions[styleId] = filename;
    }
  }
  return positions;
}

function rebuildRadioQueuePositions(state: RadioState, history: RadioTrackRecord[]): RadioQueuePositions {
  const rebuilt: RadioQueuePositions = {};
  for (const style of getAvailableRadioStyles(state)) {
    const current = findCurrentTrackForStyle({ ...state, history }, style.id);
    if (current) rebuilt[style.id] = current.filename;
  }
  return rebuilt;
}

function capRadioHistory(history: RadioTrackRecord[], currentTrack: RadioTrackRecord | undefined) {
  if (history.length <= RADIO_HISTORY_LIMIT) return history;
  if (!currentTrack) return history.slice(0, RADIO_HISTORY_LIMIT);
  const currentIndex = history.findIndex((track) => track.filename === currentTrack.filename);
  if (currentIndex < 0) return history.slice(-RADIO_HISTORY_LIMIT);
  const currentAndQueued = history.slice(currentIndex);
  if (currentAndQueued.length >= RADIO_HISTORY_LIMIT) return currentAndQueued.slice(0, RADIO_HISTORY_LIMIT);
  const previous = history.slice(0, currentIndex).slice(-(RADIO_HISTORY_LIMIT - currentAndQueued.length));
  return [...previous, ...currentAndQueued];
}

function alignRadioStateToSelectedStyle(state: RadioState): RadioState {
  const currentTrack = findCurrentTrackForStyle(state, state.selectedStyleId);
  const currentTrackByStyle = { ...state.currentTrackByStyle };
  if (currentTrack) currentTrackByStyle[state.selectedStyleId] = currentTrack.filename;
  else delete currentTrackByStyle[state.selectedStyleId];
  return {
    ...state,
    currentTrack,
    currentTrackByStyle,
  };
}

function findCurrentTrackForStyle(state: RadioState, styleIdInput: unknown): RadioTrackRecord | undefined {
  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles, state.deletedStyleIds);
  const savedFilename = state.currentTrackByStyle[styleId];
  const savedTrack = savedFilename
    ? state.history.find((track) => track.styleId === styleId && track.filename === savedFilename)
    : undefined;
  if (savedTrack) return savedTrack;
  if (state.currentTrack?.styleId === styleId && state.history.some((track) => track.filename === state.currentTrack?.filename)) {
    return state.currentTrack;
  }
  return state.history.find((track) => track.styleId === styleId && isRadioMp3Track(track))
    ?? state.history.find((track) => track.styleId === styleId);
}

function isRadioMp3Track(track: RadioTrackRecord) {
  return track.filename.toLowerCase().endsWith(".mp3");
}

function pushUniqueLimited(values: string[], value: string, limit: number) {
  return [...values.filter((item) => item !== value), value].slice(-limit);
}

function normalizeRadioTimestamp(value: unknown) {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function setRadioPlaybackStartIfCurrentChanged(state: RadioState, previousTrack: RadioTrackRecord | undefined, startedAt: string) {
  if (!state.currentTrack) return { ...state, currentTrackStartedAt: undefined };
  if (state.currentTrack.filename === previousTrack?.filename && state.currentTrackStartedAt) return state;
  return { ...state, currentTrackStartedAt: startedAt };
}

function radioTrackDurationSeconds(state: RadioState, track: RadioTrackRecord) {
  const duration = track.durationSeconds ?? state.songLengthMinutes * 60;
  return Math.max(1, Math.round(Number.isFinite(duration) ? duration : DEFAULT_RADIO_SONG_LENGTH_MINUTES * 60));
}
