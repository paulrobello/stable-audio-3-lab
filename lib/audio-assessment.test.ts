import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { enqueueAudioAssessment, processAudioAssessmentQueue } from "./audio-assessment";

const originalCwd = process.cwd();
const originalCommand = process.env.STABLE_AUDIO_ASSESSOR_COMMAND;
const originalTimeout = process.env.STABLE_AUDIO_ASSESSOR_TIMEOUT_MS;
let tempCwd: string | undefined;

describe("audio assessment queue", () => {
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

  it("defers queued song assessments while load is too high and processes them when load is low", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-assessment-queue-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "liked.mp3"), Buffer.from("audio"));
    await writeFile(path.join(outputDir, "liked.mp3.json"), JSON.stringify({
      filename: "liked.mp3",
      title: "Liked",
      settings: { prompt: "warm neon pads", seed: 44 },
    }));
    const command = path.join(tempCwd, "assessor.js");
    await writeFile(command, `#!/usr/bin/env node
let input = "";
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  if (request.source.rating !== "up") process.exit(3);
  process.stdout.write(JSON.stringify({
    model: "queue-test-model",
    summary: "Warm pads with a steady pulse.",
    instruments: ["synth pad"],
    positives: ["warm tone"]
  }));
});
`);
    await chmod(command, 0o755);
    process.env.STABLE_AUDIO_ASSESSOR_COMMAND = `"${process.execPath}" "${command}"`;

    await enqueueAudioAssessment({
      filename: "liked.mp3",
      source: "radio",
      title: "Liked",
      prompt: "warm neon pads",
      styleId: "synthwave",
      rating: "up",
    });
    expect(await processAudioAssessmentQueue({ loadRatio: 0.9 })).toEqual({ processed: 0, deferred: true });
    const queuedMetadata = JSON.parse(await readFile(path.join(outputDir, "liked.mp3.json"), "utf8")) as {
      assessmentQueue?: { status?: string };
      latestAssessment?: unknown;
    };
    expect(queuedMetadata.assessmentQueue?.status).toBe("queued");
    expect(queuedMetadata.latestAssessment).toBeUndefined();

    expect(await processAudioAssessmentQueue({ loadRatio: 0.1 })).toEqual({ processed: 1, deferred: false });
    const assessedMetadata = JSON.parse(await readFile(path.join(outputDir, "liked.mp3.json"), "utf8")) as {
      assessmentQueue?: { status?: string };
      latestAssessment?: { model?: string; source?: { rating?: string } };
      assessments?: unknown[];
    };
    expect(assessedMetadata.assessmentQueue?.status).toBe("done");
    expect(assessedMetadata.latestAssessment?.model).toBe("queue-test-model");
    expect(assessedMetadata.latestAssessment?.source?.rating).toBe("up");
    expect(assessedMetadata.assessments).toHaveLength(1);
  });
});
