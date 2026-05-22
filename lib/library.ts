import path from "node:path";
import type { GenerateRequest } from "./generation";
import type { GenerationBackend } from "./generator-backend";

export type ProcessResult = { code: number | null; stdout: string; stderr: string };

export type GenerationMetadata = {
  filename: string;
  audioUrl: string;
  metadataUrl: string;
  createdAt: string;
  backend: GenerationBackend;
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
  python: ProcessResult;
};

export function isSafeAudioFilename(filename: string) {
  return /^[a-zA-Z0-9._-]+\.(mp3|wav)$/.test(filename) && !filename.includes("..");
}

export function metadataFilenameForAudio(filename: string) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return `${filename}.json`;
}

export function metadataPathForAudio(audioPath: string) {
  return `${audioPath}.json`;
}

export function metadataUrlForAudio(filename: string) {
  return `/outputs/${metadataFilenameForAudio(filename)}`;
}

export function outputPathForAudio(outputDir: string, filename: string) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return path.join(outputDir, filename);
}

export function buildLibraryMetadata({
  filename,
  input,
  python,
  backend = "mlx",
  createdAt = new Date().toISOString(),
  generationDurationMs,
}: {
  filename: string;
  input: GenerateRequest;
  python: ProcessResult;
  backend?: GenerationBackend;
  createdAt?: string;
  generationDurationMs?: number;
}): GenerationMetadata {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return {
    filename,
    audioUrl: `/outputs/${filename}`,
    metadataUrl: metadataUrlForAudio(filename),
    createdAt,
    backend,
    generationDurationMs,
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
    python,
  };
}

export function isFavoriteMetadata(meta: unknown) {
  return !!meta && typeof meta === "object" && (meta as Record<string, unknown>).favorite === true;
}

export type LibraryAnnotation = { notes: string; rating: number | null };

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

export function toggleFavoriteMetadata<T>(meta: T, favorite: boolean): T & { favorite: boolean; favoritedAt?: string } {
  const base = meta && typeof meta === "object" ? meta : ({} as T);
  return {
    ...(base as T & Record<string, unknown>),
    favorite,
    ...(favorite ? { favoritedAt: new Date().toISOString() } : { favoritedAt: undefined }),
  };
}

export function buildBundleFilename(filename: string) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return filename.replace(/\.(mp3|wav)$/i, ".bundle.zip");
}

export function isSafeBatchRunId(batchRunId: string) {
  return /^(?!\.)(?!.*\.\.)(?=.{1,80}$)[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(batchRunId);
}

export function buildBatchBundleFilename(batchRunId: string) {
  if (!isSafeBatchRunId(batchRunId)) throw new Error("Invalid batch run id");
  return `${batchRunId}.variation-run.zip`;
}

export function readBatchRunId(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return undefined;
  const batch = (metadata as Record<string, unknown>).batch;
  if (!batch || typeof batch !== "object") return undefined;
  const batchRunId = (batch as Record<string, unknown>).batchRunId;
  return typeof batchRunId === "string" && isSafeBatchRunId(batchRunId) ? batchRunId : undefined;
}

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

export function buildAnalysisSummaryFilename(filename: string) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return filename.replace(/\.(mp3|wav)$/i, ".analysis-summary.json");
}

export function buildRenderScreenshotFilename(filename: string) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return filename.replace(/\.(mp3|wav)$/i, ".render-screenshot.svg");
}

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
  <text x="54" y="152" class="title">Render capture</text>
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

export type CropWindow = { start: number; end: number; duration: number };

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

export function buildCropFilename(filename: string, start: number, end: number) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  const crop = normalizeCropWindow({ start, end });
  return filename.replace(/\.(mp3|wav)$/i, `.crop-${formatCropStamp(crop.start)}-${formatCropStamp(crop.end)}$&`);
}

export function validateCropFitsDuration(crop: CropWindow, sourceDuration: number) {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new Error("Invalid source duration");
  if (crop.end > roundSeconds(sourceDuration) + 0.001) {
    throw new Error("Invalid crop window: end exceeds source duration");
  }
  return crop;
}

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

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
