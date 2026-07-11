// Shared types for the radio station subsystem.
//
// Pure type declarations only — no runtime values. Consumed by every other
// `lib/radio/*` submodule and re-exported through the package index so the
// existing `@/lib/radio` import path keeps working unchanged.

import type { AudioAssessment, AudioAssessmentQueueStatus } from "../audio-assessment";

/** Unique identifier for a radio station style preset. */
export type RadioStyleId = string;
/** Listener thumbs-up/down rating applied to a played track. */
export type RadioRating = "up" | "down";
/** Source of the prompt used to draft a track's generation prompt. */
export type RadioPromptProvider = "ollama" | "fallback";
/** Origin of a queue track, either freshly generated or reused from the library. */
export type RadioTrackSource = "generated" | "library-fallback";
/** Supported TTS providers for DJ announcements between tracks. */
export type RadioTtsProvider = "openai" | "elevenlabs" | "deepgram" | "gemini" | "kokoro-onnx";

/** Definition of a station style preset: label plus seed/negative prompts. */
export type RadioStyle = {
  id: RadioStyleId;
  label: string;
  seedPrompt: string;
  negativePrompt: string;
};

/** Mutable draft of a style preset (no id yet), with an optional model override. */
export type RadioStyleDraft = Omit<RadioStyle, "id"> & {
  model?: string;
};

/** User-configured TTS settings for DJ announcements. */
export type RadioTtsConfig = {
  ttsProvider: RadioTtsProvider;
  ttsVoice: string;
  announcementPrefix: string;
  announcementSuffix: string;
};

/** Selectable TTS voice option surfaced to the UI. */
export type RadioTtsVoiceOption = {
  id: string;
  label: string;
  description?: string;
};

/** Per-style listener preference state, including optional distilled taste profile. */
export type RadioPreference = {
  likes: string[];
  dislikes: string[];
  tasteProfile?: RadioTasteProfile;
};

/** Maps each style id to the track id currently positioned for playback. */
export type RadioQueuePositions = Partial<Record<RadioStyleId, string>>;

/** Distilled listener taste profile derived from thumbs up/down feedback via codex-cli. */
export type RadioTasteProfile = {
  likedTraits: string[];
  dislikedTraits: string[];
  promptDirectives: string[];
  negativePromptDirectives: string[];
  explorationNotes: string[];
  updatedAt: string;
  sourceEventCount: number;
  provider: "codex-cli";
  model: string;
};

/** Input shape for regenerating a taste profile from accumulated feedback traits. */
export type RadioTasteProfileInput = Partial<Pick<
  RadioTasteProfile,
  "likedTraits" | "dislikedTraits" | "promptDirectives" | "negativePromptDirectives" | "explorationNotes"
>>;

/** A drafted (possibly pending) generation prompt for a future track. */
export type RadioPromptDraft = {
  id: string;
  title: string;
  prompt: string;
  negativePrompt: string;
  styleId: RadioStyleId;
  createdAt: string;
  promptProvider: RadioPromptProvider;
  promptModel: string;
  rawResponse?: string;
};

/** Full record of a track in the station: queue entry plus playback and assessment metadata. */
export type RadioTrackRecord = {
  id: string;
  filename: string;
  title: string;
  prompt: string;
  styleId: RadioStyleId;
  announce: boolean;
  createdAt: string;
  promptProvider?: RadioPromptProvider;
  promptModel?: string;
  source?: RadioTrackSource;
  fallbackReason?: string;
  announcementFilename?: string;
  durationSeconds?: number;
  fileSizeBytes?: number;
  rating?: RadioRating;
  ratedAt?: string;
  latestAssessment?: AudioAssessment;
};

/** Aggregate station statistics: counts of tracks, ratings, and disk usage. */
export type RadioStats = {
  generatedSongCount: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  audioDiskBytes: number;
};

/** Live status of background queue generation toward its target depth. */
export type RadioQueueGenerationStatus = {
  status: "idle" | "queued" | "generating";
  pendingCount: number;
  queueAheadCount: number;
  queueTarget: number;
};

/** Persisted station configuration and runtime state: styles, preferences, queue positions, and history. */
export type RadioState = {
  selectedStyleId: RadioStyleId;
  announceEnabled: boolean;
  songLengthMinutes: number;
  unlikedTrackExpirationHours: number;
  promptModel: string;
  ttsProvider: RadioTtsProvider;
  ttsVoice: string;
  announcementPrefix: string;
  announcementSuffix: string;
  customStyles: RadioStyle[];
  deletedStyleIds: RadioStyleId[];
  preferences: Partial<Record<RadioStyleId, RadioPreference>>;
  currentTrackByStyle: RadioQueuePositions;
  currentDraft?: RadioPromptDraft;
  currentTrack?: RadioTrackRecord;
  currentTrackStartedAt?: string;
  history: RadioTrackRecord[];
  updatedAt: string;
};

/** Server-side station state extended with stream URLs, queue depth, and live status for the /api/radio response. */
export type RadioStreamState = RadioState & {
  styles: RadioStyle[];
  streamReady: boolean;
  queueAheadCount: number;
  queueTarget: number;
  needsQueueFill: boolean;
  streamUrl?: string;
  lanStreamUrl?: string;
  publicPlaylistUrls?: RadioPlaylistUrls;
  lanPlaylistUrls?: RadioPlaylistUrls;
  stats?: RadioStats;
  assessmentQueue?: AudioAssessmentQueueStatus;
  queueGeneration?: RadioQueueGenerationStatus;
};

/** Playlist container format offered to external players. */
export type RadioPlaylistFormat = "m3u" | "pls";
/** Stream URLs keyed by playlist format, one per format offered. */
export type RadioPlaylistUrls = Record<RadioPlaylistFormat, string>;
