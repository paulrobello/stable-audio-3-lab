import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { normalizeGenerationRequest } from "@/lib/generation";
import { buildLibraryMetadata, metadataPathForAudio } from "@/lib/library";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = normalizeGenerationRequest(body);
    const outputDir = path.join(process.cwd(), "public", "outputs");
    await mkdir(outputDir, { recursive: true });
    const filename = `sa3-${input.mode}-${Date.now()}.${input.format}`;
    const outPath = path.join(outputDir, filename);
    const python = process.env.STABLE_AUDIO_PYTHON || "python3";
    const mock = input.mock || process.env.STABLE_AUDIO_MOCK === "true";
    const args = [
      path.join(process.cwd(), "scripts", "generate_audio.py"),
      "--mode", input.mode,
      "--model", input.model,
      "--prompt", input.prompt,
      "--negative-prompt", input.negativePrompt || "",
      "--duration", String(input.duration),
      "--steps", String(input.steps),
      "--cfg-scale", String(input.cfgScale),
      "--format", input.format,
      "--out", outPath,
    ];
    if (input.seed !== undefined) args.push("--seed", String(input.seed));
    if (mock) args.push("--mock");

    const startedAt = Date.now();
    const result = await runProcess(python, args, Number(process.env.STABLE_AUDIO_TIMEOUT_MS || 900000));
    const generationDurationMs = Date.now() - startedAt;
    if (result.code !== 0) {
      return NextResponse.json({ ok: false, error: "Python generator failed", detail: { ...result, generationDurationMs } }, { status: 500 });
    }
    const meta = buildLibraryMetadata({ filename, input, python: result, generationDurationMs });
    await writeFile(metadataPathForAudio(outPath), JSON.stringify(meta, null, 2));
    return NextResponse.json({ ok: true, audioUrl: `/outputs/${filename}`, metadataUrl: meta.metadataUrl, filename, meta });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 400 });
  }
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: { ...process.env }, cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      stderr += `\nTimed out after ${timeoutMs}ms`;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.slice(-8000), stderr: stderr.slice(-8000) });
    });
  });
}
