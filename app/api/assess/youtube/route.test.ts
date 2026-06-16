import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const originalCwd = process.cwd();
const originalCommand = process.env.STABLE_AUDIO_ASSESSOR_COMMAND;
const originalCodexBin = process.env.STABLE_AUDIO_YOUTUBE_CODEX_BIN;
const originalCodexModel = process.env.STABLE_AUDIO_YOUTUBE_CODEX_MODEL;
const originalCodexTimeout = process.env.STABLE_AUDIO_YOUTUBE_CODEX_TIMEOUT_MS;
let tempCwd: string | undefined;

describe("YouTube audio assessment route", () => {
  afterEach(async () => {
    process.chdir(originalCwd);
    restoreEnv("STABLE_AUDIO_ASSESSOR_COMMAND", originalCommand);
    restoreEnv("STABLE_AUDIO_YOUTUBE_CODEX_BIN", originalCodexBin);
    restoreEnv("STABLE_AUDIO_YOUTUBE_CODEX_MODEL", originalCodexModel);
    restoreEnv("STABLE_AUDIO_YOUTUBE_CODEX_TIMEOUT_MS", originalCodexTimeout);
    if (tempCwd) {
      await rm(tempCwd, { recursive: true, force: true });
      tempCwd = undefined;
    }
  });

  it("extracts YouTube audio through Codex CLI before assessing it", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-youtube-assess-"));
    process.chdir(tempCwd);

    const codexPath = path.join(tempCwd, "codex");
    await writeFile(codexPath, `#!/bin/sh
printf '%s\\n' "$@" > codex-args.txt
cat > codex-stdin.txt
mkdir -p "$(dirname "$YOUTUBE_AUDIO_EXTRACT_OUTPUT_PATH")"
printf 'fake mp3 audio' > "$YOUTUBE_AUDIO_EXTRACT_OUTPUT_PATH"
`);
    await chmod(codexPath, 0o755);
    process.env.STABLE_AUDIO_YOUTUBE_CODEX_BIN = codexPath;
    process.env.STABLE_AUDIO_YOUTUBE_CODEX_MODEL = "gpt-5.5";

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

    const args = await readFile(path.join(tempCwd, "codex-args.txt"), "utf8");
    const stdin = await readFile(path.join(tempCwd, "codex-stdin.txt"), "utf8");
    expect(args).toContain("-m\ngpt-5.5");
    expect(args).toContain("--sandbox\nworkspace-write");
    expect(args).toContain("--config\napproval_policy=\"never\"");
    expect(stdin).toContain("Use the local YouTube audio extraction skill");
    expect(stdin).toContain("https://www.youtube.com/watch?v=abc12345678");
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
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
