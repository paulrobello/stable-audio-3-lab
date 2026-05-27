export type RadioStyleId = (typeof radioStyles)[number]["id"];
export type RadioRating = "up" | "down";
export type RadioPromptProvider = "ollama" | "fallback";
export type RadioTtsProvider = "openai" | "elevenlabs" | "deepgram" | "gemini";

export type RadioTtsConfig = {
  ttsProvider: RadioTtsProvider;
  ttsVoice: string;
  announcementPrefix: string;
  announcementSuffix: string;
};

export type RadioPreference = {
  likes: string[];
  dislikes: string[];
};

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
  announcementFilename?: string;
  durationSeconds?: number;
  rating?: RadioRating;
  ratedAt?: string;
};

export type RadioState = {
  selectedStyleId: RadioStyleId;
  announceEnabled: boolean;
  promptModel: string;
  ttsProvider: RadioTtsProvider;
  ttsVoice: string;
  announcementPrefix: string;
  announcementSuffix: string;
  preferences: Partial<Record<RadioStyleId, RadioPreference>>;
  currentDraft?: RadioPromptDraft;
  currentTrack?: RadioTrackRecord;
  history: RadioTrackRecord[];
  updatedAt: string;
};

export type RadioStreamState = RadioState & {
  streamReady: boolean;
  queueAheadCount: number;
  queueTarget: number;
  needsQueueFill: boolean;
  streamUrl?: string;
  lanStreamUrl?: string;
};

export const radioOllamaModels = [
  "llama3.1:8b",
  "gemma3:12b",
  "phi4:14b",
  "qwen2.5:14b",
  "mistral-small:24b",
  "gemma3:27b",
] as const;

export const radioStyles = [
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
] as const;

const DEFAULT_PROMPT_MODEL = radioOllamaModels[0];
const DEFAULT_TTS_PROVIDER: RadioTtsProvider = "openai";
const DEFAULT_TTS_VOICE = "nova";
const DEFAULT_ANNOUNCEMENT_PREFIX = "Now playing: ";
const DEFAULT_ANNOUNCEMENT_SUFFIX = "";
const STREAM_URL = "/api/radio?stream=1";
const RADIO_QUEUE_TARGET = 3;

export function defaultRadioState(now = new Date().toISOString()): RadioState {
  return {
    selectedStyleId: "synthwave",
    announceEnabled: true,
    promptModel: DEFAULT_PROMPT_MODEL,
    ttsProvider: DEFAULT_TTS_PROVIDER,
    ttsVoice: DEFAULT_TTS_VOICE,
    announcementPrefix: DEFAULT_ANNOUNCEMENT_PREFIX,
    announcementSuffix: DEFAULT_ANNOUNCEMENT_SUFFIX,
    preferences: {},
    history: [],
    updatedAt: now,
  };
}

export function normalizeRadioStyleId(value: unknown): RadioStyleId {
  return radioStyles.some((style) => style.id === value) ? value as RadioStyleId : "synthwave";
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

export function normalizeRadioTtsProvider(value: unknown): RadioTtsProvider {
  return value === "elevenlabs" || value === "deepgram" || value === "gemini" || value === "openai" ? value : DEFAULT_TTS_PROVIDER;
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

export function buildRadioTrackPlaybackFilenames(track: RadioTrackRecord) {
  return [
    isSafeAnnouncementFilename(track.announcementFilename) ? track.announcementFilename : undefined,
    track.filename,
  ].filter((filename): filename is string => !!filename);
}

export function getRadioStyle(styleId: RadioStyleId) {
  return radioStyles.find((style) => style.id === styleId) ?? radioStyles[0];
}

export function recordRadioRating(state: RadioState, styleIdInput: unknown, phraseInput: unknown, ratingInput: unknown): RadioState {
  const rating = normalizeRadioRating(ratingInput);
  const phrase = typeof phraseInput === "string" ? phraseInput.trim().slice(0, 180) : "";
  if (!rating || !phrase) return state;

  const styleId = normalizeRadioStyleId(styleIdInput);
  const previous = state.preferences[styleId] ?? { likes: [], dislikes: [] };
  const removesExistingLike = rating === "up" && previous.likes.includes(phrase);
  const nextPreference: RadioPreference = {
    likes: rating === "up"
      ? (removesExistingLike ? previous.likes.filter((item) => item !== phrase) : pushUniqueLimited(previous.likes, phrase, 20))
      : previous.likes.filter((item) => item !== phrase),
    dislikes: rating === "down" ? pushUniqueLimited(previous.dislikes, phrase, 20) : previous.dislikes.filter((item) => item !== phrase),
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
  const styleId = normalizeRadioStyleId(styleIdInput);
  const style = getRadioStyle(styleId);
  const preference = state.preferences[styleId];
  const likes = preference?.likes?.length ? `Lean into: ${preference.likes.slice(-6).join("; ")}` : "Lean into: fresh variations within the style.";
  const dislikes = preference?.dislikes?.length ? `Avoid repeating: ${preference.dislikes.slice(-6).join("; ")}` : "Avoid repeating: generic stock music, vocals, and brittle mixes.";
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
    uniqueness,
    recentDirections,
    `Default negative prompt: ${style.negativePrompt}`,
  ].join("\n");
}

export function buildRadioPromptGeneratorMessages(state: RadioState, styleIdInput: unknown, modelInput: unknown) {
  const styleId = normalizeRadioStyleId(styleIdInput);
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
}: {
  title: string;
  prompt: string;
  negativePrompt: string;
  styleId: RadioStyleId;
  promptProvider: RadioPromptProvider;
  promptModel: string;
  rawResponse?: string;
}): RadioPromptDraft {
  const createdAt = new Date().toISOString();
  return {
    id: `draft-${compactTimestamp(createdAt)}-${randomSuffix()}`,
    title: cleanShortText(title, "Untitled Signal", 80),
    prompt: cleanShortText(prompt, getRadioStyle(styleId).seedPrompt, 1000),
    negativePrompt: cleanShortText(negativePrompt, getRadioStyle(styleId).negativePrompt, 500),
    styleId,
    createdAt,
    promptProvider,
    promptModel: normalizeOllamaPromptModel(promptModel),
    ...(rawResponse ? { rawResponse: rawResponse.slice(0, 4000) } : {}),
  };
}

export function createFallbackRadioPromptDraft(state: RadioState, styleIdInput: unknown, modelInput: unknown, nowInput = new Date().toISOString()): RadioPromptDraft {
  const styleId = normalizeRadioStyleId(styleIdInput);
  const style = getRadioStyle(styleId);
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
  return createRadioPromptDraft({
    title: `${style.label} ${likedTexture ? `${variant} Keeper` : variant}`,
    prompt: [style.seedPrompt, likedTexture ? `emphasize ${likedTexture}` : `add a fresh ${variant.toLowerCase()} melodic motif`, `variation seed ${variationSeed}`, "polished full-song intro and outro"].join(", "),
    negativePrompt: [style.negativePrompt, dislikedTexture ? `avoid ${dislikedTexture}` : ""].filter(Boolean).join(", "),
    styleId,
    promptProvider: "fallback",
    promptModel: normalizeOllamaPromptModel(modelInput),
  });
}

export function parseRadioPromptDraft(rawResponse: string, state: RadioState, styleIdInput: unknown, modelInput: unknown): RadioPromptDraft {
  const styleId = normalizeRadioStyleId(styleIdInput);
  try {
    const parsed = JSON.parse(extractJsonObject(rawResponse)) as Partial<Record<"title" | "prompt" | "negativePrompt", unknown>>;
    return createRadioPromptDraft({
      title: typeof parsed.title === "string" ? parsed.title : getRadioStyle(styleId).label,
      prompt: typeof parsed.prompt === "string" ? parsed.prompt : getRadioStyle(styleId).seedPrompt,
      negativePrompt: typeof parsed.negativePrompt === "string" ? parsed.negativePrompt : getRadioStyle(styleId).negativePrompt,
      styleId,
      promptProvider: "ollama",
      promptModel: normalizeOllamaPromptModel(modelInput),
      rawResponse,
    });
  } catch {
    return { ...createFallbackRadioPromptDraft(state, styleId, modelInput), rawResponse: rawResponse.slice(0, 4000) };
  }
}

export function createRadioTrackRecord({
  filename,
  title,
  prompt,
  styleId,
  announce,
  promptProvider,
  promptModel,
  announcementFilename,
  durationSeconds,
}: {
  filename: string;
  title: string;
  prompt: string;
  styleId: RadioStyleId;
  announce: boolean;
  promptProvider?: RadioPromptProvider;
  promptModel?: string;
  announcementFilename?: string;
  durationSeconds?: number;
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
    ...(announcementFilename ? { announcementFilename } : {}),
    ...(durationSeconds && Number.isFinite(durationSeconds) ? { durationSeconds: Math.max(1, Math.min(Math.round(durationSeconds), 3600)) } : {}),
  };
}

export function registerRadioTrack(state: RadioState, track: RadioTrackRecord): RadioState {
  const existing = state.history.filter((item) => item.filename !== track.filename);
  const history = state.currentTrack ? [...existing, track] : [track, ...existing];
  return {
    ...state,
    selectedStyleId: track.styleId,
    currentTrack: state.currentTrack ?? track,
    history: history.slice(0, 50),
    updatedAt: nextTimestamp(state.updatedAt),
  };
}

export function replaceRadioTrackInLineup(state: RadioState, track: RadioTrackRecord): RadioState {
  return {
    ...state,
    currentTrack: state.currentTrack?.filename === track.filename ? track : state.currentTrack,
    history: state.history.map((item) => item.filename === track.filename ? track : item),
    updatedAt: nextTimestamp(state.updatedAt),
  };
}

export function rejectCurrentRadioTrack(state: RadioState): { state: RadioState; rejectedTrack?: RadioTrackRecord } {
  const rejectedTrack = state.currentTrack;
  if (!rejectedTrack) return { state };
  const remainingHistory = state.history.filter((track) => track.filename !== rejectedTrack.filename);
  const nextTrack = remainingHistory.find((track) => track.filename.toLowerCase().endsWith(".mp3"));
  return {
    rejectedTrack,
    state: {
      ...state,
      currentTrack: nextTrack,
      history: remainingHistory,
      updatedAt: nextTimestamp(state.updatedAt),
    },
  };
}

export function advanceRadioCurrentTrack(state: RadioState): RadioState {
  if (!state.currentTrack) return state;
  const currentIndex = state.history.findIndex((track) => track.filename === state.currentTrack?.filename);
  const nextTrack = state.history.slice(Math.max(currentIndex + 1, 0)).find((track) => track.filename.toLowerCase().endsWith(".mp3"));
  if (!nextTrack) return state;
  return {
    ...state,
    currentTrack: nextTrack,
    updatedAt: nextTimestamp(state.updatedAt),
  };
}

export function getRadioQueueAheadCount(state: RadioState) {
  if (!state.currentTrack) return 0;
  const currentIndex = state.history.findIndex((track) => track.filename === state.currentTrack?.filename);
  if (currentIndex < 0) return state.history.filter((track) => track.filename.toLowerCase().endsWith(".mp3")).length;
  return state.history.slice(currentIndex + 1).filter((track) => track.filename.toLowerCase().endsWith(".mp3")).length;
}

export function shouldGenerateRadioQueueTrack(state: RadioState, targetAhead = 3) {
  return getRadioQueueAheadCount(state) < targetAhead;
}

export function findRadioTracksForCleanup(state: RadioState, nowInput = new Date().toISOString(), maxAgeHours = 48) {
  const now = Date.parse(nowInput);
  if (!Number.isFinite(now)) return [];
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  return state.history.filter((track) => {
    if (track.rating === "up") return false;
    if (!track.filename.toLowerCase().endsWith(".mp3")) return false;
    const createdAt = Date.parse(track.createdAt);
    return Number.isFinite(createdAt) && now - createdAt >= maxAgeMs;
  });
}

export function findDuplicateRadioTitleTracks(state: RadioState) {
  const seen = new Set<string>();
  return state.history.filter((track) => {
    const titleKey = track.title.trim().toLowerCase();
    if (!titleKey) return false;
    if (!seen.has(titleKey)) {
      seen.add(titleKey);
      return false;
    }
    return track.filename !== state.currentTrack?.filename && track.rating !== "up" && track.filename.toLowerCase().endsWith(".mp3");
  });
}

export function removeRadioTracksFromLineup(state: RadioState, tracks: RadioTrackRecord[]): RadioState {
  const filenames = new Set(tracks.map((track) => track.filename));
  if (!filenames.size) return state;
  const history = state.history.filter((track) => !filenames.has(track.filename));
  const currentTrack = state.currentTrack && !filenames.has(state.currentTrack.filename)
    ? state.currentTrack
    : history.find((track) => track.filename.toLowerCase().endsWith(".mp3"));
  return {
    ...state,
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
    streamReady,
    queueAheadCount,
    queueTarget: RADIO_QUEUE_TARGET,
    needsQueueFill: queueAheadCount < RADIO_QUEUE_TARGET,
    ...(streamReady ? { streamUrl: STREAM_URL } : {}),
  };
}

export function buildRadioLanStreamUrl(lanIp: string | undefined, port: string | number | undefined) {
  const host = typeof lanIp === "string" ? lanIp.trim() : "";
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return undefined;
  const safePort = String(port ?? "3007").replace(/\D/g, "") || "3007";
  return `http://${host}:${safePort}/api/radio?stream=1`;
}

export function buildRadioPublicStreamUrl(origin: string | undefined) {
  const trimmed = typeof origin === "string" ? origin.trim() : "";
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.pathname = "/api/radio";
    url.search = "stream=1";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
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

function pushUniqueLimited(values: string[], value: string, limit: number) {
  return [...values.filter((item) => item !== value), value].slice(-limit);
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

function slugForFilename(value: string, maxLength: number) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, maxLength).replace(/_+$/g, "");
  return slug || "untitled";
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
