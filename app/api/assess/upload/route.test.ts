import { File } from "node:buffer";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const originalCwd = process.cwd();
const originalCommand = process.env.STABLE_AUDIO_ASSESSOR_COMMAND;
let tempCwd: string | undefined;

describe("uploaded audio assessment route", () => {
  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalCommand === undefined) delete process.env.STABLE_AUDIO_ASSESSOR_COMMAND;
    else process.env.STABLE_AUDIO_ASSESSOR_COMMAND = originalCommand;
    if (tempCwd) {
      await rm(tempCwd, { recursive: true, force: true });
      tempCwd = undefined;
    }
  });

  it("assesses a dropped audio file without copying it into the generated library", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-upload-assess-"));
    process.chdir(tempCwd);
    const command = path.join(tempCwd, "assessor.js");
    await writeFile(command, `#!/usr/bin/env node
let input = "";
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  if (!request.audioPath.includes(".stable-audio-assessments/uploads/")) process.exit(2);
  if (request.source.source !== "upload") process.exit(3);
  process.stdout.write(JSON.stringify({
    model: "upload-test-model",
    summary: "Driving synthwave with gated drums.",
    genre: ["synthwave"],
    instruments: ["analog bass", "gated drums"],
    mood: ["tense"],
    production: ["wide stereo image"],
    positives: ["strong pulse"],
    negatives: ["thin cymbals"],
    rhythm: "driving four-on-the-floor",
    tempoBpm: 112,
    key: "A minor"
  }));
});
`);
    await chmod(command, 0o755);
    process.env.STABLE_AUDIO_ASSESSOR_COMMAND = `"${process.execPath}" "${command}"`;

    const form = new Map<string, File | string>();
    form.set("file", new File([Buffer.from("audio")], "reference track.mp3", { type: "audio/mpeg" }));
    form.set("title", "Reference Track");

    const response = await POST({ formData: async () => form } as unknown as NextRequest);
    const json = await response.json() as {
      ok: boolean;
      assessment?: { model?: string; source?: { source?: string; title?: string }; attributes?: { tempoBpm?: number } };
      prompt?: string;
      negativePrompt?: string;
    };

    await expect(stat(path.join(tempCwd, "public", "outputs", "reference track.mp3"))).rejects.toThrow();
    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.assessment?.model).toBe("upload-test-model");
    expect(json.assessment?.source).toMatchObject({ source: "upload", title: "Reference Track" });
    expect(json.assessment?.attributes?.tempoBpm).toBe(112);
    expect(json.prompt).toContain("Instrumental music matching the analyzed reference track.");
    expect(json.prompt).toContain("112 BPM");
    expect(json.negativePrompt).toContain("thin cymbals");
    await expect(readFile(path.join(tempCwd, ".stable-audio-assessments", "uploads", "reference track.mp3"))).rejects.toThrow();
  });
});
