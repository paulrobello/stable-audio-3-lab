import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const originalCwd = process.cwd();
const originalCommand = process.env.STABLE_AUDIO_ASSESSOR_COMMAND;
const originalTimeout = process.env.STABLE_AUDIO_ASSESSOR_TIMEOUT_MS;
let tempCwd: string | undefined;

describe("audio assessment route", () => {
  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalCommand === undefined) delete process.env.STABLE_AUDIO_ASSESSOR_COMMAND;
    else process.env.STABLE_AUDIO_ASSESSOR_COMMAND = originalCommand;
    if (originalTimeout === undefined) delete process.env.STABLE_AUDIO_ASSESSOR_TIMEOUT_MS;
    else process.env.STABLE_AUDIO_ASSESSOR_TIMEOUT_MS = originalTimeout;
    if (tempCwd) {
      await rm(tempCwd, { recursive: true, force: true });
      tempCwd = undefined;
    }
  });

  it("runs the configured local assessor and stores structured results in the sidecar", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-assess-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "seed_a.mp3"), Buffer.from("audio"));
    await writeFile(path.join(outputDir, "seed_a.mp3.json"), JSON.stringify({
      filename: "seed_a.mp3",
      title: "Seed A",
      settings: {
        prompt: "lofi hip hop loop with dusty drums",
        seed: 123,
        mode: "music",
      },
    }));
    const command = path.join(tempCwd, "assessor.js");
    await writeFile(command, `#!/usr/bin/env node
let input = "";
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  if (!request.audioPath.endsWith("seed_a.mp3")) process.exit(2);
  process.stdout.write(JSON.stringify({
    provider: "local-test",
    model: "music-flamingo",
    summary: "Warm lofi beat with electric keys and soft drums.",
    genre: ["lofi hip hop"],
    instruments: ["electric piano", "drum machine"],
    rhythm: "laid-back backbeat",
    tempoBpm: 82,
    mood: ["warm", "nostalgic"],
    production: ["tape saturation"],
    positives: ["cohesive groove"],
    negatives: ["slightly soft bass"]
  }));
});
`);
    await chmod(command, 0o755);
    process.env.STABLE_AUDIO_ASSESSOR_COMMAND = `"${process.execPath}" "${command}"`;

    const response = await POST(new NextRequest("http://localhost:3007/api/assess", {
      method: "POST",
      body: JSON.stringify({
        filename: "seed_a.mp3",
        source: "library",
        title: "Seed A",
        rating: "up",
      }),
    }));
    const json = await response.json() as {
      ok: boolean;
      assessment?: {
        model?: string;
        source?: { filename?: string; rating?: string };
        attributes?: { tempoBpm?: number; instruments?: string[] };
      };
    };
    const saved = JSON.parse(await readFile(path.join(outputDir, "seed_a.mp3.json"), "utf8")) as {
      latestAssessment?: { source?: { rating?: string }; attributes?: { instruments?: string[] } };
      assessments?: unknown[];
    };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.assessment?.model).toBe("music-flamingo");
    expect(json.assessment?.source).toMatchObject({ filename: "seed_a.mp3", rating: "up" });
    expect(json.assessment?.attributes?.tempoBpm).toBe(82);
    expect(saved.latestAssessment?.attributes?.instruments).toEqual(["electric piano", "drum machine"]);
    expect(saved.latestAssessment?.source?.rating).toBe("up");
    expect(saved.assessments).toHaveLength(1);
  });

  it("parses the assessor JSON when dependency warnings are printed before it", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-assess-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "warning_prefixed.mp3"), Buffer.from("audio"));
    await writeFile(path.join(outputDir, "warning_prefixed.mp3.json"), JSON.stringify({
      filename: "warning_prefixed.mp3",
      title: "Warning Prefixed",
    }));
    const command = path.join(tempCwd, "assessor.js");
    await writeFile(command, `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write("[ERROR] \\\`loss\\\` is part of Qwen2_5OmniThinkerCausalLMOutputWithPast.__init__'s signature, but not documented.\\n");
  process.stdout.write("[ERROR] \\\`logits\\\` is part of Qwen2_5OmniTalkerCausalLMOutputWithPast.__init__'s signature, but not documented.\\n");
  process.stdout.write(JSON.stringify({
    provider: "local-qwen-omni",
    model: "Qwen/Qwen2.5-Omni-7B",
    summary: "A chill, laid-back track with smooth vocals.",
    genre: ["hip-hop", "electronic", "chillout"],
    instruments: ["drums", "synthesizer", "vocals"],
    rhythm: "smooth, steady",
    tempoBpm: 75,
    mood: ["relaxed", "happy", "positive"],
    production: ["simple, clean"],
    positives: ["easy listening", "relaxing", "fun"],
    negatives: ["slow tempo", "limited variety", "simple arrangement"],
    rawText: "model returned { nested } text"
  }));
});
`);
    await chmod(command, 0o755);
    process.env.STABLE_AUDIO_ASSESSOR_COMMAND = `"${process.execPath}" "${command}"`;

    const response = await POST(new NextRequest("http://localhost:3007/api/assess", {
      method: "POST",
      body: JSON.stringify({ filename: "warning_prefixed.mp3", source: "library" }),
    }));
    const json = await response.json() as {
      ok: boolean;
      assessment?: { model?: string; summary?: string; attributes?: { tempoBpm?: number; instruments?: string[] } };
    };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.assessment?.model).toBe("Qwen/Qwen2.5-Omni-7B");
    expect(json.assessment?.summary).toBe("A chill, laid-back track with smooth vocals.");
    expect(json.assessment?.attributes?.tempoBpm).toBe(75);
    expect(json.assessment?.attributes?.instruments).toEqual(["drums", "synthesizer", "vocals"]);
  });

  it("returns a configuration error when no local assessor command is set", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-assess-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "seed_b.mp3"), Buffer.from("audio"));
    delete process.env.STABLE_AUDIO_ASSESSOR_COMMAND;

    const response = await POST(new NextRequest("http://localhost:3007/api/assess", {
      method: "POST",
      body: JSON.stringify({ filename: "seed_b.mp3", source: "library" }),
    }));
    const json = await response.json() as { ok: boolean; error?: string };

    expect(response.status).toBe(503);
    expect(json.ok).toBe(false);
    expect(json.error).toContain("STABLE_AUDIO_ASSESSOR_COMMAND");
  });
});
