import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { isFavoriteMetadata, isSafeAudioFilename, metadataPathForAudio, metadataUrlForAudio, toggleFavoriteMetadata } from "@/lib/library";

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
  bundleUrl: string;
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
        return {
          filename,
          audioUrl: `/outputs/${filename}`,
          downloadUrl: `/outputs/${filename}`,
          metadataUrl: metadataUrlForAudio(filename),
          format,
          bytes: info.size,
          createdAt: info.birthtime.toISOString(),
          favorite: isFavoriteMetadata(meta),
          bundleUrl: `/api/library/bundle?filename=${encodeURIComponent(filename)}`,
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
    const { filename, favorite } = (await request.json()) as { filename?: string; favorite?: boolean };
    if (!filename || !isSafeAudioFilename(filename) || typeof favorite !== "boolean") {
      return NextResponse.json({ ok: false, error: "Invalid favorite request" }, { status: 400 });
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
    const updated = toggleFavoriteMetadata(meta, favorite);
    await writeFile(metaPath, JSON.stringify(updated, null, 2));
    return NextResponse.json({ ok: true, meta: updated, favorite });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    const status = code === "ENOENT" ? 404 : 500;
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
