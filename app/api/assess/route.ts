import { NextRequest, NextResponse } from "next/server";
import { assessAudioFile, AudioAssessmentError } from "@/lib/audio-assessment";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const filename = typeof body.filename === "string" ? body.filename : "";
    const result = await assessAudioFile({
      filename,
      source: body.source === "radio" ? "radio" : "library",
      title: typeof body.title === "string" ? body.title : undefined,
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
      styleId: typeof body.styleId === "string" ? body.styleId : undefined,
      rating: typeof body.rating === "string" || typeof body.rating === "number" ? body.rating : undefined,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AudioAssessmentError) {
      return NextResponse.json({ ok: false, error: error.message, detail: error.detail }, { status: error.status });
    }
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    const status = code === "ENOENT" ? 404 : error instanceof Error && /Invalid/.test(error.message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status });
  }
}
