import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const originalCwd = process.cwd();
const originalCommand = process.env.STABLE_AUDIO_ASSESSOR_COMMAND;
const originalYtdlpBin = process.env.STABLE_AUDIO_YOUTUBE_YTDLP_BIN;
const originalTimeout = process.env.STABLE_AUDIO_YOUTUBE_TIMEOUT_MS;
let tempCwd: string | undefined;

describe("YouTube audio assessment route", () => {
  afterEach(async () => {
    process.chdir(originalCwd);
    restoreEnv("STABLE_AUDIO_ASSESSOR_COMMAND", originalCommand);
    restoreEnv("STABLE_AUDIO_YOUTUBE_YTDLP_BIN", originalYtdlpBin);
    restoreEnv("STABLE_AUDIO_YOUTUBE_TIMEOUT_MS", originalTimeout);
    if (tempCwd) {
      await rm(tempCwd, { recursive: true, force: true });
      tempCwd = undefined;
    }
  });

  it("extracts YouTube audio through yt-dlp before assessing it", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-youtube-assess-"));
    process.chdir(tempCwd);

    // Deterministic yt-dlp mock: parse the -o template, write fake MP3 audio to
    // <template-without-.%(ext)s>.mp3, and record the URL we received.
    const ytdlpPath = path.join(tempCwd, "yt-dlp");
    await writeFile(ytdlpPath, `#!/bin/sh
printf '%s\\n' "$@" > ytdlp-args.txt
template=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then template="$arg"; fi
  prev="$arg"
done
base="\${template%.%(ext)s}"
mkdir -p "$(dirname "$base")"
printf 'fake mp3 audio' > "$base.mp3"
`);
    await chmod(ytdlpPath, 0o755);
    process.env.STABLE_AUDIO_YOUTUBE_YTDLP_BIN = ytdlpPath;

    const assessorPath = path.join(tempCwd, "assessor.js");
    await writeFile(assessorPath, `#!/usr/bin/env node
let input = "";
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  if (!request.audioPath.includes(".stable-audio-assessments/uploads/")) process.exit(2);
  if (!request.source.title.includes("youtube.com/watch")) process.exit(3);
  process.stdout.write(JSON.stringify({
    model: "youtube-test-model",
    summary: "Punchy electro pop with chopped vocal texture.",
    genre: ["electro pop"],
    instruments: ["chopped vocal", "sidechain bass"],
    mood: ["bright"],
    production: ["tight sidechain"],
    positives: ["clear hook"],
    negatives: ["crowded chorus"],
    rhythm: "syncopated four-on-the-floor",
    tempoBpm: 124,
    key: "C minor"
  }));
});
`);
    await chmod(assessorPath, 0o755);
    process.env.STABLE_AUDIO_ASSESSOR_COMMAND = `"${process.execPath}" "${assessorPath}"`;

    const response = await POST(new NextRequest("http://localhost:3007/api/assess/youtube", {
      method: "POST",
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=abc12345678" }),
    }));
    const json = await response.json() as {
      ok: boolean;
      filename?: string;
      assessment?: { model?: string; attributes?: { tempoBpm?: number } };
      prompt?: string;
      negativePrompt?: string;
    };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.filename).toMatch(/youtube-reference-[\w-]+\.mp3/);
    expect(json.assessment?.model).toBe("youtube-test-model");
    expect(json.assessment?.attributes?.tempoBpm).toBe(124);
    expect(json.prompt).toContain("Instrumental music matching the analyzed reference track.");
    expect(json.prompt).toContain("124 BPM");
    expect(json.negativePrompt).toContain("crowded chorus");

    // The deterministic extractor is invoked with a fixed argument array and no
    // LLM/agent prompt: only the URL and the -o template reach yt-dlp.
    const args = await readFile(path.join(tempCwd, "ytdlp-args.txt"), "utf8");
    expect(args).toContain("--audio-format\nmp3");
    expect(args).toContain("-x");
    expect(args).toContain("--no-playlist");
    expect(args).toContain("https://www.youtube.com/watch?v=abc12345678");
    // The final assessed MP3 is removed after the request; the intermediate too.
    await expect(stat(path.join(tempCwd, ".stable-audio-assessments", "uploads", json.filename!))).rejects.toThrow();
  });

  it("rejects non-YouTube URLs", async () => {
    const response = await POST(new NextRequest("http://localhost:3007/api/assess/youtube", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com/not-youtube" }),
    }));
    const json = await response.json() as { ok: boolean; error?: string };

    expect(response.status).toBe(400);
    expect(json).toEqual({ ok: false, error: "Enter a YouTube URL" });
  });

  it("returns a generic error without leaking subprocess output on failure", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-youtube-fail-"));
    process.chdir(tempCwd);
    // A yt-dlp mock that exits non-zero with revealing stderr.
    const ytdlpPath = path.join(tempCwd, "yt-dlp");
    await writeFile(ytdlpPath, `#!/bin/sh
echo 'ERROR: /Users/secret/internal/path detail' >&2
exit 2
`);
    await chmod(ytdlpPath, 0o755);
    process.env.STABLE_AUDIO_YOUTUBE_YTDLP_BIN = ytdlpPath;

    const response = await POST(new NextRequest("http://localhost:3007/api/assess/youtube", {
      method: "POST",
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=abc12345678" }),
    }));
    const json = await response.json() as { ok: boolean; error?: string; detail?: unknown };

    expect(response.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toBe("YouTube audio extraction failed");
    // No internal path or stderr must reach the client.
    expect(JSON.stringify(json)).not.toContain("/Users/secret");
    expect(json.detail).toBeUndefined();
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
