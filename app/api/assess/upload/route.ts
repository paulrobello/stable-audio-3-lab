import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { buildGenerationPromptFromAssessment } from "@/lib/assessment-prompt";
import { assessUploadedAudioFile, AudioAssessmentError } from "@/lib/audio-assessment";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED_EXTENSIONS = new Set([".mp3", ".wav", ".m4p"]);

export async function POST(request: NextRequest) {
  let uploadPath: string | undefined;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!isUploadedFile(file)) {
      return NextResponse.json({ ok: false, error: "Missing audio file" }, { status: 400 });
    }

    const originalName = file.name.trim() || "uploaded-audio";
    const extension = path.extname(originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return NextResponse.json({ ok: false, error: "Upload an MP3, WAV, or M4P file" }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), ".stable-audio-assessments", "uploads");
    await mkdir(uploadDir, { recursive: true });
    uploadPath = path.join(uploadDir, `${randomUUID()}${extension}`);
    await writeFile(uploadPath, Buffer.from(await file.arrayBuffer()));

    const title = readFormString(form.get("title")) ?? originalName.replace(/\.(mp3|wav|m4p)$/i, "");
    const result = await assessUploadedAudioFile({
      audioPath: uploadPath,
      filename: originalName,
      title,
    });
    const generated = buildGenerationPromptFromAssessment(result.assessment);
    return NextResponse.json({ ok: true, ...result, ...generated });
  } catch (error) {
    if (error instanceof AudioAssessmentError) {
      return NextResponse.json({ ok: false, error: error.message, detail: error.detail }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  } finally {
    if (uploadPath) await rm(uploadPath, { force: true });
  }
}

function readFormString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value !== "object") return false;
  return "arrayBuffer" in value
    && typeof value.arrayBuffer === "function"
    && "name" in value
    && typeof value.name === "string";
}
