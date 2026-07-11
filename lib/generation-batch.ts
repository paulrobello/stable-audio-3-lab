// Pure, testable batch-generation sequencing for the client generate() flow.
//
// Previously `generate()` in `app/page.tsx` was a 283-line method whose only
// truly untestable part was the UI state (useState setters + fetch); the batch
// sequencing — seed resolution, variation-seed derivation, batchRunId minting,
// per-variation request-body assembly, and the ordered "stop on first failure"
// loop — was inlined alongside it (QA-009 / ARC-010). That sequencing is pure
// logic with no React or network coupling, so it lives here where it can be
// unit-tested directly.
//
// `generate()` keeps the UI orchestration (setResult / setBatchProgress /
// loadLibrary) and supplies a `generateOne` callback that performs the actual
// POST. Behavior is unchanged: same seed→variation mapping, same batchRunId
// rule (only when more than one variation), same request body fields, same
// progress label format, same "break on first !ok" ordering.

import { buildVariationSeeds } from "./generation";

/** The subset of UI state a batch is planned from. */
export type GenerationBatchInput = {
  prompt: string;
  negativePrompt: string;
  mode: "music" | "sfx";
  model: string;
  duration: number;
  steps: number;
  cfgScale: number;
  format: "mp3" | "wav";
  mock: boolean;
  autoTitle: boolean;
  /** Raw seed field text (may be "" for "no fixed seed"). */
  seed: string;
  /** Number of variations to generate (1–8). */
  batchCount: number;
};

/** One variation's resolved plan: everything `generateOne` needs to POST. */
export type GenerationVariationPlan = {
  /** 0-based index within the batch. */
  index: number;
  /** Total variations in the batch. */
  total: number;
  /** Resolved seed for this variation, or undefined when no fixed seed was set. */
  seed: number | undefined;
  /** Shared batch run id, set only when total > 1. */
  batchRunId: string | undefined;
  /** Per-variation index, set only when batchRunId is set. */
  variationIndex: number | undefined;
  /** Per-variation count, set only when batchRunId is set. */
  variationCount: number | undefined;
  /** The exact JSON body to POST to /api/generate for this variation. */
  body: Record<string, unknown>;
};

/** The full batch plan: variation seeds + the ordered per-variation requests. */
export type GenerationBatchPlan = {
  batchRunId: string | undefined;
  variationSeeds: (number | undefined)[];
  variations: GenerationVariationPlan[];
};

/**
 * Plan a batch without running it. Pure function: same input → same plan,
 * except `batchRunId` which is minted via `generateBatchRunId` (timestamped by
 * default; inject a fixed generator for deterministic tests).
 *
 * Seed handling mirrors `app/page.tsx`'s original logic exactly:
 *   * empty/non-numeric seed → one `undefined` slot per variation (no seed sent)
 *   * fixed seed → `buildVariationSeeds(base, count)` (sequential, wraps at 2^31)
 *   * batchRunId is attached (with variationIndex/variationCount) ONLY when the
 *     batch has more than one variation, matching the original single-shot path.
 */
export function planGenerationBatch(
  input: GenerationBatchInput,
  generateBatchRunId: () => string = buildClientBatchRunId,
): GenerationBatchPlan {
  const parsedSeed = input.seed.trim() ? Number(input.seed) : undefined;
  const variationSeeds = parsedSeed !== undefined
    ? buildVariationSeeds(parsedSeed, input.batchCount)
    : Array.from({ length: input.batchCount }, () => undefined as number | undefined);
  const batchRunId = variationSeeds.length > 1 ? generateBatchRunId() : undefined;

  const variations: GenerationVariationPlan[] = variationSeeds.map((variationSeed, index) => ({
    index,
    total: variationSeeds.length,
    seed: variationSeed,
    batchRunId,
    variationIndex: batchRunId ? index : undefined,
    variationCount: batchRunId ? variationSeeds.length : undefined,
    body: {
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      mode: input.mode,
      model: input.model,
      duration: input.duration,
      steps: input.steps,
      cfgScale: input.cfgScale,
      format: input.format,
      mock: input.mock,
      autoTitle: input.autoTitle,
      ...(variationSeed !== undefined ? { seed: variationSeed } : {}),
      ...(batchRunId ? { batchRunId, variationIndex: index, variationCount: variationSeeds.length } : {}),
    },
  }));

  return { batchRunId, variationSeeds, variations };
}

/**
 * Run a batch by driving `generateOne` across each planned variation in order,
 * stopping after the first variation whose result has `ok: false` (matching the
 * original `if (!latest.ok) break;`). `onProgress` fires before each variation
 * so the caller can update a progress label with the same shape as before.
 *
 * The caller owns all UI/network side effects inside `generateOne`; this
 * function owns only the sequencing. Returns every result collected (including
 * the failing one, when present) plus the resolved `batchRunId` and seed list.
 */
export async function runGenerationBatch<T extends { ok: boolean }>(
  input: GenerationBatchInput,
  generateOne: (variation: GenerationVariationPlan) => Promise<T>,
  options: { onProgress?: (variation: GenerationVariationPlan) => void; generateBatchRunId?: () => string } = {},
): Promise<{ results: T[]; batchRunId: string | undefined; variationSeeds: (number | undefined)[] }> {
  const plan = planGenerationBatch(input, options.generateBatchRunId);
  const results: T[] = [];
  for (const variation of plan.variations) {
    options.onProgress?.(variation);
    const result = await generateOne(variation);
    results.push(result);
    if (!result.ok) break;
  }
  return { results, batchRunId: plan.batchRunId, variationSeeds: plan.variationSeeds };
}

/**
 * Mint a client-side batch run id (timestamp + random suffix). Moved here from
 * `app/page.tsx` so the batch module owns the whole batch identity. Inject a
 * stub via `planGenerationBatch`/`runGenerationBatch`'s `generateBatchRunId`
 * option for deterministic tests.
 */
export function buildClientBatchRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `batch-${stamp}-${random}`;
}
