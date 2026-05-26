import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const TITLE_SYSTEM_PROMPT = `You are a creative music title generator. Given a description of audio, generate a short, evocative title (2-6 words). Return ONLY the title text with no quotes, no punctuation at the end, no explanation. Be creative and concise. The mode is {mode}.`;

function cleanTitle(raw: string): string {
  let title = raw.trim();
  if (
    (title.startsWith('"') && title.endsWith('"')) ||
    (title.startsWith("'") && title.endsWith("'"))
  ) {
    title = title.slice(1, -1);
  }
  title = title.replace(/[.,!?]+$/, "");
  return title.trim();
}

export async function generateTitle(prompt: string, mode: string): Promise<string | null> {
  const ollamaPort = process.env.OLLAMA_PORT || "11434";
  const model = process.env.OLLAMA_TITLE_MODEL || "phi4-mini";
  const systemPrompt = TITLE_SYSTEM_PROMPT.replace("{mode}", mode);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(`http://localhost:${ollamaPort}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, system: systemPrompt, prompt, stream: false }),
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) return null;

  const data = await response.json();
  const title = cleanTitle(data.response ?? "");
  return title || null;
}

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
