// Centralized, typed, defaulted accessors for every `STABLE_AUDIO_*`,
// `RADIO_*`, `OLLAMA_*`, ffmpeg, and port environment variable the app reads.
//
// Before this module, ~15 `process.env.X || default` and
// `Number(process.env.X || N)` reads were scattered across routes and services
// (ARC-016). Each duplicate is a chance for a default to drift; collecting them
// here gives one place to audit, document, and default them.
//
// Primitive readers (`envString` / `envInt` / `envNumber` / `envBool`) are the
// ONLY functions in the codebase that touch `process.env` directly for config.
// Composed/clamped resolvers (concurrency limits, Ollama base-URL composition,
// Codex taste-model validation) build on these primitives in their own modules.

// --- primitive readers (the single touch-point for process.env config) ---

/** Read a string env var, returning `fallback` when unset or empty. */
export function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

/** Read a string env var, returning `undefined` when unset or empty. */
export function envStringOptional(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? undefined : raw;
}

/**
 * Read a numeric env var. Matches the previous `Number(process.env.X || fallback)`
 * semantics exactly: unset or empty string yields `fallback`; any other value
 * (including "0" or non-numeric text) is passed through `Number`, so a bad value
 * surfaces as `NaN` at the call site just as before.
 */
export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return Number(raw);
}

/** Read an integer env var with the same semantics as `envNumber`. */
export function envInt(name: string, fallback: number): number {
  return Math.trunc(envNumber(name, fallback));
}

/** Read a boolean env var as the strict `=== "true"` check used across the app. */
export function envBool(name: string): boolean {
  return process.env[name] === "true";
}

// --- Stable Audio generation ---

/** Python interpreter used to run `scripts/generate_audio.py`. Default `python3`. */
export const stableAudioPython = (): string => envString("STABLE_AUDIO_PYTHON", "python3");

/** Mock-mode flag (generates a fake WAV without loading the model). */
export const stableAudioMock = (): boolean => envBool("STABLE_AUDIO_MOCK");

/** Backend selection passed to the Python bridge (`mlx` unless `torch`). */
export const stableAudioBackend = (): string | undefined => envStringOptional("STABLE_AUDIO_BACKEND");

/** Hard cap (ms) for a single generation / crop subprocess. Default 900000 (15m). */
export const stableAudioTimeoutMs = (): number => envNumber("STABLE_AUDIO_TIMEOUT_MS", 900_000);

/** Command line that runs the local audio-language assessor. Optional. */
export const stableAudioAssessorCommand = (): string | undefined => envStringOptional("STABLE_AUDIO_ASSESSOR_COMMAND");

/** Hard cap (ms) for a single assessor subprocess. Default 300000 (5m). */
export const stableAudioAssessorTimeoutMs = (): number => envNumber("STABLE_AUDIO_ASSESSOR_TIMEOUT_MS", 300_000);

/** yt-dlp binary for YouTube reference extraction. Default `yt-dlp`. */
export const stableAudioYoutubeYtdlpBin = (): string => envString("STABLE_AUDIO_YOUTUBE_YTDLP_BIN", "yt-dlp");

/**
 * YouTube extraction timeout (ms). Honors the legacy
 * `STABLE_AUDIO_YOUTUBE_CODEX_TIMEOUT_MS` alias for existing deployments.
 * Default 300000 (5m).
 */
export function stableAudioYoutubeTimeoutMs(): number {
  const raw = process.env.STABLE_AUDIO_YOUTUBE_TIMEOUT_MS ?? process.env.STABLE_AUDIO_YOUTUBE_CODEX_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 300_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
}

// --- Radio station ---

/** Codex binary used for taste distillation + style drafting. Default `codex`. */
export const radioCodexBin = (): string => envString("RADIO_CODEX_BIN", "codex");

/** Model override for style drafting (falls back to the taste model). */
export const radioCodexStyleModel = (): string | undefined =>
  envStringOptional("RADIO_CODEX_STYLE_MODEL") ?? envStringOptional("RADIO_CODEX_TASTE_MODEL");

/** Model override for taste distillation. */
export const radioCodexTasteModel = (): string | undefined => envStringOptional("RADIO_CODEX_TASTE_MODEL");

/** Timeout (ms) for a Codex taste/style run. Default 120000 (2m). */
export const radioCodexTasteTimeoutMs = (): number => envNumber("RADIO_CODEX_TASTE_TIMEOUT_MS", 120_000);

/** Timeout (ms) for the radio queue's Ollama prompt-draft call. Default 120000. */
export const radioOllamaTimeoutMs = (): number => envNumber("RADIO_OLLAMA_TIMEOUT_MS", 120_000);

/** Timeout (ms) for the Ollama `/api/tags` model-list probe in GET /api/radio. Default 1000. */
export const radioOllamaModelsTimeoutMs = (): number => envNumber("RADIO_OLLAMA_MODELS_TIMEOUT_MS", 1_000);

/** `false` disables the background queue auto-fill loop. */
export const radioQueueAutoFillDisabled = (): boolean => process.env.RADIO_QUEUE_AUTO_FILL === "false";

/** Optional TTS model name passed through to the TTS module. */
export const radioTtsModel = (): string | undefined => envStringOptional("RADIO_TTS_MODEL");

/** Optional path to the par-tts-core-ts module entry (non-kokoro providers). */
export const radioTtsModulePath = (): string | undefined => envStringOptional("RADIO_TTS_MODULE_PATH");

/** Optional path to the kokoro TTS node module. */
export const radioTtsNodeModulePath = (): string | undefined => envStringOptional("RADIO_TTS_NODE_MODULE_PATH");

/** Optional explicit LAN host for stream/playlist URLs. */
export const radioLanHost = (): string | undefined => envStringOptional("RADIO_LAN_HOST");

/** Optional public origin (e.g. `https://radio.pardev.net`) for public stream URLs. */
export const radioPublicOrigin = (): string | undefined => envStringOptional("RADIO_PUBLIC_ORIGIN");

// --- Ollama ---

/** Full Ollama base URL override (wins over HOST/PORT composition). */
export const ollamaBaseUrl = (): string | undefined => envStringOptional("OLLAMA_BASE_URL");

/** Ollama host (used when `OLLAMA_BASE_URL` is unset). Default `127.0.0.1`. */
export const ollamaHost = (): string => envString("OLLAMA_HOST", "127.0.0.1");

/** Ollama port (used when `OLLAMA_BASE_URL` is unset). Default `11434`. */
export const ollamaPort = (): string => envString("OLLAMA_PORT", "11434");

/** Model used for AI title generation. Default `phi4-mini`. */
export const ollamaTitleModel = (): string => envString("OLLAMA_TITLE_MODEL", "phi4-mini");

// --- ffmpeg / ffprobe / paths ---

/** ffmpeg binary path. Default `ffmpeg`. */
export const ffmpegBin = (): string => envString("FFMPEG_PATH", "ffmpeg");

/** ffprobe binary path. Default `ffprobe`. */
export const ffprobeBin = (): string => envString("FFPROBE_PATH", "ffprobe");

/** Optional path to the par-tts config file (YAML). */
export const parTtsConfigPath = (): string | undefined => envStringOptional("PAR_TTS_CONFIG_PATH");

/** Optional LAN IP override (fallback for stream URLs when `RADIO_LAN_HOST` is unset). */
export const lanIp = (): string | undefined => envStringOptional("LAN_IP");

/** Port the dev/app server listens on. Default `3007`. */
export const serverPort = (): string => envString("PORT", "3007");
