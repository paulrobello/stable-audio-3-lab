import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { isSafeAudioFilename, metadataPathForAudio, metadataUrlForAudio } from "@/lib/library";

export const runtime = "nodejs";

type LibraryItem = {
  filename: string;
  audioUrl: string;
  downloadUrl: string;
  metadataUrl: string;
  format: "mp3" | "wav";
  bytes: number;
  createdAt: string;
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
