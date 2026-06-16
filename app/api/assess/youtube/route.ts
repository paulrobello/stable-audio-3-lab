import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { buildGenerationPromptFromAssessment } from "@/lib/assessment-prompt";
import { assessUploadedAudioFile, AudioAssessmentError } from "@/lib/audio-assessment";

export const runtime = "nodejs";
export const maxDuration = 300;

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

export async function POST(request: NextRequest) {
  let uploadPath: string | undefined;
  try {
    const body = await request.json() as unknown;
    const url = parseYouTubeUrl(body);
    if (!url) {
      return NextResponse.json({ ok: false, error: "Enter a YouTube URL" }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), ".stable-audio-assessments", "uploads");
    await mkdir(uploadDir, { recursive: true });
    const filename = `youtube-reference-${randomUUID()}.mp3`;
    uploadPath = path.join(uploadDir, filename);

    await runCodexYouTubeExtraction(url, uploadPath);

    const result = await assessUploadedAudioFile({
      audioPath: uploadPath,
      filename,
      title: url,
    });
    const generated = buildGenerationPromptFromAssessment(result.assessment);
    return NextResponse.json({ ok: true, filename, title: url, ...result, ...generated });
  } catch (error) {
    if (error instanceof AudioAssessmentError) {
      return NextResponse.json({ ok: false, error: error.message, detail: error.detail }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  } finally {
    if (uploadPath) await rm(uploadPath, { force: true });
  }
}

function parseYouTubeUrl(body: unknown) {
  const rawUrl = body && typeof body === "object" ? (body as { url?: unknown }).url : undefined;
  if (typeof rawUrl !== "string") return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    const host = parsed.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(host)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

async function runCodexYouTubeExtraction(url: string, outputPath: string) {
  const codexBin = process.env.STABLE_AUDIO_YOUTUBE_CODEX_BIN || "codex";
  const model = normalizeCodexModel(process.env.STABLE_AUDIO_YOUTUBE_CODEX_MODEL);
  const timeoutMs = normalizeTimeout(process.env.STABLE_AUDIO_YOUTUBE_CODEX_TIMEOUT_MS, 300000);
  const args = [
    "exec",
    "-m",
    model,
    "--cd",
    process.cwd(),
    "--sandbox",
    "workspace-write",
    "--config",
    "approval_policy=\"never\"",
    "--ephemeral",
    "--ignore-rules",
    "-",
  ];
  const prompt = buildCodexExtractionPrompt(url, outputPath);
  const child = await spawnRuntimeProcess(codexBin, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      YOUTUBE_AUDIO_EXTRACT_URL: url,
      YOUTUBE_AUDIO_EXTRACT_OUTPUT_PATH: outputPath,
    },
    stdio: ["pipe", "ignore", "pipe"],
  });

  return new Promise<void>((resolve, reject) => {
    const stderr: Buffer[] = [];
    let timedOut = false;
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => child.kill("SIGKILL"), 1000);
    }, timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      if (timedOut) {
        reject(new Error("YouTube audio extraction timed out"));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`YouTube audio extraction failed: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    child.stdin.end(prompt);
  });
}

async function spawnRuntimeProcess(command: string, args: string[], options?: SpawnOptions): Promise<ChildProcessWithoutNullStreams> {
  const { spawn } = await import("node:child_process");
  return spawn(command, args, options ?? {}) as ChildProcessWithoutNullStreams;
}

function buildCodexExtractionPrompt(url: string, outputPath: string) {
  return [
    "Use the local YouTube audio extraction skill at skills/youtube-audio-extract/SKILL.md.",
    "Extract audio from this YouTube URL as MP3.",
    `URL: ${url}`,
    `Output MP3 path: ${outputPath}`,
    "Save the final converted MP3 exactly at the output path above.",
    "If you use yt-dlp with an output template, use the same path without the .mp3 suffix plus .%(ext)s, then ensure the finished MP3 is moved to the exact output path.",
    "Do not write anything into public/outputs or the generated audio library.",
  ].join("\n");
}

function normalizeCodexModel(value: unknown) {
  if (typeof value !== "string") return "gpt-5.5";
  const model = value.trim();
  return model && model.length <= 80 && !/[\s"'<>]/.test(model) ? model : "gpt-5.5";
}

function normalizeTimeout(value: unknown, fallback: number) {
  const timeout = typeof value === "string" ? Number(value) : undefined;
  return timeout && Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}
