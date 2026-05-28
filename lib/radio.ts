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
};

export type RadioStats = {
  generatedSongCount: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  audioDiskBytes: number;
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
  preferences: Partial<Record<RadioStyleId, RadioPreference>>;
  currentTrackByStyle: RadioQueuePositions;
  currentDraft?: RadioPromptDraft;
  currentTrack?: RadioTrackRecord;
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
};

export type RadioPlaylistFormat = "m3u" | "pls";
export type RadioPlaylistUrls = Record<RadioPlaylistFormat, string>;

export const radioOllamaModels = [
  "llama3.1:8b",
  "gemma3:12b",
  "phi4:14b",
  "qwen2.5:14b",
  "mistral-small:24b",
  "gemma3:27b",
] as const;

export const radioStyles: RadioStyle[] = [
  {
    id: "synthwave",
    label: "Synthwave Night Drive",
    seedPrompt: "instrumental synthwave, warm analog bass, neon pads, clean punchy drums, 112 BPM, no vocals",
    negativePrompt: "muddy low end, harsh cymbals, distorted clipping, vocals",
  },
  {
    id: "ambient",
    label: "Ambient Signal Drift",
    seedPrompt: "slow evolving ambient instrumental, wide pads, gentle arpeggios, spacious reverb, soft texture",
    negativePrompt: "busy drums, abrupt transitions, harsh noise, vocals",
  },
  {
    id: "cinematic",
    label: "Cinematic Trailer Pulse",
    seedPrompt: "cinematic instrumental cue, pulsing low strings, restrained brass swells, deep percussion, dramatic arc",
    negativePrompt: "cartoon sounds, thin drums, brittle synths, vocals",
  },
  {
    id: "lofi",
    label: "Lofi Study Loop",
    seedPrompt: "lofi hip hop instrumental, dusty drums, mellow rhodes chords, warm tape saturation, 82 BPM",
    negativePrompt: "overly bright hats, harsh clipping, aggressive lead synths, vocals",
  },
  {
    id: "experimental",
    label: "Experimental Machine Folk",
    seedPrompt: "experimental instrumental, organic plucks, glitchy tape loops, subtle modular synth pulses, intimate mix",
    negativePrompt: "random noise wall, novelty sounds, abrasive clipping, vocals",
  },
];

const DEFAULT_PROMPT_MODEL = radioOllamaModels[0];
const DEFAULT_TTS_PROVIDER: RadioTtsProvider = "openai";
const DEFAULT_TTS_VOICE = "nova";
const DEFAULT_ANNOUNCEMENT_PREFIX = "Now playing: ";
const DEFAULT_ANNOUNCEMENT_SUFFIX = "";
const STREAM_URL = "/api/radio?stream=1";
const RADIO_STATION_TITLE = "Stable Audio 3 Lab Radio";
const RADIO_QUEUE_TARGET = 3;
const RADIO_HISTORY_LIMIT = 50;
const DEFAULT_RADIO_SONG_LENGTH_MINUTES = 2;
const DEFAULT_UNLIKED_TRACK_EXPIRATION_HOURS = 24;
export const radioSongLengthMinuteOptions = [1, 2, 3, 4, 5, 6] as const;
export const radioUnlikedTrackExpirationHourOptions = [1, 6, 12, 24, 48, 72, 168] as const;

const radioTtsVoicesByProvider: Record<RadioTtsProvider, RadioTtsVoiceOption[]> = {
  openai: [
    { id: "nova", label: "Nova", description: "Warm and friendly" },
    { id: "alloy", label: "Alloy", description: "Neutral and balanced" },
    { id: "ash", label: "Ash", description: "Enthusiastic and energetic" },
    { id: "ballad", label: "Ballad", description: "Warm and soulful" },
    { id: "coral", label: "Coral", description: "Friendly and approachable" },
    { id: "echo", label: "Echo", description: "Smooth and articulate" },
    { id: "fable", label: "Fable", description: "Expressive and animated" },
    { id: "onyx", label: "Onyx", description: "Deep and authoritative" },
    { id: "sage", label: "Sage", description: "Calm and wise" },
    { id: "shimmer", label: "Shimmer", description: "Soft and gentle" },
    { id: "verse", label: "Verse", description: "Clear and melodic" },
    { id: "marin", label: "Marin", description: "Gentle and soothing" },
    { id: "cedar", label: "Cedar", description: "Rich and resonant" },
  ],
  elevenlabs: [
    { id: "Juniper", label: "Juniper" },
  ],
  deepgram: [
    { id: "aura-2-thalia-en", label: "Thalia", description: "American, feminine, clear and energetic" },
    { id: "aura-2-andromeda-en", label: "Andromeda", description: "American, feminine, casual and expressive" },
    { id: "aura-2-helena-en", label: "Helena", description: "American, feminine, caring and natural" },
    { id: "aura-2-apollo-en", label: "Apollo", description: "American, masculine, confident and casual" },
    { id: "aura-2-arcas-en", label: "Arcas", description: "American, masculine, natural and smooth" },
    { id: "aura-2-aries-en", label: "Aries", description: "American, masculine, warm and energetic" },
    { id: "aura-asteria-en", label: "Asteria (Aura-1)", description: "American, feminine, knowledgeable" },
    { id: "aura-luna-en", label: "Luna (Aura-1)", description: "American, feminine, friendly" },
  ],
  gemini: [
    { id: "Kore", label: "Kore", description: "Firm" },
    { id: "Zephyr", label: "Zephyr", description: "Bright" },
    { id: "Puck", label: "Puck", description: "Upbeat" },
    { id: "Charon", label: "Charon", description: "Informative" },
    { id: "Fenrir", label: "Fenrir", description: "Excitable" },
    { id: "Leda", label: "Leda", description: "Youthful" },
    { id: "Orus", label: "Orus", description: "Firm" },
    { id: "Aoede", label: "Aoede", description: "Breezy" },
    { id: "Callirrhoe", label: "Callirrhoe", description: "Easy-going" },
    { id: "Autonoe", label: "Autonoe", description: "Bright" },
    { id: "Enceladus", label: "Enceladus", description: "Breathy" },
    { id: "Iapetus", label: "Iapetus", description: "Clear" },
    { id: "Umbriel", label: "Umbriel", description: "Easy-going" },
    { id: "Algieba", label: "Algieba", description: "Smooth" },
    { id: "Despina", label: "Despina", description: "Smooth" },
    { id: "Erinome", label: "Erinome", description: "Clear" },
    { id: "Algenib", label: "Algenib", description: "Gravelly" },
    { id: "Rasalgethi", label: "Rasalgethi", description: "Informative" },
    { id: "Laomedeia", label: "Laomedeia", description: "Upbeat" },
    { id: "Achernar", label: "Achernar", description: "Soft" },
    { id: "Alnilam", label: "Alnilam", description: "Firm" },
    { id: "Schedar", label: "Schedar", description: "Even" },
    { id: "Gacrux", label: "Gacrux", description: "Mature" },
    { id: "Pulcherrima", label: "Pulcherrima", description: "Forward" },
    { id: "Achird", label: "Achird", description: "Friendly" },
    { id: "Zubenelgenubi", label: "Zubenelgenubi", description: "Casual" },
    { id: "Vindemiatrix", label: "Vindemiatrix", description: "Gentle" },
    { id: "Sadachbia", label: "Sadachbia", description: "Lively" },
    { id: "Sadaltager", label: "Sadaltager", description: "Knowledgeable" },
    { id: "Sulafat", label: "Sulafat", description: "Warm" },
  ],
  "kokoro-onnx": [
    { id: "af_sarah", label: "Sarah" },
    { id: "af_alloy", label: "Alloy" },
    { id: "af_aoede", label: "Aoede" },
    { id: "af_bella", label: "Bella" },
    { id: "af_heart", label: "Heart" },
    { id: "af_jessica", label: "Jessica" },
    { id: "af_kore", label: "Kore" },
    { id: "af_nicole", label: "Nicole" },
    { id: "af_nova", label: "Nova" },
    { id: "af_river", label: "River" },
    { id: "af_sky", label: "Sky" },
    { id: "am_adam", label: "Adam" },
    { id: "am_echo", label: "Echo" },
    { id: "am_eric", label: "Eric" },
    { id: "am_fenrir", label: "Fenrir" },
    { id: "am_liam", label: "Liam" },
    { id: "am_michael", label: "Michael" },
    { id: "am_onyx", label: "Onyx" },
    { id: "am_puck", label: "Puck" },
    { id: "am_santa", label: "Santa" },
    { id: "bf_alice", label: "Alice" },
    { id: "bf_emma", label: "Emma" },
    { id: "bf_isabella", label: "Isabella" },
    { id: "bf_lily", label: "Lily" },
    { id: "bm_daniel", label: "Daniel" },
    { id: "bm_fable", label: "Fable" },
    { id: "bm_george", label: "George" },
    { id: "bm_lewis", label: "Lewis" },
  ],
};

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
    preferences: {},
    currentTrackByStyle: {},
    history: [],
    updatedAt: now,
  };
}

export function getAvailableRadioStyles(stateOrCustomStyles?: Pick<RadioState, "customStyles"> | RadioStyle[]): RadioStyle[] {
  const customStyles = Array.isArray(stateOrCustomStyles) ? stateOrCustomStyles : stateOrCustomStyles?.customStyles ?? [];
  const builtInIds = new Set(radioStyles.map((style) => style.id));
  return [
    ...radioStyles,
    ...customStyles.filter((style) => style.id && !builtInIds.has(style.id)),
  ];
}

export function normalizeRadioStyleId(value: unknown, customStyles: RadioStyle[] = []): RadioStyleId {
  return getAvailableRadioStyles(customStyles).some((style) => style.id === value) ? value as RadioStyleId : "synthwave";
}

export function normalizeRadioStyleUrlParam(value: unknown, customStyles: RadioStyle[] = []): RadioStyleId | undefined {
  return getAvailableRadioStyles(customStyles).some((style) => style.id === value) ? value as RadioStyleId : undefined;
}

export function normalizeRadioState(input: Partial<RadioState> | undefined): RadioState {
  const parsed = input ?? {};
  const history = Array.isArray(parsed.history) ? parsed.history : [];
  const customStyles = normalizeCustomRadioStyles(parsed.customStyles);
  const selectedStyleId = normalizeRadioStyleId(parsed.selectedStyleId, customStyles);
  const currentTrackByStyle = normalizeRadioQueuePositions(parsed.currentTrackByStyle, history, customStyles);
  if (parsed.currentTrack?.filename && parsed.currentTrack.styleId) {
    currentTrackByStyle[normalizeRadioStyleId(parsed.currentTrack.styleId, customStyles)] ??= parsed.currentTrack.filename;
  }
  return alignRadioStateToSelectedStyle({
    ...defaultRadioState(),
    ...parsed,
    selectedStyleId,
    songLengthMinutes: normalizeRadioSongLengthMinutes(parsed.songLengthMinutes),
    unlikedTrackExpirationHours: normalizeRadioUnlikedTrackExpirationHours(parsed.unlikedTrackExpirationHours),
    promptModel: normalizeOllamaPromptModel(parsed.promptModel),
    ...normalizeRadioTtsConfig(parsed as Record<string, unknown>),
    customStyles,
    preferences: parsed.preferences ?? {},
    currentTrackByStyle,
    history,
  });
}

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

export function updateRadioStyle(
  state: RadioState,
  input: { styleId?: unknown; label?: unknown; seedPrompt?: unknown; negativePrompt?: unknown },
): { state: RadioState; style: RadioStyle } | undefined {
  const styleId = typeof input.styleId === "string" ? input.styleId.trim() : "";
  const existing = state.customStyles.find((style) => style.id === styleId);
  if (!existing) return undefined;
  const label = typeof input.label === "string" ? cleanShortText(input.label, "", 80) : "";
  const seedPrompt = typeof input.seedPrompt === "string" ? cleanShortText(input.seedPrompt, "", 1000) : "";
  const negativePrompt = typeof input.negativePrompt === "string"
    ? cleanShortText(input.negativePrompt, "vocals, clipping, harsh noise", 500)
    : "vocals, clipping, harsh noise";
  if (label.length < 2 || seedPrompt.length < 8) return undefined;
  const style: RadioStyle = { id: existing.id, label, seedPrompt, negativePrompt };
  const nextState = {
    ...state,
    customStyles: state.customStyles.map((item) => item.id === existing.id ? style : item),
    updatedAt: nextTimestamp(state.updatedAt),
  };
  return { state: nextState, style };
}

export function deleteRadioStyle(state: RadioState, styleIdInput: unknown): { state: RadioState; deletedStyle: RadioStyle } | undefined {
  const styleId = typeof styleIdInput === "string" ? styleIdInput.trim() : "";
  const deletedStyle = state.customStyles.find((style) => style.id === styleId);
  if (!deletedStyle) return undefined;
  const customStyles = state.customStyles.filter((style) => style.id !== styleId);
  const { [styleId]: _removedPreference, ...preferences } = state.preferences;
  const { [styleId]: _removedPosition, ...currentTrackByStyle } = state.currentTrackByStyle;
  const selectedStyleId = state.selectedStyleId === styleId ? "synthwave" : normalizeRadioStyleId(state.selectedStyleId, customStyles);
  const stateWithoutDeletedStyle = alignRadioStateToSelectedStyle({
    ...state,
    selectedStyleId,
    customStyles,
    preferences,
    currentTrack: state.currentTrack?.styleId === styleId ? undefined : state.currentTrack,
    currentTrackByStyle,
    updatedAt: nextTimestamp(state.updatedAt),
  });
  return { state: stateWithoutDeletedStyle, deletedStyle };
}

export function buildRadioStyleGenerationPrompt(requestInput: unknown): string {
  const request = typeof requestInput === "string" ? cleanShortText(requestInput, "", 500) : "";
  return [
    "Create a custom Stable Audio 3 radio music style from the user's request.",
    "Do not directly imitate a named artist, song, score, or soundtrack, or copy recognizable melodies, lyrics, hooks, or production fingerprints.",
    "Translate references into broad, reusable musical traits such as instrumentation, tempo feel, arrangement arc, mood, mix character, and negative constraints.",
    "Return JSON only with string fields: label, seedPrompt, negativePrompt.",
    "Keep label under 40 characters. Keep seedPrompt under 700 characters. Keep negativePrompt under 300 characters.",
    "",
    `User request: ${request || "a distinctive instrumental radio style"}`,
    "",
    "Return JSON only.",
  ].join("\n");
}

export function parseRadioStyleDraft(rawResponse: string, requestInput: unknown): RadioStyleDraft | undefined {
  try {
    const parsed = JSON.parse(extractJsonObject(rawResponse)) as Partial<Record<"label" | "seedPrompt" | "negativePrompt", unknown>>;
    const request = typeof requestInput === "string" ? requestInput : "";
    const label = typeof parsed.label === "string" ? cleanShortText(parsed.label, "Custom Style", 80) : cleanShortText(request, "Custom Style", 80);
    const seedPrompt = typeof parsed.seedPrompt === "string" ? cleanShortText(parsed.seedPrompt, "", 1000) : "";
    const negativePrompt = typeof parsed.negativePrompt === "string"
      ? cleanShortText(parsed.negativePrompt, "direct artist imitation, recognizable melodies, vocals, clipping, harsh noise", 500)
      : "direct artist imitation, recognizable melodies, vocals, clipping, harsh noise";
    if (label.length < 2 || seedPrompt.length < 8) return undefined;
    return { label, seedPrompt, negativePrompt };
  } catch {
    return undefined;
  }
}

export function normalizeOllamaPromptModel(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_PROMPT_MODEL;
  const model = value.trim();
  if (!model || model.length > 80 || /[\s"'<>]/.test(model)) return DEFAULT_PROMPT_MODEL;
  return model;
}

export function normalizeRadioRating(value: unknown): RadioRating | null {
  return value === "up" || value === "down" ? value : null;
}

export function normalizeRadioSongLengthMinutes(value: unknown): number {
  const minutes = typeof value === "number" ? value : Number(value);
  return radioSongLengthMinuteOptions.includes(minutes as (typeof radioSongLengthMinuteOptions)[number])
    ? minutes
    : DEFAULT_RADIO_SONG_LENGTH_MINUTES;
}

export function normalizeRadioUnlikedTrackExpirationHours(value: unknown): number {
  const hours = typeof value === "number" ? value : Number(value);
  return radioUnlikedTrackExpirationHourOptions.includes(hours as (typeof radioUnlikedTrackExpirationHourOptions)[number])
    ? hours
    : DEFAULT_UNLIKED_TRACK_EXPIRATION_HOURS;
}

export function normalizeRadioTtsProvider(value: unknown): RadioTtsProvider {
  if (value === "kokoro") return "kokoro-onnx";
  return value === "elevenlabs" || value === "deepgram" || value === "gemini" || value === "openai" || value === "kokoro-onnx" ? value : DEFAULT_TTS_PROVIDER;
}

export function normalizeRadioTtsText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.replace(/\s+/g, " ").slice(0, 120);
}

export function normalizeRadioTtsVoice(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_TTS_VOICE;
  const voice = value.trim();
  if (!voice || voice.length > 80 || /["'<>]/.test(voice)) return DEFAULT_TTS_VOICE;
  return voice;
}

export function getRadioTtsVoiceOptions(providerInput: unknown, currentVoiceInput?: unknown): RadioTtsVoiceOption[] {
  const provider = normalizeRadioTtsProvider(providerInput);
  const voices = radioTtsVoicesByProvider[provider];
  const currentVoice = typeof currentVoiceInput === "string" ? normalizeRadioTtsVoice(currentVoiceInput) : "";
  if (!currentVoice || voices.some((voice) => voice.id === currentVoice)) return voices;
  return [{ id: currentVoice, label: currentVoice }, ...voices];
}

export function defaultRadioTtsVoice(providerInput: unknown): string {
  const provider = normalizeRadioTtsProvider(providerInput);
  return radioTtsVoicesByProvider[provider][0]?.id ?? DEFAULT_TTS_VOICE;
}

export function normalizeRadioTtsConfig(input: Partial<RadioTtsConfig> | Record<string, unknown>): RadioTtsConfig {
  return {
    ttsProvider: normalizeRadioTtsProvider(input.ttsProvider),
    ttsVoice: normalizeRadioTtsVoice(input.ttsVoice),
    announcementPrefix: normalizeRadioTtsText(input.announcementPrefix, DEFAULT_ANNOUNCEMENT_PREFIX),
    announcementSuffix: normalizeRadioTtsText(input.announcementSuffix, DEFAULT_ANNOUNCEMENT_SUFFIX),
  };
}

export function buildAnnouncementText(title: string, config: RadioTtsConfig): string {
  return cleanShortText(`${config.announcementPrefix}${title}${config.announcementSuffix}`, title, 240);
}

export function buildRadioAnnouncementFilename(track: Pick<RadioTrackRecord, "filename" | "title">, config: RadioTtsConfig & { ttsModel?: string }) {
  const audioBase = track.filename.replace(/\.[^.]+$/, "");
  const signature = [
    buildAnnouncementText(track.title, config),
    config.ttsProvider,
    config.ttsVoice,
    config.ttsModel ?? "",
  ].join(" ");
  return `radio_announce_${slugForFilename(audioBase, 48)}_${slugForFilename(signature, 36)}_${shortHash(signature)}.mp3`;
}

export function resolveRadioAnnouncementFilename(track: Pick<RadioTrackRecord, "announcementFilename">, metadata: unknown) {
  if (isSafeAnnouncementFilename(track.announcementFilename)) return track.announcementFilename;
  const metadataRecord = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  const radio = metadataRecord.radio && typeof metadataRecord.radio === "object" ? metadataRecord.radio as Record<string, unknown> : {};
  const filename = radio.announcementFilename;
  return isSafeAnnouncementFilename(filename) ? filename : undefined;
}

export function buildRadioTrackPlaybackFilenames(track: RadioTrackRecord, options: { skipAnnouncement?: boolean } = {}) {
  return [
    !options.skipAnnouncement && isSafeAnnouncementFilename(track.announcementFilename) ? track.announcementFilename : undefined,
    track.filename,
  ].filter((filename): filename is string => !!filename);
}

export function getRadioStyle(styleId: RadioStyleId, customStyles: RadioStyle[] = []) {
  return getAvailableRadioStyles(customStyles).find((style) => style.id === styleId) ?? radioStyles[0];
}

export function selectRadioStyle(state: RadioState, styleIdInput: unknown): RadioState {
  const selectedStyleId = normalizeRadioStyleId(styleIdInput, state.customStyles);
  return {
    ...alignRadioStateToSelectedStyle({ ...state, selectedStyleId }),
    updatedAt: nextTimestamp(state.updatedAt),
  };
}

export function recordRadioRating(state: RadioState, styleIdInput: unknown, phraseInput: unknown, ratingInput: unknown): RadioState {
  const rating = normalizeRadioRating(ratingInput);
  const phrase = typeof phraseInput === "string" ? phraseInput.trim().slice(0, 180) : "";
  if (!rating || !phrase) return state;

  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles);
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

export function buildRadioPromptSeed(state: RadioState, styleIdInput: unknown): string {
  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles);
  const style = getRadioStyle(styleId, state.customStyles);
  const preference = state.preferences[styleId];
  const likes = preference?.likes?.length ? `Lean into: ${preference.likes.slice(-6).join("; ")}` : "Lean into: fresh variations within the style.";
  const dislikes = preference?.dislikes?.length ? `Avoid repeating: ${preference.dislikes.slice(-6).join("; ")}` : "Avoid repeating: generic stock music, vocals, and brittle mixes.";
  const tasteProfile = buildRadioTasteProfileSeed(preference?.tasteProfile);
  const recentTitles = state.history.slice(-8).map((track) => track.title).filter(Boolean);
  const recentPrompts = state.history.slice(-3).map((track) => track.prompt).filter(Boolean);
  const uniqueness = recentTitles.length
    ? `Already queued titles: ${recentTitles.join("; ")}. Do not reuse these titles or near-identical arrangements.`
    : "Already queued titles: none. Create a clearly new title and arrangement.";
  const recentDirections = recentPrompts.length
    ? `Recent prompt directions to move away from: ${recentPrompts.join(" | ")}`
    : "Recent prompt directions to move away from: none.";

  return [
    `Style: ${style.label}`,
    `Base direction: ${style.seedPrompt}`,
    likes,
    dislikes,
    tasteProfile,
    uniqueness,
    recentDirections,
    `Default negative prompt: ${style.negativePrompt}`,
  ].filter(Boolean).join("\n");
}

export function buildRadioTasteDistillationPrompt(state: RadioState, styleIdInput: unknown): string {
  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles);
  const style = getRadioStyle(styleId, state.customStyles);
  const preference = state.preferences[styleId] ?? { likes: [], dislikes: [] };
  return [
    "Distill listener thumbs feedback into a compact Stable Audio 3 music taste profile.",
    "Use only the selected style feedback below. Do not infer from other station styles.",
    "Keep each array to at most 6 short, reusable phrases. Avoid copying whole prompts unless a whole phrase is genuinely reusable.",
    "Return JSON only with these string-array fields: likedTraits, dislikedTraits, promptDirectives, negativePromptDirectives, explorationNotes.",
    "",
    `Style: ${style.label}`,
    `Base direction: ${style.seedPrompt}`,
    `Default negative prompt: ${style.negativePrompt}`,
    "",
    "Thumbs up prompts:",
    formatThumbsList(preference.likes),
    "",
    "Thumbs down prompts:",
    formatThumbsList(preference.dislikes),
    "",
    "Return JSON only.",
  ].join("\n");
}

export function updateRadioTasteProfile(state: RadioState, styleIdInput: unknown, input: RadioTasteProfileInput, modelInput: unknown, now = new Date().toISOString()): RadioState {
  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles);
  const previous = state.preferences[styleId] ?? { likes: [], dislikes: [] };
  const sourceEventCount = previous.likes.length + previous.dislikes.length;
  const tasteProfile: RadioTasteProfile = {
    likedTraits: normalizeTasteProfileList(input.likedTraits),
    dislikedTraits: normalizeTasteProfileList(input.dislikedTraits),
    promptDirectives: normalizeTasteProfileList(input.promptDirectives),
    negativePromptDirectives: normalizeTasteProfileList(input.negativePromptDirectives),
    explorationNotes: normalizeTasteProfileList(input.explorationNotes),
    updatedAt: now,
    sourceEventCount,
    provider: "codex-cli",
    model: normalizeCodexTasteModel(modelInput),
  };
  return {
    ...state,
    preferences: {
      ...state.preferences,
      [styleId]: { ...previous, tasteProfile },
    },
    updatedAt: nextTimestamp(state.updatedAt),
  };
}

export function buildRadioPromptGeneratorMessages(state: RadioState, styleIdInput: unknown, modelInput: unknown) {
  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles);
  const model = normalizeOllamaPromptModel(modelInput);
  return {
    provider: "ollama" as const,
    model,
    system: [
      "You generate concise prompts for Stable Audio 3 music renders.",
      "This station is testing local Ollama prompt generation with 8B to 30B model sizes.",
      "Use listener thumbs-up and thumbs-down feedback to evolve taste for the selected style.",
      "Return JSON only with title, prompt, negativePrompt, and tasteNotes string fields.",
    ].join(" "),
    prompt: [
      buildRadioPromptSeed(state, styleId),
      `Create one new instrumental song prompt for the next radio track. Entropy seed: ${randomSuffix()}-${Date.now().toString(36)}.`,
      "Keep the prompt under 700 characters. Do not ask questions. Do not include markdown.",
      "Return JSON only.",
    ].join("\n\n"),
  };
}

export function createRadioPromptDraft({
  title,
  prompt,
  negativePrompt,
  styleId,
  promptProvider,
  promptModel,
  rawResponse,
  style,
}: {
  title: string;
  prompt: string;
  negativePrompt: string;
  styleId: RadioStyleId;
  promptProvider: RadioPromptProvider;
  promptModel: string;
  rawResponse?: string;
  style?: RadioStyle;
}): RadioPromptDraft {
  const createdAt = new Date().toISOString();
  const fallbackStyle = style ?? getRadioStyle(styleId);
  return {
    id: `draft-${compactTimestamp(createdAt)}-${randomSuffix()}`,
    title: cleanShortText(title, "Untitled Signal", 80),
    prompt: cleanShortText(prompt, fallbackStyle.seedPrompt, 1000),
    negativePrompt: cleanShortText(negativePrompt, fallbackStyle.negativePrompt, 500),
    styleId,
    createdAt,
    promptProvider,
    promptModel: normalizeOllamaPromptModel(promptModel),
    ...(rawResponse ? { rawResponse: rawResponse.slice(0, 4000) } : {}),
  };
}

export function createFallbackRadioPromptDraft(state: RadioState, styleIdInput: unknown, modelInput: unknown, nowInput = new Date().toISOString()): RadioPromptDraft {
  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles);
  const style = getRadioStyle(styleId, state.customStyles);
  const preference = state.preferences[styleId];
  const likedTexture = preference?.likes?.at(-1);
  const dislikedTexture = preference?.dislikes?.at(-1);
  const variants = [
    "Neon Arc",
    "Glass Horizon",
    "Pulse Vector",
    "Afterimage",
    "Signal Bloom",
    "Chrome Weather",
    "Velocity Drift",
    "Night Current",
  ];
  const variationSeed = `${compactTimestamp(nowInput)}-${state.history.length + 1}`;
  const usedTitles = new Set(state.history.map((track) => track.title));
  const variant = variants.find((name) => !usedTitles.has(`${style.label} ${name}`) && !usedTitles.has(`${style.label} ${name} Keeper`)) ?? `Signal ${state.history.length + 1}`;
  const title = makeUniqueRadioTrackTitle(`${style.label} ${likedTexture ? `${variant} Keeper` : variant}`, state.history);
  return createRadioPromptDraft({
    title,
    prompt: [style.seedPrompt, likedTexture ? `emphasize ${likedTexture}` : `add a fresh ${variant.toLowerCase()} melodic motif`, `variation seed ${variationSeed}`, "polished full-song intro and outro"].join(", "),
    negativePrompt: [style.negativePrompt, dislikedTexture ? `avoid ${dislikedTexture}` : ""].filter(Boolean).join(", "),
    styleId,
    style,
    promptProvider: "fallback",
    promptModel: normalizeOllamaPromptModel(modelInput),
  });
}

export function parseRadioPromptDraft(rawResponse: string, state: RadioState, styleIdInput: unknown, modelInput: unknown): RadioPromptDraft {
  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles);
  const style = getRadioStyle(styleId, state.customStyles);
  try {
    const parsed = JSON.parse(extractJsonObject(rawResponse)) as Partial<Record<"title" | "prompt" | "negativePrompt", unknown>>;
    const title = makeUniqueRadioTrackTitle(typeof parsed.title === "string" ? parsed.title : style.label, state.history);
    return createRadioPromptDraft({
      title,
      prompt: typeof parsed.prompt === "string" ? parsed.prompt : style.seedPrompt,
      negativePrompt: typeof parsed.negativePrompt === "string" ? parsed.negativePrompt : style.negativePrompt,
      styleId,
      style,
      promptProvider: "ollama",
      promptModel: normalizeOllamaPromptModel(modelInput),
      rawResponse,
    });
  } catch {
    return { ...createFallbackRadioPromptDraft(state, styleId, modelInput), rawResponse: rawResponse.slice(0, 4000) };
  }
}

export function makeUniqueRadioTrackTitle(titleInput: string, history: Pick<RadioTrackRecord, "title">[]): string {
  const title = cleanShortText(stripRadioKeeperSuffix(titleInput), "Untitled Signal", 80);
  const existingTitles = history.map((track) => cleanShortText(stripRadioKeeperSuffix(track.title), "", 120)).filter(Boolean);
  const titleKey = normalizeTitleKey(title);
  if (!existingTitles.some((existingTitle) => normalizeTitleKey(existingTitle) === titleKey)) return title;

  const numeric = splitLastTitleNumber(title);
  if (!numeric) {
    const escapedTitle = escapeRegExp(title);
    const familyPattern = new RegExp(`^${escapedTitle}(?:\\s+(\\d+))?$`, "i");
    const highest = existingTitles.reduce((currentHighest, existingTitle) => {
      const match = existingTitle.match(familyPattern);
      if (!match) return currentHighest;
      return Math.max(currentHighest, match[1] ? Number(match[1]) : 1);
    }, 1);
    return cleanShortText(`${title} ${highest + 1}`, title, 80);
  }

  const prefix = title.slice(0, numeric.start);
  const suffix = title.slice(numeric.end);
  const familyPattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)${escapeRegExp(suffix)}$`, "i");
  const highest = existingTitles.reduce((currentHighest, existingTitle) => {
    const match = existingTitle.match(familyPattern);
    return match ? Math.max(currentHighest, Number(match[1])) : currentHighest;
  }, numeric.value);
  const nextNumber = String(highest + 1).padStart(numeric.width, "0");
  return cleanShortText(`${prefix}${nextNumber}${suffix}`, title, 80);
}

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
  return {
    ...state,
    selectedStyleId: track.styleId,
    currentTrack,
    currentTrackByStyle: {
      ...state.currentTrackByStyle,
      [track.styleId]: currentTrack.filename,
    },
    history: cappedHistory,
    updatedAt: nextTimestamp(state.updatedAt),
  };
}

function findRadioQueueInsertIndex(history: RadioTrackRecord[], currentIndex: number, styleId: RadioStyleId) {
  let insertIndex = currentIndex + 1;
  for (let index = currentIndex + 1; index < history.length; index += 1) {
    if (history[index].styleId === styleId) insertIndex = index + 1;
  }
  return insertIndex;
}

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

export function selectRadioTrack(state: RadioState, filenameInput: unknown): { state: RadioState; selectedTrack?: RadioTrackRecord } {
  const filename = typeof filenameInput === "string" ? filenameInput.trim() : "";
  const selectedTrack = state.history.find((track) => track.filename === filename && track.filename.toLowerCase().endsWith(".mp3"));
  if (!selectedTrack) return { state };
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
      updatedAt: nextTimestamp(state.updatedAt),
    },
  };
}

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
  return {
    rejectedTrack,
    state: {
      ...state,
      currentTrack: nextTrack,
      currentTrackByStyle,
      history: remainingHistory,
      updatedAt: nextTimestamp(state.updatedAt),
    },
  };
}

export function advanceRadioCurrentTrack(state: RadioState): RadioState {
  if (!state.currentTrack) return state;
  const currentIndex = state.history.findIndex((track) => track.filename === state.currentTrack?.filename);
  const styleId = state.currentTrack.styleId;
  const nextTrack = state.history.slice(Math.max(currentIndex + 1, 0)).find((track) => track.styleId === styleId && isRadioMp3Track(track));
  if (!nextTrack) return state;
  return {
    ...state,
    currentTrack: nextTrack,
    currentTrackByStyle: {
      ...state.currentTrackByStyle,
      [styleId]: nextTrack.filename,
    },
    updatedAt: nextTimestamp(state.updatedAt),
  };
}

export function getRadioQueueAheadCount(state: RadioState) {
  if (!state.currentTrack) return state.history.filter((track) => track.styleId === state.selectedStyleId && isRadioMp3Track(track)).length;
  const currentIndex = state.history.findIndex((track) => track.filename === state.currentTrack?.filename);
  const styleId = state.currentTrack.styleId;
  if (currentIndex < 0) return state.history.filter((track) => track.styleId === styleId && isRadioMp3Track(track)).length;
  return state.history.slice(currentIndex + 1).filter((track) => track.styleId === styleId && isRadioMp3Track(track)).length;
}

export function shouldGenerateRadioQueueTrack(state: RadioState, targetAhead = 3) {
  return getRadioQueueAheadCount(state) < targetAhead;
}

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

export function removeRadioTracksFromLineup(state: RadioState, tracks: RadioTrackRecord[]): RadioState {
  const filenames = new Set(tracks.map((track) => track.filename));
  if (!filenames.size) return state;
  const history = state.history.filter((track) => !filenames.has(track.filename));
  const currentTrack = state.currentTrack && !filenames.has(state.currentTrack.filename)
    ? state.currentTrack
    : findCurrentTrackForStyle({ ...state, history, currentTrack: undefined }, state.selectedStyleId);
  return {
    ...alignRadioStateToSelectedStyle({
      ...state,
      currentTrack,
      currentTrackByStyle: rebuildRadioQueuePositions(state, history),
      history,
    }),
    currentTrack,
    history,
    updatedAt: nextTimestamp(state.updatedAt),
  };
}

export function buildRadioStreamState(state: RadioState): RadioStreamState {
  const streamReady = !!state.currentTrack?.filename.toLowerCase().endsWith(".mp3");
  const queueAheadCount = getRadioQueueAheadCount(state);
  return {
    ...state,
    styles: getAvailableRadioStyles(state),
    streamReady,
    queueAheadCount,
    queueTarget: RADIO_QUEUE_TARGET,
    needsQueueFill: queueAheadCount < RADIO_QUEUE_TARGET,
    ...(streamReady ? { streamUrl: STREAM_URL } : {}),
  };
}

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

export function buildRadioLanStreamUrl(lanIp: string | undefined, port: string | number | undefined, styleIdInput?: unknown) {
  const host = typeof lanIp === "string" ? lanIp.trim() : "";
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return undefined;
  const safePort = String(port ?? "3007").replace(/\D/g, "") || "3007";
  return appendRadioStyleParam(new URL(`http://${host}:${safePort}/api/radio?stream=1`), styleIdInput);
}

export function buildRadioPublicStreamUrl(origin: string | undefined, styleIdInput?: unknown) {
  const trimmed = typeof origin === "string" ? origin.trim() : "";
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.pathname = "/api/radio";
    url.search = "stream=1";
    url.hash = "";
    return appendRadioStyleParam(url, styleIdInput);
  } catch {
    return undefined;
  }
}

export function buildRadioPlaylistUrls(origin: string | undefined, styleIdInput?: unknown): RadioPlaylistUrls | undefined {
  const m3u = buildRadioRootUrl(origin, "/radio.m3u", styleIdInput);
  const pls = buildRadioRootUrl(origin, "/radio.pls", styleIdInput);
  return m3u && pls ? { m3u, pls } : undefined;
}

export function buildRadioTuneInStreamUrl(streamUrl: string) {
  const url = new URL(streamUrl);
  url.searchParams.set("icy", "1");
  return url.toString();
}

export function buildRadioPlaylistContent(format: RadioPlaylistFormat, streamUrl: string, title = RADIO_STATION_TITLE) {
  if (format === "m3u") {
    return [
      "#EXTM3U",
      `#EXTINF:-1,${title}`,
      streamUrl,
      "",
    ].join("\n");
  }
  return [
    "[playlist]",
    "NumberOfEntries=1",
    `File1=${streamUrl}`,
    `Title1=${title}`,
    "Length1=-1",
    "Version=2",
    "",
  ].join("\n");
}

function buildRadioRootUrl(origin: string | undefined, pathname: string, styleIdInput?: unknown) {
  const trimmed = typeof origin === "string" ? origin.trim() : "";
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.pathname = pathname;
    url.search = "";
    url.hash = "";
    return appendRadioStyleParam(url, styleIdInput);
  } catch {
    return undefined;
  }
}

function appendRadioStyleParam(url: URL, styleIdInput: unknown) {
  const styleId = normalizeRadioStyleUrlParam(styleIdInput);
  if (styleId) url.searchParams.set("style", styleId);
  return url.toString();
}

export function readRadioEnvFileValue(contents: string, key: string) {
  const keyPattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(.*)\\s*$`);
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(keyPattern);
    if (!match) continue;
    return match[1].trim().replace(/^['"]|['"]$/g, "") || undefined;
  }
  return undefined;
}

export function readRadioConfigFileValue(contents: string, key: string) {
  const keyPattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.*)\\s*$`);
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(keyPattern);
    if (!match) continue;
    const rawValue = stripYamlInlineComment(match[1].trim()).trim().replace(/^['"]|['"]$/g, "");
    return rawValue || undefined;
  }
  return undefined;
}

function stripYamlInlineComment(value: string) {
  let quote: string | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === "'" || char === "\"") && value[index - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (char === "#" && !quote && /\s/.test(value[index - 1] ?? "")) {
      return value.slice(0, index);
    }
  }
  return value;
}

function normalizeCustomRadioStyles(value: unknown): RadioStyle[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set(radioStyles.map((style) => style.id));
  const customStyles: RadioStyle[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const input = item as Partial<RadioStyle>;
    const label = typeof input.label === "string" ? cleanShortText(input.label, "", 80) : "";
    const seedPrompt = typeof input.seedPrompt === "string" ? cleanShortText(input.seedPrompt, "", 1000) : "";
    if (label.length < 2 || seedPrompt.length < 8) continue;
    const idInput = typeof input.id === "string" ? slugForStyleId(input.id) : slugForStyleId(label);
    const id = idInput && !seen.has(idInput) ? idInput : makeUniqueRadioStyleId(label, [...radioStyles, ...customStyles]);
    seen.add(id);
    customStyles.push({
      id,
      label,
      seedPrompt,
      negativePrompt: typeof input.negativePrompt === "string"
        ? cleanShortText(input.negativePrompt, "vocals, clipping, harsh noise", 500)
        : "vocals, clipping, harsh noise",
    });
  }
  return customStyles.slice(-30);
}

function normalizeRadioQueuePositions(value: unknown, history: RadioTrackRecord[], customStyles: RadioStyle[] = []): RadioQueuePositions {
  if (!value || typeof value !== "object") return {};
  const positions: RadioQueuePositions = {};
  for (const [styleIdInput, filename] of Object.entries(value)) {
    const styleId = normalizeRadioStyleId(styleIdInput, customStyles);
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
  const styleId = normalizeRadioStyleId(styleIdInput, state.customStyles);
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

function buildRadioTasteProfileSeed(profile: RadioTasteProfile | undefined) {
  if (!profile) return "";
  const lines = [
    formatTasteProfileLine("Liked traits", profile.likedTraits),
    formatTasteProfileLine("Disliked traits", profile.dislikedTraits),
    formatTasteProfileLine("Prompt directives", profile.promptDirectives),
    formatTasteProfileLine("Negative prompt directives", profile.negativePromptDirectives),
    formatTasteProfileLine("Exploration notes", profile.explorationNotes),
  ].filter(Boolean);
  return lines.length ? ["Distilled listener taste:", ...lines].join("\n") : "";
}

function formatTasteProfileLine(label: string, values: string[]) {
  return values.length ? `${label}: ${values.join("; ")}` : "";
}

function formatThumbsList(values: string[]) {
  return values.length ? values.slice(-12).map((value) => `- ${value}`).join("\n") : "- none";
}

function normalizeTasteProfileList(values: unknown) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => typeof value === "string" ? cleanShortText(value, "", 120) : "")
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeCodexTasteModel(value: unknown) {
  if (typeof value !== "string") return "gpt-5.5";
  const model = value.trim();
  return model && model.length <= 80 && !/["'<>]/.test(model) ? model : "gpt-5.5";
}

function nextTimestamp(previous: string) {
  const now = Date.now();
  const previousMs = Date.parse(previous);
  return new Date(Number.isFinite(previousMs) && now <= previousMs ? previousMs + 1 : now).toISOString();
}

function compactTimestamp(value: string) {
  return value.replace(/[-:.TZ]/g, "").slice(0, 14);
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

function cleanShortText(value: string, fallback: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, maxLength);
}

function normalizeTitleKey(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripRadioKeeperSuffix(value: string) {
  return value.replace(/\s+Keeper\s*$/i, "").trim() || value;
}

function splitLastTitleNumber(value: string) {
  const matches = [...value.matchAll(/\d+/g)];
  const lastMatch = matches.at(-1);
  if (!lastMatch || lastMatch.index === undefined) return undefined;
  return {
    start: lastMatch.index,
    end: lastMatch.index + lastMatch[0].length,
    value: Number(lastMatch[0]),
    width: lastMatch[0].length,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugForFilename(value: string, maxLength: number) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, maxLength).replace(/_+$/g, "");
  return slug || "untitled";
}

function slugForStyleId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
}

function makeUniqueRadioStyleId(label: string, styles: RadioStyle[]) {
  const base = slugForStyleId(label) || "custom-style";
  const used = new Set(styles.map((style) => style.id));
  if (!used.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const id = `${base}-${index}`;
    if (!used.has(id)) return id;
  }
  return `${base}-${shortHash(`${label}-${Date.now()}`)}`;
}

function isSafeAnnouncementFilename(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9._-]+\.mp3$/.test(value) && !value.includes("..");
}

function shortHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return (hash >>> 0).toString(36);
}

function extractJsonObject(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return value;
  return value.slice(start, end + 1);
}
