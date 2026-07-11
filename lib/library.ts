/**
 * Library utilities for generated audio: metadata sidecar read/write helpers,
 * title-to-filename slugification with atomic duplicate detection, a
 * dependency-free ZIP archive builder, crop utilities, SVG render-screenshot
 * cards, batch-manifest/filename builders, and safety predicates for audio
 * filenames and batch run ids.
 */
import path from "node:path";
import { open, readdir } from "node:fs/promises";
import type { GenerateRequest } from "./generation";
import type { GenerationBackend } from "./generator-backend";

/** Result of spawning a child process: exit code plus captured stdout/stderr streams. */
export type ProcessResult = { code: number | null; stdout: string; stderr: string };

// Minimal, non-revealing process status persisted into metadata sidecars.
// The full ProcessResult (stdout/stderr) is intentionally NOT persisted: it can
// carry absolute host paths, tracebacks, and backend config that should not be
// served back via GET /api/library or bundle ZIPs (SEC-004). Callers still pass
// the full ProcessResult to buildLibraryMetadata; only the exit code is kept.
/** Minimal, non-revealing process status (exit code only) persisted into metadata sidecars. */
export type GenerationProcessStatus = { exitCode: number | null };

/** Full metadata persisted to the `.json` sidecar for each generated audio file. */
export type GenerationMetadata = {
  filename: string;
  audioUrl: string;
  metadataUrl: string;
  createdAt: string;
  backend: GenerationBackend;
  title?: string;
  generationDurationMs?: number;
  request: GenerateRequest;
  settings: {
    prompt: string;
    negativePrompt: string;
    mode: GenerateRequest["mode"];
    model: GenerateRequest["model"];
    duration: number;
    steps: number;
    cfgScale: number;
    format: GenerateRequest["format"];
    seed?: number;
    mock: boolean;
  };
  python: GenerationProcessStatus;
};

/** Returns true if `filename` matches `[A-Za-z0-9._-]+\.(mp3|wav)` with no `..` traversal. */
export function isSafeAudioFilename(filename: string) {
  return /^[a-zA-Z0-9._-]+\.(mp3|wav)$/.test(filename) && !filename.includes("..");
}

/** Lowercases `title`, strips non-alphanumerics, joins words with `_`, and truncates to 60 chars. */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

/**
 * Derives a unique output filename for a human-readable title.
 *
 * The title is slugified via `slugifyTitle` (lowercase, `_`-joined, ≤60 chars,
 * falling back to `"untitled"` when empty); the `_sfx` suffix is appended when
 * `mode === "sfx"`. It then reads `outputDir` for collisions and, for each
 * candidate slug, atomically claims the name by creating its `.json` sidecar
 * with the `wx` (exclusive-create) flag via `reserveFilename` — closing the
 * readdir-then-pick TOCTOU window so concurrent radio refill and user
 * generation cannot both claim the same slug. Collisions append `_2`, `_3`,
 * ... up to 999; if all are taken it falls back to a timestamped slug.
 *
 * @param title - Human-readable title to slugify.
 * @param format - Output file extension (`mp3` or `wav`).
 * @param outputDir - Absolute path to the directory where outputs are written.
 * @param mode - Generation mode; `"sfx"` triggers the `_sfx` slug suffix.
 * @returns The claimed filename (e.g. `neon_pulse.mp3`), guaranteed unique in `outputDir`.
 */
export async function titleToFilename(title: string, format: "mp3" | "wav", outputDir: string, mode?: string): Promise<string> {
  let slug = slugifyTitle(title) || "untitled";
  if (mode === "sfx") slug += "_sfx";
  const existing = await readdir(outputDir).catch(() => [] as string[]);
  const existingNames = new Set(existing);
  const base = `${slug}.${format}`;
  if (!existingNames.has(base) && await reserveFilename(base, outputDir)) return base;
  let n = 2;
  while (n < 1000) {
    const name = `${slug}_${n}.${format}`;
    if (!existingNames.has(name) && await reserveFilename(name, outputDir)) return name;
    n += 1;
  }
  return `${slug}_${Date.now()}.${format}`;
}

// Atomically claim a filename by creating its sidecar with the `wx`
// (exclusive-create) flag, closing the readdir-then-pick TOCTOU window so
// concurrent radio refill + user generation can't both claim the same slug
// (QA-015). The sidecar is later overwritten with real metadata by the caller.
async function reserveFilename(filename: string, outputDir: string): Promise<boolean> {
  try {
    const handle = await open(path.join(outputDir, `${filename}.json`), "wx");
    await handle.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the `.json` sidecar filename for an audio file.
 * @throws {Error} when `filename` fails `isSafeAudioFilename`.
 */
export function metadataFilenameForAudio(filename: string) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return `${filename}.json`;
}

/** Appends `.json` to an audio file path to locate its sidecar. */
export function metadataPathForAudio(audioPath: string) {
  return `${audioPath}.json`;
}

/** Returns the public `/outputs/...json` URL for an audio file's sidecar. */
export function metadataUrlForAudio(filename: string) {
  return `/outputs/${metadataFilenameForAudio(filename)}`;
}

/**
 * Joins `outputDir` and `filename` into an absolute output path.
 * @throws {Error} when `filename` fails `isSafeAudioFilename`.
 */
export function outputPathForAudio(outputDir: string, filename: string) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return path.join(outputDir, filename);
}

/**
 * Builds the `GenerationMetadata` sidecar object for a generated file.
 * Only the process exit code is persisted (not stdout/stderr) to avoid
 * leaking host paths, tracebacks, or backend config via the library API.
 *
 * @throws {Error} when `filename` fails `isSafeAudioFilename`.
 */
export function buildLibraryMetadata({
  filename,
  input,
  python,
  backend = "mlx",
  createdAt = new Date().toISOString(),
  generationDurationMs,
  title,
}: {
  filename: string;
  input: GenerateRequest;
  python: ProcessResult;
  backend?: GenerationBackend;
  createdAt?: string;
  generationDurationMs?: number;
  title?: string;
}): GenerationMetadata {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return {
    filename,
    audioUrl: `/outputs/${filename}`,
    metadataUrl: metadataUrlForAudio(filename),
    createdAt,
    backend,
    generationDurationMs,
    ...(title ? { title } : {}),
    request: input,
    settings: {
      prompt: input.prompt,
      negativePrompt: input.negativePrompt || "",
      mode: input.mode,
      model: input.model,
      duration: input.duration,
      steps: input.steps,
      cfgScale: input.cfgScale,
      format: input.format,
      seed: input.seed,
      mock: input.mock,
    },
    ...(input.batchRunId ? { batch: { batchRunId: input.batchRunId, variationIndex: input.variationIndex ?? 0, variationCount: input.variationCount ?? 1 } } : {}),
    python: { exitCode: python.code },
  };
}

/** Returns true if `meta` is an object whose `favorite` field is exactly `true`. */
export function isFavoriteMetadata(meta: unknown) {
  return !!meta && typeof meta === "object" && (meta as Record<string, unknown>).favorite === true;
}

/** User annotation persisted onto a library item: freeform notes plus an optional 1–5 rating. */
export type LibraryAnnotation = { notes: string; rating: number | null };

/**
 * Coerces untrusted annotation input into a valid `LibraryAnnotation`, falling
 * back to `previous` for missing fields.
 *
 * @throws {Error} when notes exceed 1000 characters or rating is not an integer in 1–5.
 */
export function normalizeLibraryAnnotation(input: unknown, previous: Partial<LibraryAnnotation> = {}): LibraryAnnotation {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const notesValue = "notes" in record ? (typeof record.notes === "string" ? record.notes.trim() : "") : (previous.notes ?? "");
  if (notesValue.length > 1000) throw new Error("Invalid notes: must be 1000 characters or fewer");
  const ratingValue = "rating" in record ? record.rating : previous.rating;
  let rating: number | null = null;
  if (ratingValue !== undefined && ratingValue !== null && ratingValue !== "") {
    const numericRating = Number(ratingValue);
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) throw new Error("Invalid rating: must be 1-5 or empty");
    rating = numericRating;
  }
  return { notes: notesValue, rating };
}

/** Merges a normalized annotation onto a copy of `meta`, stamping it with `annotatedAt`. */
export function applyLibraryAnnotationMetadata<T>(meta: T, annotationInput: unknown, annotatedAt = new Date().toISOString()): T & { notes?: string; rating?: number; annotatedAt?: string } {
  const base = meta && typeof meta === "object" ? meta : ({} as T);
  const baseRecord = base as T & Record<string, unknown>;
  const previous = {
    notes: typeof baseRecord.notes === "string" ? baseRecord.notes : "",
    rating: typeof baseRecord.rating === "number" && Number.isFinite(baseRecord.rating) ? baseRecord.rating : null,
  };
  const annotation = normalizeLibraryAnnotation(annotationInput, previous);
  return {
    ...baseRecord,
    notes: annotation.notes || undefined,
    rating: annotation.rating ?? undefined,
    annotatedAt,
  };
}

/** Returns a copy of `meta` with `favorite` set, adding a `favoritedAt` timestamp when favoriting. */
export function toggleFavoriteMetadata<T>(meta: T, favorite: boolean): T & { favorite: boolean; favoritedAt?: string } {
  const base = meta && typeof meta === "object" ? meta : ({} as T);
  return {
    ...(base as T & Record<string, unknown>),
    favorite,
    ...(favorite ? { favoritedAt: new Date().toISOString() } : { favoritedAt: undefined }),
  };
}

/**
 * Builds the ZIP bundle filename for a single audio file (e.g. `foo.mp3` → `foo.bundle.zip`).
 * @throws {Error} when `filename` fails `isSafeAudioFilename`.
 */
export function buildBundleFilename(filename: string) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return filename.replace(/\.(mp3|wav)$/i, ".bundle.zip");
}

/** Returns true if `batchRunId` is a 1–80 char identifier matching `[a-zA-Z0-9][a-zA-Z0-9._-]*` with no `..` traversal or leading dot. */
export function isSafeBatchRunId(batchRunId: string) {
  return /^(?!\.)(?!.*\.\.)(?=.{1,80}$)[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(batchRunId);
}

/**
 * Builds the variation-run bundle filename for a batch run id.
 * @throws {Error} when `batchRunId` fails `isSafeBatchRunId`.
 */
export function buildBatchBundleFilename(batchRunId: string) {
  if (!isSafeBatchRunId(batchRunId)) throw new Error("Invalid batch run id");
  return `${batchRunId}.variation-run.zip`;
}

/** Extracts and validates the `batch.batchRunId` from untrusted metadata, returning undefined when absent or unsafe. */
export function readBatchRunId(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return undefined;
  const batch = (metadata as Record<string, unknown>).batch;
  if (!batch || typeof batch !== "object") return undefined;
  const batchRunId = (batch as Record<string, unknown>).batchRunId;
  return typeof batchRunId === "string" && isSafeBatchRunId(batchRunId) ? batchRunId : undefined;
}

/**
 * Builds the manifest describing a batch run, with items sorted by variation
 * index (then filename).
 * @throws {Error} when `batchRunId` fails `isSafeBatchRunId`.
 */
export function buildBatchManifest({ batchRunId, items }: { batchRunId: string; items: { filename: string; metadata: unknown }[] }) {
  if (!isSafeBatchRunId(batchRunId)) throw new Error("Invalid batch run id");
  const sorted = [...items].sort((a, b) => readVariationIndex(a.metadata) - readVariationIndex(b.metadata) || a.filename.localeCompare(b.filename));
  return {
    batchRunId,
    variationCount: sorted.length,
    createdAt: new Date().toISOString(),
    items: sorted.map((item) => ({ filename: item.filename, variationIndex: readVariationIndex(item.metadata), metadata: item.metadata })),
  };
}

function readVariationIndex(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return 0;
  const batch = (metadata as Record<string, unknown>).batch;
  if (!batch || typeof batch !== "object") return 0;
  const value = (batch as Record<string, unknown>).variationIndex;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Builds the analysis-summary sidecar filename (e.g. `foo.mp3` → `foo.analysis-summary.json`).
 * @throws {Error} when `filename` fails `isSafeAudioFilename`.
 */
export function buildAnalysisSummaryFilename(filename: string) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return filename.replace(/\.(mp3|wav)$/i, ".analysis-summary.json");
}

/**
 * Builds the render-screenshot SVG filename (e.g. `foo.mp3` → `foo.render-screenshot.svg`).
 * @throws {Error} when `filename` fails `isSafeAudioFilename`.
 */
export function buildRenderScreenshotFilename(filename: string) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return filename.replace(/\.(mp3|wav)$/i, ".render-screenshot.svg");
}

/** Builds the SVG render-screenshot card string (title, prompt, badges, decorative waveform) for a generated file. */
export function buildRenderScreenshotSvg({ filename, metadata }: { filename: string; metadata: unknown }) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  const summary = buildAnalysisSummary({ filename, metadata });
  const prompt = summary.prompt || "No prompt metadata";
  const negativePrompt = summary.negativePrompt || "";
  const badges = [summary.mode, summary.model, summary.backend, typeof summary.duration === "number" ? `${summary.duration}s` : undefined, typeof summary.seed === "number" ? `seed ${summary.seed}` : undefined].filter(Boolean) as string[];
  const promptLines = wrapSvgText(prompt, 58, 5);
  const negativeLines = negativePrompt ? wrapSvgText(`Avoid: ${negativePrompt}`, 68, 2) : [];
  const badgeText = badges.join(" • ");
  const escapedFilename = escapeSvg(filename);
  const title = typeof (metadata as Record<string, unknown>)?.title === "string" ? (metadata as Record<string, unknown>).title as string : "Render capture";
  const promptText = promptLines.map((line, index) => `<text x="54" y="${214 + index * 28}" class="prompt">${escapeSvg(line)}</text>`).join("");
  const negativeText = negativeLines.map((line, index) => `<text x="54" y="${376 + index * 22}" class="negative">${escapeSvg(line)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-label="Stable Audio 3 render screenshot for ${escapedFilename}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#04110d"/><stop offset="0.55" stop-color="#111827"/><stop offset="1" stop-color="#2e1065"/></linearGradient>
    <linearGradient id="wave" x1="0" x2="1"><stop offset="0" stop-color="#6ee7b7"/><stop offset="0.5" stop-color="#7dd3fc"/><stop offset="1" stop-color="#f472b6"/></linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="10" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <style>.eyebrow{fill:#a7f3d0;font:700 22px ui-sans-serif,system-ui;letter-spacing:5px}.title{fill:white;font:700 54px ui-sans-serif,system-ui}.file{fill:#d1d5db;font:500 24px ui-monospace,SFMono-Regular,Menlo,monospace}.badge{fill:#e0f2fe;font:700 23px ui-sans-serif,system-ui}.prompt{fill:white;font:600 30px ui-sans-serif,system-ui}.negative{fill:#fef3c7;font:500 22px ui-sans-serif,system-ui}.small{fill:#94a3b8;font:600 20px ui-sans-serif,system-ui}</style>
  </defs>
  <rect width="1200" height="675" fill="url(#bg)"/>
  <circle cx="1040" cy="95" r="190" fill="#22d3ee" opacity="0.14" filter="url(#glow)"/>
  <circle cx="158" cy="578" r="230" fill="#34d399" opacity="0.12" filter="url(#glow)"/>
  <rect x="34" y="34" width="1132" height="607" rx="42" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.18)"/>
  <text x="54" y="88" class="eyebrow">STABLE AUDIO 3 LAB</text>
  <text x="54" y="152" class="title">${escapeSvg(title)}</text>
  <text x="54" y="184" class="file">${escapedFilename}</text>
  <rect x="54" y="440" width="1092" height="120" rx="28" fill="rgba(0,0,0,0.34)" stroke="rgba(255,255,255,0.12)"/>
  ${Array.from({ length: 84 }, (_, index) => {
    const height = 18 + Math.abs(Math.sin(index * 0.48)) * 78 + Math.abs(Math.sin(index * 0.13)) * 18;
    const x = 78 + index * 12.5;
    const y = 500 - height / 2;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="5" height="${height.toFixed(1)}" rx="2.5" fill="url(#wave)" opacity="0.86"/>`;
  }).join("")}
  <rect x="54" y="586" width="1092" height="34" rx="17" fill="rgba(14,165,233,0.14)" stroke="rgba(125,211,252,0.20)"/>
  <text x="76" y="609" class="badge">${escapeSvg(badgeText || "metadata unavailable")}</text>
  ${promptText}
  ${negativeText}
  <text x="54" y="410" class="small">Included automatically in bundle exports for visual provenance.</text>
</svg>`;
}

function wrapSvgText(text: string, maxChars: number, maxLines: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (words.length > 0 && lines.length === maxLines && lines.join(" ").length < text.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\s+$/, "")}…`;
  }
  return lines;
}

function escapeSvg(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

/** A validated time range for cropping, with millisecond-precise `start`, `end`, and computed `duration`. */
export type CropWindow = { start: number; end: number; duration: number };

/**
 * Validates and rounds a `{ start, end }` range into a `CropWindow`.
 * @throws {Error} when bounds are non-finite, `start < 0`, `end <= start`, or collapse to equal after rounding.
 */
export function normalizeCropWindow({ start, end }: { start: number; end: number }): CropWindow {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error("Invalid crop window");
  }
  const roundedStart = roundSeconds(start);
  const roundedEnd = roundSeconds(end);
  if (roundedEnd <= roundedStart) {
    throw new Error("Invalid crop window");
  }
  return { start: roundedStart, end: roundedEnd, duration: roundSeconds(roundedEnd - roundedStart) };
}

/**
 * Builds the cropped-output filename by inserting a `.crop-<start>-<end>` stamp
 * before the source extension.
 * @throws {Error} when `filename` fails `isSafeAudioFilename` or the crop window is invalid.
 */
export function buildCropFilename(filename: string, start: number, end: number) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  const crop = normalizeCropWindow({ start, end });
  return filename.replace(/\.(mp3|wav)$/i, `.crop-${formatCropStamp(crop.start)}-${formatCropStamp(crop.end)}$&`);
}

/**
 * Asserts that a crop window lies within the source duration (0.001s tolerance).
 * @throws {Error} when `sourceDuration` is non-positive/non-finite, or `crop.end` exceeds it.
 */
export function validateCropFitsDuration(crop: CropWindow, sourceDuration: number) {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new Error("Invalid source duration");
  if (crop.end > roundSeconds(sourceDuration) + 0.001) {
    throw new Error("Invalid crop window: end exceeds source duration");
  }
  return crop;
}

/**
 * Builds the metadata sidecar for a cropped file, cloning the source metadata
 * and overriding the filename, URLs, duration, and provenance links.
 * @throws {Error} when either filename fails `isSafeAudioFilename`.
 */
export function buildCropMetadata({
  sourceFilename,
  cropFilename,
  sourceMetadata,
  crop,
  createdAt = new Date().toISOString(),
}: {
  sourceFilename: string;
  cropFilename: string;
  sourceMetadata: unknown;
  crop: CropWindow;
  createdAt?: string;
}) {
  if (!isSafeAudioFilename(sourceFilename) || !isSafeAudioFilename(cropFilename)) throw new Error("Invalid audio filename");
  const sourceRecord = sourceMetadata && typeof sourceMetadata === "object" ? (sourceMetadata as Record<string, unknown>) : {};
  const sourceSettings = sourceRecord.settings && typeof sourceRecord.settings === "object" ? (sourceRecord.settings as Record<string, unknown>) : undefined;
  return {
    ...sourceRecord,
    ...(sourceSettings ? { settings: { ...sourceSettings, duration: crop.duration } } : {}),
    filename: cropFilename,
    audioUrl: `/outputs/${cropFilename}`,
    metadataUrl: metadataUrlForAudio(cropFilename),
    createdAt,
    sourceFilename,
    sourceAudioUrl: `/outputs/${sourceFilename}`,
    sourceMetadataUrl: metadataUrlForAudio(sourceFilename),
    crop,
  };
}

function roundSeconds(value: number) {
  return Math.round(value * 1000) / 1000;
}

function formatCropStamp(value: number) {
  return value.toFixed(3).replace(".", "p");
}

/**
 * Extracts a flat, summary view of generation settings from untrusted metadata
 * for bundle analysis-summary files and render screenshots.
 * @throws {Error} when `filename` fails `isSafeAudioFilename`.
 */
export function buildAnalysisSummary({ filename, metadata }: { filename: string; metadata: unknown }) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  const record = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  const settings = record.settings && typeof record.settings === "object" ? record.settings as Record<string, unknown> : {};
  return {
    filename,
    generatedAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
    prompt: readString(settings.prompt),
    negativePrompt: readString(settings.negativePrompt),
    mode: readString(settings.mode),
    model: readString(settings.model),
    duration: readNumber(settings.duration),
    steps: readNumber(settings.steps),
    cfgScale: readNumber(settings.cfgScale),
    format: readString(settings.format),
    seed: readNumber(settings.seed),
    mock: typeof settings.mock === "boolean" ? settings.mock : undefined,
    backend: readString(record.backend),
    generationDurationMs: readNumber(record.generationDurationMs),
  };
}

/**
 * Builds a ZIP archive `Buffer` from named entries with no external zip
 * dependency (STORE method, CRC32 checksums, single central directory).
 * Rejects entry names containing path traversal.
 * @throws {Error} when any entry name contains `..`, a leading `/`, or a backslash.
 */
export function buildStoredZip(entries: { name: string; data: Buffer }[]) {
  const now = new Date();
  const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | (Math.floor(now.getSeconds() / 2) & 31);
  const dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (entry.name.includes("..") || entry.name.startsWith("/") || entry.name.includes("\\")) throw new Error("Invalid zip entry name");
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDir, end]);
}

/** Returns `value` when it is a string, otherwise `undefined`. */
function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

/** Returns `value` when it is a finite number, otherwise `undefined`. */
function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// Standard CRC32 lookup table (polynomial 0xedb88320) — ~8x faster than the
// per-bit loop on multi-MB bundles. Produces byte-identical results (QA-020).
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    table[i] = crc;
  }
  return table;
})();

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
