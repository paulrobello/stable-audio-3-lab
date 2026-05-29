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

  it("skips duplicate queue requests and already assessed songs", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-assessment-queue-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "liked.mp3"), Buffer.from("audio"));
    await writeFile(path.join(outputDir, "liked.mp3.json"), JSON.stringify({
      filename: "liked.mp3",
      title: "Liked",
    }));
    await writeFile(path.join(outputDir, "assessed.mp3"), Buffer.from("audio"));
    await writeFile(path.join(outputDir, "assessed.mp3.json"), JSON.stringify({
      filename: "assessed.mp3",
      title: "Assessed",
      latestAssessment: { summary: "Already assessed", model: "queue-test-model" },
    }));

    const firstJob = await enqueueAudioAssessment({
      filename: "liked.mp3",
      source: "radio",
      title: "Liked",
      prompt: "warm neon pads",
      styleId: "synthwave",
      rating: "up",
    });
    const duplicateJob = await enqueueAudioAssessment({
      filename: "liked.mp3",
      source: "radio",
      title: "Liked duplicate",
      prompt: "thin brittle drums",
      styleId: "synthwave",
      rating: "down",
    });
    const assessedJob = await enqueueAudioAssessment({
      filename: "assessed.mp3",
      source: "radio",
      title: "Assessed",
      prompt: "wide bass",
      styleId: "synthwave",
      rating: "up",
    });

    const queue = JSON.parse(await readFile(path.join(tempCwd, ".stable-audio-assessments", "queue.json"), "utf8")) as Array<{ filename?: string; rating?: string; prompt?: string }>;
    const assessedMetadata = JSON.parse(await readFile(path.join(outputDir, "assessed.mp3.json"), "utf8")) as {
      assessmentQueue?: unknown;
      latestAssessment?: { summary?: string };
    };

    expect(firstJob?.filename).toBe("liked.mp3");
    expect(duplicateJob).toBeUndefined();
    expect(assessedJob).toBeUndefined();
    expect(queue).toMatchObject([{ filename: "liked.mp3", rating: "up", prompt: "warm neon pads" }]);
    expect(assessedMetadata.latestAssessment?.summary).toBe("Already assessed");
    expect(assessedMetadata.assessmentQueue).toBeUndefined();
  });

  it("drops stale queued jobs when the song was already assessed", async () => {
    tempCwd = await mkdtemp(path.join(tmpdir(), "stable-audio-assessment-queue-"));
    process.chdir(tempCwd);
    const outputDir = path.join(tempCwd, "public", "outputs");
    const queueFile = path.join(tempCwd, ".stable-audio-assessments", "queue.json");
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(queueFile), { recursive: true });
    await writeFile(path.join(outputDir, "assessed.mp3"), Buffer.from("audio"));
    await writeFile(path.join(outputDir, "assessed.mp3.json"), JSON.stringify({
      filename: "assessed.mp3",
      title: "Assessed",
      latestAssessment: { summary: "Already assessed", model: "queue-test-model" },
    }));
    await writeFile(path.join(outputDir, "fresh.mp3"), Buffer.from("audio"));
    await writeFile(path.join(outputDir, "fresh.mp3.json"), JSON.stringify({
      filename: "fresh.mp3",
      title: "Fresh",
    }));
    await writeFile(queueFile, JSON.stringify([
      {
        id: "assessed.mp3:up",
        filename: "assessed.mp3",
        source: "radio",
        title: "Assessed",
        prompt: "wide bass",
        styleId: "synthwave",
        rating: "up",
        queuedAt: "2026-05-29T16:00:00.000Z",
        attempts: 0,
      },
      {
        id: "fresh.mp3:down",
        filename: "fresh.mp3",
        source: "radio",
        title: "Fresh",
        prompt: "thin drums",
        styleId: "synthwave",
        rating: "down",
        queuedAt: "2026-05-29T16:01:00.000Z",
        attempts: 0,
      },
    ]));
    const command = path.join(tempCwd, "assessor.js");
    await writeFile(command, `#!/usr/bin/env node
let input = "";
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  if (request.filename === "assessed.mp3") process.exit(4);
  process.stdout.write(JSON.stringify({
    model: "queue-test-model",
    summary: "Fresh assessment.",
    negatives: ["thin drums"]
  }));
});
`);
    await chmod(command, 0o755);
    process.env.STABLE_AUDIO_ASSESSOR_COMMAND = `"${process.execPath}" "${command}"`;

    expect(await processAudioAssessmentQueue({ loadRatio: 0.1 })).toEqual({ processed: 1, deferred: false });
    const queue = JSON.parse(await readFile(queueFile, "utf8")) as unknown[];
    const assessedMetadata = JSON.parse(await readFile(path.join(outputDir, "assessed.mp3.json"), "utf8")) as {
      latestAssessment?: { summary?: string };
    };
    const freshMetadata = JSON.parse(await readFile(path.join(outputDir, "fresh.mp3.json"), "utf8")) as {
      latestAssessment?: { summary?: string; source?: { filename?: string } };
    };

    expect(queue).toEqual([]);
    expect(assessedMetadata.latestAssessment?.summary).toBe("Already assessed");
    expect(freshMetadata.latestAssessment).toMatchObject({
      summary: "Fresh assessment.",
      source: { filename: "fresh.mp3" },
    });
  });
});
