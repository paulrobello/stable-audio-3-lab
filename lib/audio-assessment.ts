import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { cpus, loadavg } from "node:os";
import path from "node:path";
import { isSafeAudioFilename, metadataPathForAudio, metadataUrlForAudio, outputPathForAudio } from "./library";
import { readJsonWithBackup, writeJsonAtomic } from "./server/atomic-json-store";
import { withGenerationSlot } from "./server/concurrency";
import { runCommand } from "./server/subprocess";
import { stableAudioAssessorCommand, stableAudioAssessorTimeoutMs } from "./server/config";

export const AUDIO_ASSESSMENT_LOAD_THRESHOLD = 0.25;

/** Max attempts before a failing job is dead-lettered (QA-001). */
const ASSESSMENT_MAX_ATTEMPTS = 3;

export type AssessmentSource = "library" | "radio" | "upload";

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

// The "only one processor" / "only one retry timer" invariants must survive
// Next.js dev HMR, which re-instantiates module scope and would otherwise spawn
// a parallel processor loop against the same persisted queue file. Pin both to
// globalThis keyed by a stable name, mirroring the admission-control singleton
// in `concurrency.ts`. Behavior is identical; only the storage moves.
const ASSESSMENT_SINGLETON_KEY = "__stableAudioAssessment__";
type AssessmentSingletons = {
  queueProcessor: Promise<void> | undefined;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
};
function assessmentStore(): AssessmentSingletons {
  const g = globalThis as unknown as Partial<Record<typeof ASSESSMENT_SINGLETON_KEY, AssessmentSingletons>>;
  if (!g[ASSESSMENT_SINGLETON_KEY]) {
    g[ASSESSMENT_SINGLETON_KEY] = { queueProcessor: undefined, retryTimer: undefined };
  }
  return g[ASSESSMENT_SINGLETON_KEY]!;
}

const outputDir = () => path.join(process.cwd(), "public", "outputs");
const queuePath = () => path.join(process.cwd(), ".stable-audio-assessments", "queue.json");
const deadLetterPath = () => path.join(process.cwd(), ".stable-audio-assessments", "dead-letter.json");

export async function assessAudioFile(request: AudioAssessmentRequest) {
  const filename = normalizeSafeFilename(request.filename);
  const assessorCommand = stableAudioAssessorCommand();
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
  const commandResult = await withGenerationSlot(() => runAssessorCommand(assessorCommand, {
    audioPath,
    filename,
    source: sourceInfo,
    metadata,
    prompt: buildAssessmentPrompt(sourceInfo),
  }, stableAudioAssessorTimeoutMs()));
  if (commandResult.code !== 0) {
    throw new AudioAssessmentError("Local audio assessor failed", 500, commandResult);
  }

  const assessment = normalizeAssessment(commandResult.stdout, sourceInfo);
  const updated = appendAssessmentMetadata(metadata, assessment, "done");
  await mkdir(path.dirname(metaPath), { recursive: true });
  await writeFile(metaPath, JSON.stringify(updated, null, 2));
  return { assessment, meta: updated };
}

export async function assessUploadedAudioFile(request: { audioPath: string; filename: string; title?: string; prompt?: string }) {
  const assessorCommand = stableAudioAssessorCommand();
  if (!assessorCommand) {
    throw new AudioAssessmentError("Set STABLE_AUDIO_ASSESSOR_COMMAND to a local audio assessment command.", 503);
  }

  await stat(request.audioPath);
  const sourceInfo: AudioAssessment["source"] = {
    filename: request.filename,
    audioUrl: "",
    metadataUrl: "",
    source: "upload",
    title: readString(request.title) ?? request.filename,
    prompt: readString(request.prompt),
  };
  const commandResult = await withGenerationSlot(() => runAssessorCommand(assessorCommand, {
    audioPath: request.audioPath,
    filename: request.filename,
    source: sourceInfo,
    metadata: {},
    prompt: buildUploadAssessmentPrompt(sourceInfo),
  }, stableAudioAssessorTimeoutMs()));
  if (commandResult.code !== 0) {
    throw new AudioAssessmentError("Local audio assessor failed", 500, commandResult);
  }

  return { assessment: normalizeAssessment(commandResult.stdout, sourceInfo) };
}

export async function enqueueAudioAssessment(request: AudioAssessmentRequest) {
  const filename = normalizeSafeFilename(request.filename);
  const metadata = await readAudioMetadata(filename);
  const queue = await readAssessmentQueue();
  const sourceInfo = buildAssessmentSource({
    filename,
    source: request.source === "radio" ? "radio" : "library",
    body: request,
    metadata,
  });
  // Dedupe on the full job identity (filename + rating) so a re-rated track
  // can re-queue while an identical repeat is still skipped (QA-014).
  const jobId = `${filename}:${sourceInfo.rating ?? "unrated"}`;
  if (hasFinishedAssessment(metadata) || queue.some((item) => item.id === jobId)) return undefined;
  const queuedAt = new Date().toISOString();
  const job: AssessmentQueueJob = {
    id: jobId,
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
  const store = assessmentStore();
  if (store.queueProcessor) return store.queueProcessor;
  store.queueProcessor = processAudioAssessmentQueue()
    .then((result) => {
      if (result.deferred) scheduleAssessmentQueueRetry();
    })
    .catch(() => {
      scheduleAssessmentQueueRetry();
    })
    .finally(() => {
      store.queueProcessor = undefined;
    });
  return store.queueProcessor;
}

export async function processAudioAssessmentQueue(options: { loadRatio?: number } = {}) {
  if (!stableAudioAssessorCommand()) return { processed: 0, deferred: false };

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
      const errorMessage = error instanceof Error ? error.message : "Audio assessment failed";
      await writeAssessmentQueueMetadata(
        job.filename,
        metadata,
        buildAssessmentSource({ filename: job.filename, source: job.source, body: job, metadata }),
        failedAt,
        "failed",
        errorMessage,
      );
      const nextAttempts = job.attempts + 1;
      if (nextAttempts >= ASSESSMENT_MAX_ATTEMPTS) {
        // Poison job: dead-letter it and continue processing the rest so the
        // queue never permanently stalls on one bad track (QA-001).
        await appendToDeadLetter({ ...job, attempts: nextAttempts }, errorMessage, failedAt);
        await writeAssessmentQueue(remaining);
        continue;
      }
      // Re-queue at the TAIL and schedule a deferred retry so jobs behind the
      // failed one get their turn (backoff is the existing 60s retry timer).
      await writeAssessmentQueue([...remaining, { ...job, attempts: nextAttempts, queuedAt: failedAt }].slice(-200));
      return { processed, deferred: true };
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
  const store = assessmentStore();
  if (store.retryTimer) return;
  store.retryTimer = setTimeout(() => {
    store.retryTimer = undefined;
    void startAudioAssessmentQueueProcessing();
  }, 60_000);
  store.retryTimer.unref?.();
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

function buildUploadAssessmentPrompt(source: AudioAssessment["source"]) {
  return [
    "Listen carefully to this audio and extract every musical attribute needed to recreate a similar track with an AI music generator.",
    "Return JSON with summary, genre, instruments, rhythm, tempoBpm if confident, key if confident, mood, production, positives, and negatives.",
    "Be specific about instrumentation (exact instrument types, not categories), production techniques (reverb, delay, compression, stereo width), and arrangement details (intros, breakdowns, drops, layering).",
    "For rhythm, describe the groove, swing, and drum pattern character — not just the tempo.",
    "For mood, capture the emotional arc and energy level across the track.",
    source.title ? `Title: ${source.title}` : undefined,
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
  const result = await readJsonWithBackup(queuePath());
  if (result.status === "ok") {
    const parsed = result.data;
    return Array.isArray(parsed) ? (parsed as unknown[]).filter(isAssessmentQueueJob) : [];
  }
  // `missing` (first run) and `corrupt` (already backed up + logged by the
  // shared reader) both fall back to an empty queue so processing continues.
  return [];
}

async function writeAssessmentQueue(queue: AssessmentQueueJob[]) {
  // Atomic (tmp + rename) and serialized with concurrent queue writers via the
  // shared per-path lock.
  await writeJsonAtomic(queuePath(), queue);
}

type DeadLetterEntry = AssessmentQueueJob & { deadLetteredAt: string; error: string };

async function appendToDeadLetter(job: AssessmentQueueJob, error: string, deadLetteredAt: string) {
  const existing = await readDeadLetter();
  const entry: DeadLetterEntry = { ...job, deadLetteredAt, error };
  // Cap the dead-letter log to the same 200-entry ceiling as the queue.
  await writeJsonAtomic(deadLetterPath(), [...existing, entry].slice(-200));
  console.error(`[audio-assessment] Dead-lettered job ${job.id} after ${job.attempts} failed attempt(s): ${error}`);
}

async function readDeadLetter(): Promise<DeadLetterEntry[]> {
  const result = await readJsonWithBackup(deadLetterPath());
  if (result.status === "ok") {
    const parsed = result.data;
    return Array.isArray(parsed) ? (parsed as unknown[]).filter(isAssessmentQueueJob) as DeadLetterEntry[] : [];
  }
  return [];
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
    return parseFirstJsonObject(trimmed);
  }
}

function parseFirstJsonObject(text: string) {
  for (let index = text.indexOf("{"); index >= 0; index = text.indexOf("{", index + 1)) {
    const candidate = readBalancedJsonObject(text, index);
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Keep scanning; earlier braces can come from warnings or log text.
    }
  }
  return undefined;
}

function readBalancedJsonObject(text: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

function runAssessorCommand(command: string, payload: unknown, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const { file, args } = parseAssessorCommand(command);
  // Delegates to the shared runner (ARC-007): the assessor is the reference
  // pattern that already had an `error` handler, so behavior is preserved on the
  // success/failure paths and timeout now escalates SIGTERM → SIGKILL instead of
  // only signaling SIGTERM (matching the Python side's `terminate_process_tree`).
  return runCommand(file, args, { timeoutMs, stdin: JSON.stringify(payload), stdoutLimit: 16_000 });
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
