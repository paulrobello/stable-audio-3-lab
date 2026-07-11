// Shared types for the radio station subsystem.
//
// Pure type declarations only — no runtime values. Consumed by every other
// `lib/radio/*` submodule and re-exported through the package index so the
// existing `@/lib/radio` import path keeps working unchanged.

import type { AudioAssessment, AudioAssessmentQueueStatus } from "../audio-assessment";

export type RadioStyleId = string;
export type RadioRating = "up" | "down";
export type RadioPromptProvider = "ollama" | "fallback";
export type RadioTrackSource = "generated" | "library-fallback";
export type RadioTtsProvider = "openai" | "elevenlabs" | "deepgram" | "gemini" | "kokoro-onnx";

export type RadioStyle = {
  id: RadioStyleId;
  label: string;
  seedPrompt: string;
  negativePrompt: string;
};

export type RadioStyleDraft = Omit<RadioStyle, "id"> & {
  model?: string;
};

export type RadioTtsConfig = {
  ttsProvider: RadioTtsProvider;
  ttsVoice: string;
  announcementPrefix: string;
  announcementSuffix: string;
};

export type RadioTtsVoiceOption = {
  id: string;
  label: string;
  description?: string;
};

export type RadioPreference = {
  likes: string[];
  dislikes: string[];
  tasteProfile?: RadioTasteProfile;
};

export type RadioQueuePositions = Partial<Record<RadioStyleId, string>>;

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

export type RadioTasteProfileInput = Partial<Pick<
  RadioTasteProfile,
  "likedTraits" | "dislikedTraits" | "promptDirectives" | "negativePromptDirectives" | "explorationNotes"
>>;

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

export type RadioStats = {
  generatedSongCount: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  audioDiskBytes: number;
};

export type RadioQueueGenerationStatus = {
  status: "idle" | "queued" | "generating";
  pendingCount: number;
  queueAheadCount: number;
  queueTarget: number;
};

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

export type RadioPlaylistFormat = "m3u" | "pls";
export type RadioPlaylistUrls = Record<RadioPlaylistFormat, string>;
