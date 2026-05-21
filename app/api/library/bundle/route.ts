import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { buildBundleFilename, buildStoredZip, isSafeAudioFilename, metadataFilenameForAudio, metadataPathForAudio } from "@/lib/library";

export const runtime = "nodejs";

const outputDir = () => path.join(process.cwd(), "public", "outputs");

export async function GET(request: NextRequest) {
  try {
    const filename = request.nextUrl.searchParams.get("filename") || "";
    if (!isSafeAudioFilename(filename)) {
      return NextResponse.json({ ok: false, error: "Invalid filename" }, { status: 400 });
    }

    const audioPath = path.join(outputDir(), filename);
    const audio = await readFile(audioPath);
    let metadata: Buffer;
    try {
      metadata = await readFile(metadataPathForAudio(audioPath));
    } catch {
      metadata = Buffer.from(JSON.stringify({ filename, audioUrl: `/outputs/${filename}` }, null, 2));
    }

    const zip = buildStoredZip([
      { name: filename, data: audio },
      { name: metadataFilenameForAudio(filename), data: metadata },
    ]);

    return new NextResponse(zip, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${buildBundleFilename(filename)}"`,
      },
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    const status = code === "ENOENT" ? 404 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status });
  }
}
