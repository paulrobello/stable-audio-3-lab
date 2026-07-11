// TTS-related pure data, catalogs, normalizers, and announcement helpers.
//
// This module holds ONLY pure data and functions: the per-provider voice
// catalog, the TTS config/voice/text normalizers, announcement text + filename
// builders, and the announcement-filename safety predicate. The provider
// subprocess synthesis pipeline lives in `lib/server/radio-tts.ts` — it imports
// the helpers defined here.
//
// The `DEFAULT_TTS_*` constants are exported because `defaultRadioState`
// (in `./state`) needs them to seed a fresh station.

import type { RadioTtsConfig, RadioTtsProvider, RadioTtsVoiceOption, RadioTrackRecord } from "./types";
import { cleanShortText, shortHash } from "./_internal";

const DEFAULT_TTS_PROVIDER: RadioTtsProvider = "openai";
const DEFAULT_TTS_VOICE = "nova";
const DEFAULT_ANNOUNCEMENT_PREFIX = "Now playing: ";
const DEFAULT_ANNOUNCEMENT_SUFFIX = "";

export { DEFAULT_TTS_PROVIDER, DEFAULT_TTS_VOICE, DEFAULT_ANNOUNCEMENT_PREFIX, DEFAULT_ANNOUNCEMENT_SUFFIX };

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

function slugForFilename(value: string, maxLength: number) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, maxLength).replace(/_+$/g, "");
  return slug || "untitled";
}

function isSafeAnnouncementFilename(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9._-]+\.mp3$/.test(value) && !value.includes("..");
}
