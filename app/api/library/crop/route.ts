import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";
import { buildCropFilename, buildCropMetadata, isSafeAudioFilename, metadataPathForAudio, normalizeCropWindow, validateCropFitsDuration } from "@/lib/library";
import { withGenerationSlot } from "@/lib/server/concurrency";
import { runCommand } from "@/lib/server/subprocess";
import { ffmpegBin, ffprobeBin, stableAudioTimeoutMs } from "@/lib/server/config";

export const runtime = "nodejs";
export const maxDuration = 900;

const outputDir = () => path.join(process.cwd(), "public", "outputs");

export async function POST(request: NextRequest) {
  try {
    const { filename, start, end } = (await request.json()) as { filename?: string; start?: number; end?: number };
    if (!filename || !isSafeAudioFilename(filename)) {
      return NextResponse.json({ ok: false, error: "Invalid filename" }, { status: 400 });
    }
    const crop = normalizeCropWindow({ start: Number(start), end: Number(end) });
    const sourcePath = path.join(outputDir(), filename);
    await stat(sourcePath);
    const sourceDuration = await probeAudioDuration(sourcePath);
    validateCropFitsDuration(crop, sourceDuration);

    const cropFilename = buildCropFilename(filename, crop.start, crop.end);
    const cropPath = path.join(outputDir(), cropFilename);
    const args = buildFfmpegCropArgs({ sourcePath, cropPath, crop, format: cropFilename.endsWith(".mp3") ? "mp3" : "wav" });
    const ffmpeg = ffmpegBin();
    const result = await withGenerationSlot(() => runCommand(ffmpeg, args, { timeoutMs: stableAudioTimeoutMs() }));
    if (result.code !== 0) {
      // Log subprocess detail server-side only; return a generic message.
      console.error("[crop] ffmpeg crop failed", { code: result.code, stdout: result.stdout, stderr: result.stderr });
      return NextResponse.json({ ok: false, error: "Crop failed" }, { status: 500 });
    }

    let sourceMetadata: unknown = {};
    try {
      sourceMetadata = JSON.parse(await readFile(metadataPathForAudio(sourcePath), "utf8"));
    } catch {
      sourceMetadata = { filename, audioUrl: `/outputs/${filename}` };
    }
    const meta = buildCropMetadata({ sourceFilename: filename, cropFilename, sourceMetadata, crop });
    await writeFile(metadataPathForAudio(cropPath), JSON.stringify(meta, null, 2));

    return NextResponse.json({ ok: true, filename: cropFilename, audioUrl: `/outputs/${cropFilename}`, metadataUrl: meta.metadataUrl, meta });
  } catch (error) {
    // Validation messages (filename/crop-window checks) are safe and user-facing;
    // everything else (filesystem paths, ffprobe output) is logged server-side
    // only and replaced with a generic message.
    console.error("[crop] request failed", error);
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    if (code === "ENOENT") return NextResponse.json({ ok: false, error: "Source audio not found" }, { status: 404 });
    if (error instanceof Error && /^Invalid /.test(error.message)) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "Crop request failed" }, { status: 500 });
  }
}

function buildFfmpegCropArgs({ sourcePath, cropPath, crop, format }: { sourcePath: string; cropPath: string; crop: { start: number; duration: number }; format: "mp3" | "wav" }) {
  const codecArgs = format === "mp3" ? ["-codec:a", "libmp3lame", "-q:a", "2"] : ["-codec:a", "pcm_s16le"];
  return ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(crop.start), "-i", sourcePath, "-t", String(crop.duration), ...codecArgs, cropPath];
}

async function probeAudioDuration(sourcePath: string) {
  const ffprobe = ffprobeBin();
  const result = await runCommand(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", sourcePath], { timeoutMs: 30_000 });
  if (result.code !== 0) {
    console.error("[crop] ffprobe duration failed", { code: result.code, stdout: result.stdout, stderr: result.stderr });
    throw new Error("Unable to determine source audio duration");
  }
  const duration = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Unable to determine source audio duration");
  return duration;
}
