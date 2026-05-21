import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { buildAnalysisSummary, buildAnalysisSummaryFilename, buildBundleFilename, buildStoredZip, isSafeAudioFilename, metadataFilenameForAudio, metadataPathForAudio } from "@/lib/library";

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
    let parsedMetadata: unknown;
    try {
      metadata = await readFile(metadataPathForAudio(audioPath));
      parsedMetadata = JSON.parse(metadata.toString("utf8"));
    } catch {
      metadata = Buffer.from(JSON.stringify({ filename, audioUrl: `/outputs/${filename}` }, null, 2));
      parsedMetadata = { filename, audioUrl: `/outputs/${filename}` };
    }
    const analysisSummary = Buffer.from(JSON.stringify(buildAnalysisSummary({ filename, metadata: parsedMetadata }), null, 2));

    const zip = buildStoredZip([
      { name: filename, data: audio },
      { name: metadataFilenameForAudio(filename), data: metadata },
      { name: buildAnalysisSummaryFilename(filename), data: analysisSummary },
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
