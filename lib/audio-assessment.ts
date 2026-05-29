import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { cpus, loadavg } from "node:os";
import path from "node:path";
import { isSafeAudioFilename, metadataPathForAudio, metadataUrlForAudio, outputPathForAudio } from "./library";

export const AUDIO_ASSESSMENT_LOAD_THRESHOLD = 0.25;

export type AssessmentSource = "library" | "radio";

export type AudioAssessmentRequest = {
  filename: string;
  source?: AssessmentSource;
  title?: string;
  prompt?: string;
  styleId?: string;
  rating?: string | number;
};

type AssessmentAttributes = {
  genre: string[];
  instruments: string[];
  mood: string[];
  production: string[];
  positives: string[];
  negatives: string[];
  rhythm?: string;
  tempoBpm?: number;
  key?: string;
};

export type AudioAssessment = {
  assessedAt: string;
  provider: string;
  model: string;
  summary: string;
  source: {
    filename: string;
    audioUrl: string;
    metadataUrl: string;
    source: AssessmentSource;
    title?: string;
    prompt?: string;
    styleId?: string;
    seed?: number;
    rating?: string | number;
  };
  attributes: AssessmentAttributes;
  raw?: unknown;
};

type AssessmentQueueJob = AudioAssessmentRequest & {
  id: string;
  source: AssessmentSource;
  queuedAt: string;
  attempts: number;
};

export type AudioAssessmentQueueStatus = {
  pendingCount: number;
  status: "idle" | "queued" | "paused";
  loadRatio: number;
  loadThreshold: number;
  nextFilename?: string;
  nextRating?: string | number;
};

export class AudioAssessmentError extends Error {
  constructor(message: string, public status: number, public detail?: unknown) {
    super(message);
  }
}

let queueProcessor: Promise<void> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

const outputDir = () => path.join(process.cwd(), "public", "outputs");
const queuePath = () => path.join(process.cwd(), ".stable-audio-assessments", "queue.json");

export async function assessAudioFile(request: AudioAssessmentRequest) {
  const filename = normalizeSafeFilename(request.filename);
  const assessorCommand = process.env.STABLE_AUDIO_ASSESSOR_COMMAND;
  if (!assessorCommand) {
    throw new AudioAssessmentError("Set STABLE_AUDIO_ASSESSOR_COMMAND to a local audio assessment command.", 503);
  }

  const audioPath = outputPathForAudio(outputDir(), filename);
  await stat(audioPath);
  const metaPath = metadataPathForAudio(audioPath);
  const metadata = await readAudioMetadata(filename);
  const sourceInfo = buildAssessmentSource({
    filename,
    source: request.source === "radio" ? "radio" : "library",
    body: request,
    metadata,
  });
  const commandResult = await runAssessorCommand(assessorCommand, {
    audioPath,
    filename,
    source: sourceInfo,
    metadata,
    prompt: buildAssessmentPrompt(sourceInfo),
  }, Number(process.env.STABLE_AUDIO_ASSESSOR_TIMEOUT_MS || 300000));
  if (commandResult.code !== 0) {
    throw new AudioAssessmentError("Local audio assessor failed", 500, commandResult);
  }

  const assessment = normalizeAssessment(commandResult.stdout, sourceInfo);
  const updated = appendAssessmentMetadata(metadata, assessment, "done");
  await mkdir(path.dirname(metaPath), { recursive: true });
  await writeFile(metaPath, JSON.stringify(updated, null, 2));
  return { assessment, meta: updated };
}

export async function enqueueAudioAssessment(request: AudioAssessmentRequest) {
  const filename = normalizeSafeFilename(request.filename);
  const metadata = await readAudioMetadata(filename);
  const queue = await readAssessmentQueue();
  if (hasFinishedAssessment(metadata) || queue.some((item) => item.filename === filename)) return undefined;
  const sourceInfo = buildAssessmentSource({
    filename,
    source: request.source === "radio" ? "radio" : "library",
    body: request,
    metadata,
  });
  const queuedAt = new Date().toISOString();
  const job: AssessmentQueueJob = {
    id: `${filename}:${sourceInfo.rating ?? "unrated"}`,
    filename,
    source: sourceInfo.source,
    title: sourceInfo.title,
    prompt: sourceInfo.prompt,
    styleId: sourceInfo.styleId,
    rating: sourceInfo.rating,
    queuedAt,
    attempts: 0,
  };
  const nextQueue = [...queue, job].slice(-200);
  await writeAssessmentQueue(nextQueue);
  await writeAssessmentQueueMetadata(filename, metadata, sourceInfo, queuedAt, "queued");
  return job;
}

export function startAudioAssessmentQueueProcessing() {
  if (queueProcessor) return queueProcessor;
  queueProcessor = processAudioAssessmentQueue()
    .then((result) => {
      if (result.deferred) scheduleAssessmentQueueRetry();
    })
    .catch(() => {
      scheduleAssessmentQueueRetry();
    })
    .finally(() => {
      queueProcessor = undefined;
    });
  return queueProcessor;
}

export async function processAudioAssessmentQueue(options: { loadRatio?: number } = {}) {
  if (!process.env.STABLE_AUDIO_ASSESSOR_COMMAND) return { processed: 0, deferred: false };

  let processed = 0;
  while (true) {
    const loadRatio = options.loadRatio ?? currentSystemLoadRatio();
    if (loadRatio >= AUDIO_ASSESSMENT_LOAD_THRESHOLD) return { processed, deferred: true };

    const queue = await readAssessmentQueue();
    const [job, ...remaining] = queue;
    if (!job) return { processed, deferred: false };
    const metadata = await readAudioMetadata(job.filename);
    if (hasFinishedAssessment(metadata)) {
      await writeAssessmentQueue(remaining);
      continue;
    }

    try {
      await assessAudioFile(job);
      await writeAssessmentQueue(remaining);
      processed += 1;
    } catch (error) {
      const failedAt = new Date().toISOString();
      await writeAssessmentQueueMetadata(
        job.filename,
        metadata,
        buildAssessmentSource({ filename: job.filename, source: job.source, body: job, metadata }),
        failedAt,
        "failed",
        error instanceof Error ? error.message : "Audio assessment failed",
      );
      await writeAssessmentQueue([{ ...job, attempts: job.attempts + 1, queuedAt: failedAt }, ...remaining].slice(-200));
      return { processed, deferred: false };
    }
  }
}

export async function getAudioAssessmentQueueStatus(options: { loadRatio?: number } = {}): Promise<AudioAssessmentQueueStatus> {
  const queue = await readAssessmentQueue();
  const loadRatio = options.loadRatio ?? currentSystemLoadRatio();
  const nextJob = queue[0];
  return {
    pendingCount: queue.length,
    status: queue.length === 0 ? "idle" : loadRatio >= AUDIO_ASSESSMENT_LOAD_THRESHOLD ? "paused" : "queued",
    loadRatio,
    loadThreshold: AUDIO_ASSESSMENT_LOAD_THRESHOLD,
    ...(nextJob ? { nextFilename: nextJob.filename } : {}),
    ...(nextJob?.rating !== undefined ? { nextRating: nextJob.rating } : {}),
  };
}

function scheduleAssessmentQueueRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void startAudioAssessmentQueueProcessing();
  }, 60_000);
  retryTimer.unref?.();
}

function currentSystemLoadRatio() {
  const cpuCount = Math.max(1, cpus().length);
  return loadavg()[0] / cpuCount;
}

function normalizeSafeFilename(filenameInput: string) {
  const filename = filenameInput.trim();
  if (!isSafeAudioFilename(filename)) throw new AudioAssessmentError("Invalid audio filename", 400);
  return filename;
}

async function readAudioMetadata(filename: string) {
  const audioPath = outputPathForAudio(outputDir(), filename);
  const metaPath = metadataPathForAudio(audioPath);
  try {
    const parsed = JSON.parse(await readFile(metaPath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return { filename, audioUrl: `/outputs/${filename}`, metadataUrl: metadataUrlForAudio(filename) };
  }
}

function buildAssessmentSource({
  filename,
  source,
  body,
  metadata,
}: {
  filename: string;
  source: AssessmentSource;
  body: AudioAssessmentRequest;
  metadata: Record<string, unknown>;
}): AudioAssessment["source"] {
  const settings = metadata.settings && typeof metadata.settings === "object" ? metadata.settings as Record<string, unknown> : {};
  return {
    filename,
    audioUrl: `/outputs/${filename}`,
    metadataUrl: metadataUrlForAudio(filename),
    source,
    title: readString(body.title) ?? readString(metadata.title),
    prompt: readString(body.prompt) ?? readString(settings.prompt),
    styleId: readString(body.styleId),
    seed: readNumber(settings.seed),
    rating: readString(body.rating) ?? readNumber(body.rating),
  };
}

function buildAssessmentPrompt(source: AudioAssessment["source"]) {
  return [
    "Listen to this generated music and assess the audible result, not just the text prompt.",
    "Return JSON with summary, genre, instruments, rhythm, tempoBpm if confident, key if confident, mood, production, positives, and negatives.",
    "Focus on attributes that could explain thumbs-up or thumbs-down preferences across different seeds from the same prompt.",
    source.title ? `Title: ${source.title}` : undefined,
    source.prompt ? `Original generation prompt: ${source.prompt}` : undefined,
    source.seed !== undefined ? `Seed: ${source.seed}` : undefined,
    source.rating !== undefined ? `Known user rating: ${source.rating}` : undefined,
  ].filter(Boolean).join("\n");
}

function normalizeAssessment(stdout: string, source: AudioAssessment["source"]): AudioAssessment {
  const parsed = parseAssessorOutput(stdout);
  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  return {
    assessedAt: new Date().toISOString(),
    provider: readString(record.provider) ?? "local-command",
    model: readString(record.model) ?? "unknown-local-audio-model",
    summary: readString(record.summary) ?? readString(record.description) ?? stdout.trim(),
    source,
    attributes: {
      genre: readStringArray(record.genre),
      instruments: readStringArray(record.instruments),
      mood: readStringArray(record.mood),
      production: readStringArray(record.production),
      positives: readStringArray(record.positives),
      negatives: readStringArray(record.negatives),
      rhythm: readString(record.rhythm) ?? readString(record.beat),
      tempoBpm: readNumber(record.tempoBpm) ?? readNumber(record.bpm),
      key: readString(record.key),
    },
    raw: parsed ?? stdout.trim(),
  };
}

function appendAssessmentMetadata(metadata: Record<string, unknown>, assessment: AudioAssessment, status: "done") {
  const previous = Array.isArray(metadata.assessments) ? metadata.assessments : [];
  return {
    ...metadata,
    latestAssessment: assessment,
    assessmentQueue: {
      status,
      completedAt: assessment.assessedAt,
      source: assessment.source,
    },
    assessments: [...previous, assessment].slice(-20),
  };
}

function hasFinishedAssessment(metadata: Record<string, unknown>) {
  if (metadata.latestAssessment && typeof metadata.latestAssessment === "object") return true;
  if (Array.isArray(metadata.assessments) && metadata.assessments.length > 0) return true;
  const assessmentQueue = metadata.assessmentQueue && typeof metadata.assessmentQueue === "object"
    ? metadata.assessmentQueue as Record<string, unknown>
    : undefined;
  return assessmentQueue?.status === "done";
}

async function writeAssessmentQueueMetadata(
  filename: string,
  metadata: Record<string, unknown>,
  source: AudioAssessment["source"],
  queuedAt: string,
  status: "queued" | "failed",
  error?: string,
) {
  const audioPath = outputPathForAudio(outputDir(), filename);
  const metaPath = metadataPathForAudio(audioPath);
  const updated = {
    ...metadata,
    assessmentQueue: {
      status,
      queuedAt,
      source,
      ...(error ? { error } : {}),
    },
  };
  await mkdir(path.dirname(metaPath), { recursive: true });
  await writeFile(metaPath, JSON.stringify(updated, null, 2));
}

async function readAssessmentQueue(): Promise<AssessmentQueueJob[]> {
  try {
    const parsed = JSON.parse(await readFile(queuePath(), "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isAssessmentQueueJob) : [];
  } catch {
    return [];
  }
}

async function writeAssessmentQueue(queue: AssessmentQueueJob[]) {
  await mkdir(path.dirname(queuePath()), { recursive: true });
  await writeFile(queuePath(), JSON.stringify(queue, null, 2));
}

function isAssessmentQueueJob(value: unknown): value is AssessmentQueueJob {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Record<keyof AssessmentQueueJob, unknown>>;
  return typeof record.filename === "string"
    && isSafeAudioFilename(record.filename)
    && (record.source === "library" || record.source === "radio")
    && typeof record.queuedAt === "string"
    && typeof record.attempts === "number";
}

function parseAssessorOutput(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function runAssessorCommand(command: string, payload: unknown, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const { file, args } = parseAssessorCommand(command);
    const child = spawn(file, args, { cwd: process.cwd(), env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      stderr += `\nTimed out after ${timeoutMs}ms`;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}${error.message}`.slice(-8000) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.slice(-16000), stderr: stderr.slice(-8000) });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function parseAssessorCommand(command: string) {
  const parts: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;
  let escaping = false;
  for (const char of command.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaping) current += "\\";
  if (quote) throw new AudioAssessmentError("Invalid STABLE_AUDIO_ASSESSOR_COMMAND: unmatched quote", 400);
  if (current) parts.push(current);
  if (!parts.length) throw new AudioAssessmentError("Invalid STABLE_AUDIO_ASSESSOR_COMMAND", 400);
  const [file, ...args] = parts;
  return { file, args };
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => readString(item)).filter(Boolean) as string[];
  const single = readString(value);
  return single ? [single] : [];
}
