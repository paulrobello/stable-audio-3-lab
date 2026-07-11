import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { buildGenerationPromptFromAssessment } from "@/lib/assessment-prompt";
import { assessUploadedAudioFile, AudioAssessmentError } from "@/lib/audio-assessment";
import { runCommand } from "@/lib/server/subprocess";
import { ffmpegBin, stableAudioYoutubeTimeoutMs, stableAudioYoutubeYtdlpBin } from "@/lib/server/config";

export const runtime = "nodejs";
export const maxDuration = 300;

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

// Deterministic YouTube reference-track extraction.
//
// This replaces an autonomous `codex exec` agent (workspace-write sandbox,
// approvals disabled, attacker-controlled URL embedded in the prompt) with a
// fixed-argument yt-dlp + ffmpeg subprocess — no LLM, no agent, no prompt
// surface that a crafted URL or page title could inject into (SEC-002).
//
// Binaries are resolved via the same env vars the rest of the app uses:
//   STABLE_AUDIO_YOUTUBE_YTDLP_BIN  (default "yt-dlp")
//   FFMPEG_PATH                      (optional; its directory is passed to
//                                    yt-dlp via --ffmpeg-location)

export async function POST(request: NextRequest) {
  let intermediateMp3: string | undefined;
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

    intermediateMp3 = await extractYouTubeAudio(url, uploadPath, uploadDir);

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
    // Subprocess detail (host paths, yt-dlp output) is logged server-side only.
    console.error("[youtube] extraction/assessment failed", error);
    return NextResponse.json({ ok: false, error: "YouTube audio extraction failed" }, { status: 500 });
  } finally {
    if (uploadPath) await rm(uploadPath, { force: true });
    if (intermediateMp3) await rm(intermediateMp3, { force: true });
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

/**
 * Download and convert a YouTube URL to an MP3 at `outputPath` using yt-dlp +
 * ffmpeg with a fixed argument array. Returns the intermediate file path so the
 * caller can clean it up separately from the final output.
 */
async function extractYouTubeAudio(url: string, outputPath: string, uploadDir: string): Promise<string> {
  const ytdlp = stableAudioYoutubeYtdlpBin();
  const intermediateBase = path.join(uploadDir, `ytdl-${randomUUID()}`);
  const intermediateMp3 = `${intermediateBase}.mp3`;

  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--newline",
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "0",
    ...ffmpegLocationArgs(),
    "-o", `${intermediateBase}.%(ext)s`,
    url,
  ];

  // Delegates to the shared runner (ARC-007): stdin ignored (yt-dlp reads none),
  // matching this route's previous stdio arrangement; the runner's `error`
  // handler and SIGTERM → SIGKILL escalation are now shared everywhere.
  const result = await runCommand(ytdlp, args, { timeoutMs: stableAudioYoutubeTimeoutMs(), stdin: "ignore" });
  if (result.code !== 0) {
    throw new Error(`yt-dlp exited with code ${result.code}`);
  }

  try {
    await stat(intermediateMp3);
  } catch {
    throw new Error("yt-dlp did not produce an MP3 output file");
  }

  await rename(intermediateMp3, outputPath);
  return intermediateMp3;
}

function ffmpegLocationArgs(): string[] {
  const ffmpegPath = ffmpegBin();
  // Only hint yt-dlp when FFMPEG_PATH points at an actual file location; a bare
  // binary name on PATH (no separator) needs no --ffmpeg-location. `ffmpegBin()`
  // returns "ffmpeg" when unset, which contains no separator and correctly yields
  // no hint (matching the previous unset behavior).
  if (ffmpegPath.includes("/") || ffmpegPath.includes("\\")) {
    const dir = path.dirname(ffmpegPath);
    if (dir && dir !== ".") return ["--ffmpeg-location", dir];
  }
  return [];
}
