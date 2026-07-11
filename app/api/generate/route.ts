import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { normalizeGenerationRequest } from "@/lib/generation";
import { buildGeneratorArgs, resolveGenerationBackend } from "@/lib/generator-backend";
import { buildLibraryMetadata, metadataPathForAudio, titleToFilename } from "@/lib/library";
import { withGenerationSlot } from "@/lib/server/concurrency";
import { generateTitle } from "@/lib/server/ollama";
import { runCommand } from "@/lib/server/subprocess";
import { stableAudioBackend, stableAudioMock, stableAudioPython, stableAudioTimeoutMs } from "@/lib/server/config";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = normalizeGenerationRequest(body);
    const outputDir = path.join(process.cwd(), "public", "outputs");
    await mkdir(outputDir, { recursive: true });

    let title: string | undefined = input.title;
    if (!title && input.autoTitle) {
      title = await generateTitle(input.prompt, input.mode) ?? undefined;
    }

    const filename = title
      ? await titleToFilename(title, input.format, outputDir, input.mode)
      : `sa3-${input.mode}-${Date.now()}.${input.format}`;
    const outPath = path.join(outputDir, filename);
    const python = stableAudioPython();
    const mock = input.mock || stableAudioMock();
    const backend = resolveGenerationBackend({ envBackend: stableAudioBackend(), mock });
    const args = buildGeneratorArgs({
      scriptPath: path.join(process.cwd(), "scripts", "generate_audio.py"),
      outputPath: outPath,
      input,
      backend,
      mock,
    });

    const startedAt = Date.now();
    const result = await withGenerationSlot(() => runCommand(python, args, { timeoutMs: stableAudioTimeoutMs() }));
    const generationDurationMs = Date.now() - startedAt;
    if (result.code !== 0) {
      // Log the full subprocess output server-side only; never echo it to the
      // client, where it could leak absolute host paths or backend config.
      console.error("[generate] Python generator failed", { code: result.code, generationDurationMs, stdout: result.stdout, stderr: result.stderr });
      return NextResponse.json({ ok: false, error: "Generation failed", generationDurationMs }, { status: 500 });
    }
    const meta = buildLibraryMetadata({ filename, input, python: result, backend, generationDurationMs, title });
    await writeFile(metadataPathForAudio(outPath), JSON.stringify(meta, null, 2));
    return NextResponse.json({ ok: true, audioUrl: `/outputs/${filename}`, metadataUrl: meta.metadataUrl, filename, title, meta });
  } catch (error) {
    // Validation messages (Zod) are safe and user-facing; everything else
    // (filesystem paths, tracebacks) is logged server-side only and replaced
    // with a generic message so internal detail is not disclosed.
    console.error("[generate] request failed", error);
    if (isValidationError(error)) {
      return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "Generation request failed" }, { status: 500 });
  }
}

function isValidationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; issues?: unknown };
  return record.name === "ZodError" || Array.isArray(record.issues);
}
