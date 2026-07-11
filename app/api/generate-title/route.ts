import { NextRequest, NextResponse } from "next/server";
import { generateTitle } from "@/lib/server/ollama";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.prompt || typeof body.prompt !== "string") {
      return NextResponse.json({ ok: false, error: "Missing or invalid 'prompt' field" }, { status: 400 });
    }
    const mode = body.mode === "sfx" ? "sfx" : "music";
    const title = await generateTitle(body.prompt, mode);
    if (!title) {
      return NextResponse.json({ ok: false, error: "Empty title generated" }, { status: 200 });
    }
    return NextResponse.json({ ok: true, title });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 400 });
  }
}
