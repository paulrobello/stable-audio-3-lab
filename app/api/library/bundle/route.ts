import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { buildAnalysisSummary, buildAnalysisSummaryFilename, buildBatchBundleFilename, buildBatchManifest, buildBundleFilename, buildStoredZip, isSafeAudioFilename, isSafeBatchRunId, metadataFilenameForAudio, metadataPathForAudio, readBatchRunId } from "@/lib/library";

export const runtime = "nodejs";

const outputDir = () => path.join(process.cwd(), "public", "outputs");

export async function GET(request: NextRequest) {
  try {
    const batchRunId = request.nextUrl.searchParams.get("batchRunId") || "";
    if (batchRunId) return buildBatchBundleResponse(batchRunId);

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
    const status = code === "ENOENT" ? 404 : error instanceof Error && /Invalid/.test(error.message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status });
  }
}

async function buildBatchBundleResponse(batchRunId: string) {
  if (!isSafeBatchRunId(batchRunId)) {
    return NextResponse.json({ ok: false, error: "Invalid batch run id" }, { status: 400 });
  }

  const dir = outputDir();
  const names = (await readdir(dir)).filter(isSafeAudioFilename);
  const matched: { filename: string; metadata: unknown; audio: Buffer; metadataBuffer: Buffer }[] = [];

  for (const filename of names) {
    const audioPath = path.join(dir, filename);
    try {
      const metadataBuffer = await readFile(metadataPathForAudio(audioPath));
      const metadata = JSON.parse(metadataBuffer.toString("utf8"));
      if (readBatchRunId(metadata) !== batchRunId) continue;
      matched.push({ filename, metadata, audio: await readFile(audioPath), metadataBuffer });
    } catch {
      // Skip older files with no metadata or malformed sidecars.
    }
  }

  if (matched.length === 0) {
    return NextResponse.json({ ok: false, error: "No artifacts found for batch run" }, { status: 404 });
  }

  const manifest = buildBatchManifest({ batchRunId, items: matched.map((item) => ({ filename: item.filename, metadata: item.metadata })) });
  const order = new Map(manifest.items.map((item, index) => [item.filename, index]));
  const sorted = matched.sort((a, b) => (order.get(a.filename) ?? 0) - (order.get(b.filename) ?? 0));
  const entries = sorted.flatMap((item) => [
    { name: item.filename, data: item.audio },
    { name: metadataFilenameForAudio(item.filename), data: item.metadataBuffer },
    { name: buildAnalysisSummaryFilename(item.filename), data: Buffer.from(JSON.stringify(buildAnalysisSummary({ filename: item.filename, metadata: item.metadata }), null, 2)) },
  ]);
  entries.push({ name: `${batchRunId}.manifest.json`, data: Buffer.from(JSON.stringify(manifest, null, 2)) });

  return new NextResponse(buildStoredZip(entries), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${buildBatchBundleFilename(batchRunId)}"`,
    },
  });
}
