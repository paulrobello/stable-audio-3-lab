import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { isSafeAudioFilename, metadataPathForAudio, metadataUrlForAudio, outputPathForAudio } from "@/lib/library";

export const runtime = "nodejs";
export const maxDuration = 300;

type AssessmentSource = "library" | "radio";

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

type AudioAssessment = {
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

const outputDir = () => path.join(process.cwd(), "public", "outputs");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const filename = typeof body.filename === "string" ? body.filename.trim() : "";
    if (!isSafeAudioFilename(filename)) {
      return NextResponse.json({ ok: false, error: "Invalid audio filename" }, { status: 400 });
    }

    const assessorCommand = process.env.STABLE_AUDIO_ASSESSOR_COMMAND;
    if (!assessorCommand) {
      return NextResponse.json({
        ok: false,
        error: "Set STABLE_AUDIO_ASSESSOR_COMMAND to a local audio assessment command.",
      }, { status: 503 });
    }

    const audioPath = outputPathForAudio(outputDir(), filename);
    await stat(audioPath);
    const metaPath = metadataPathForAudio(audioPath);
    let metadata: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(await readFile(metaPath, "utf8")) as unknown;
      metadata = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      metadata = { filename, audioUrl: `/outputs/${filename}`, metadataUrl: metadataUrlForAudio(filename) };
    }

    const source = normalizeAssessmentSource(body.source);
    const sourceInfo = buildAssessmentSource({ filename, source, body, metadata });
    const assessmentPrompt = buildAssessmentPrompt(sourceInfo);
    const commandResult = await runAssessorCommand(assessorCommand, {
      audioPath,
      filename,
      source: sourceInfo,
      metadata,
      prompt: assessmentPrompt,
    }, Number(process.env.STABLE_AUDIO_ASSESSOR_TIMEOUT_MS || 300000));
    if (commandResult.code !== 0) {
      return NextResponse.json({
        ok: false,
        error: "Local audio assessor failed",
        detail: commandResult,
      }, { status: 500 });
    }

    const assessment = normalizeAssessment(commandResult.stdout, sourceInfo);
    const updated = appendAssessmentMetadata(metadata, assessment);
    await mkdir(path.dirname(metaPath), { recursive: true });
    await writeFile(metaPath, JSON.stringify(updated, null, 2));
    return NextResponse.json({ ok: true, assessment, meta: updated });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    const status = code === "ENOENT" ? 404 : error instanceof Error && /Invalid/.test(error.message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status });
  }
}

function normalizeAssessmentSource(value: unknown): AssessmentSource {
  return value === "radio" ? "radio" : "library";
}

function buildAssessmentSource({
  filename,
  source,
  body,
  metadata,
}: {
  filename: string;
  source: AssessmentSource;
  body: Record<string, unknown>;
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

function appendAssessmentMetadata(metadata: Record<string, unknown>, assessment: AudioAssessment) {
  const previous = Array.isArray(metadata.assessments) ? metadata.assessments : [];
  return {
    ...metadata,
    latestAssessment: assessment,
    assessments: [...previous, assessment].slice(-20),
  };
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
  if (quote) throw new Error("Invalid STABLE_AUDIO_ASSESSOR_COMMAND: unmatched quote");
  if (current) parts.push(current);
  if (!parts.length) throw new Error("Invalid STABLE_AUDIO_ASSESSOR_COMMAND");
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
