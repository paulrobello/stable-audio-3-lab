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
    python,
  };
}

export function isFavoriteMetadata(meta: unknown) {
  return !!meta && typeof meta === "object" && (meta as Record<string, unknown>).favorite === true;
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

export function buildAnalysisSummaryFilename(filename: string) {
  if (!isSafeAudioFilename(filename)) throw new Error("Invalid audio filename");
  return filename.replace(/\.(mp3|wav)$/i, ".analysis-summary.json");
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
