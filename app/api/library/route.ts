import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { applyLibraryAnnotationMetadata, isFavoriteMetadata, isSafeAudioFilename, metadataPathForAudio, metadataUrlForAudio, readBatchRunId, toggleFavoriteMetadata } from "@/lib/library";

export const runtime = "nodejs";

type LibraryItem = {
  filename: string;
  audioUrl: string;
  downloadUrl: string;
  metadataUrl: string;
  format: "mp3" | "wav";
  bytes: number;
  createdAt: string;
  favorite: boolean;
  notes?: string;
  rating?: number;
  title?: string;
  bundleUrl: string;
  batchRunId?: string;
  batchBundleUrl?: string;
  meta?: unknown;
};

const outputDir = () => path.join(process.cwd(), "public", "outputs");

export async function GET() {
  try {
    const dir = outputDir();
    await mkdir(dir, { recursive: true });
    const names = await readdir(dir);
    const audioNames = names.filter(isSafeAudioFilename);
    const items: LibraryItem[] = await Promise.all(
      audioNames.map(async (filename) => {
        const fullPath = path.join(dir, filename);
        const info = await stat(fullPath);
        const metaPath = metadataPathForAudio(fullPath);
        let meta: unknown = undefined;
        try {
          meta = JSON.parse(await readFile(metaPath, "utf8"));
        } catch {
          // Older generated files may not have sidecar metadata. That's fine.
        }
        const format = filename.endsWith(".mp3") ? "mp3" : "wav";
        const metaRecord = meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
        const batchRunId = readBatchRunId(meta);
        const rating = typeof metaRecord.rating === "number" && Number.isFinite(metaRecord.rating) ? metaRecord.rating : undefined;
        const notes = typeof metaRecord.notes === "string" ? metaRecord.notes : undefined;
        const title = typeof metaRecord.title === "string" ? metaRecord.title : undefined;
        return {
          filename,
          audioUrl: `/outputs/${filename}`,
          downloadUrl: `/outputs/${filename}`,
          metadataUrl: metadataUrlForAudio(filename),
          format,
          bytes: info.size,
          createdAt: info.birthtime.toISOString(),
          favorite: isFavoriteMetadata(meta),
          notes,
          rating,
          title,
          bundleUrl: `/api/library/bundle?filename=${encodeURIComponent(filename)}`,
          batchRunId,
          batchBundleUrl: batchRunId ? `/api/library/bundle?batchRunId=${encodeURIComponent(batchRunId)}` : undefined,
          meta,
        };
      }),
    );
    items.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { filename?: string; favorite?: boolean; notes?: string; rating?: number | string | null; title?: string };
    const { filename } = body;
    const hasFavorite = typeof body.favorite === "boolean";
    const hasAnnotation = "notes" in body || "rating" in body;
    const hasTitle = "title" in body;
    if (!filename || !isSafeAudioFilename(filename) || (!hasFavorite && !hasAnnotation && !hasTitle)) {
      return NextResponse.json({ ok: false, error: "Invalid library metadata request" }, { status: 400 });
    }
    const fullPath = path.join(outputDir(), filename);
    await stat(fullPath);
    const metaPath = metadataPathForAudio(fullPath);
    let meta: unknown = {};
    try {
      meta = JSON.parse(await readFile(metaPath, "utf8"));
    } catch {
      meta = { filename, audioUrl: `/outputs/${filename}`, metadataUrl: metadataUrlForAudio(filename) };
    }
    let updated = meta;
    if (hasFavorite) updated = toggleFavoriteMetadata(updated, body.favorite!);
    if (hasAnnotation) updated = applyLibraryAnnotationMetadata(updated, body);
    if (hasTitle) updated = { ...(typeof updated === "object" && updated !== null ? updated as Record<string, unknown> : {}), title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined };
    await writeFile(metaPath, JSON.stringify(updated, null, 2));
    return NextResponse.json({ ok: true, meta: updated });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    const status = code === "ENOENT" ? 404 : error instanceof Error && /Invalid/.test(error.message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { filename } = (await request.json()) as { filename?: string };
    if (!filename || !isSafeAudioFilename(filename)) {
      return NextResponse.json({ ok: false, error: "Invalid filename" }, { status: 400 });
    }
    const fullPath = path.join(outputDir(), filename);
    await unlink(fullPath);
    try {
      await unlink(metadataPathForAudio(fullPath));
    } catch {
      // No sidecar to delete.
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
