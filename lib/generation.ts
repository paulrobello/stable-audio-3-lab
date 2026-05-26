import { z } from "zod";

export const modelOptions = [
  { id: "small-sfx", label: "Small SFX", repo: "stabilityai/stable-audio-3-small-sfx", bestFor: "Sound effects / Foley / UI stings", maxDuration: 120 },
  { id: "small-music", label: "Small Music", repo: "stabilityai/stable-audio-3-small-music", bestFor: "Fast local full-song sketches", maxDuration: 120 },
  { id: "medium", label: "Medium", repo: "stabilityai/stable-audio-3-medium", bestFor: "Higher musicality + long-form up to ~6:20", maxDuration: 380 },
] as const;

export const generateSchema = z.object({
  prompt: z.string().trim().min(8, "Prompt needs at least 8 characters").max(1000),
  negativePrompt: z.string().trim().max(500).optional().default(""),
  mode: z.enum(["sfx", "music"]),
  model: z.enum(["small-sfx", "small-music", "medium"]),
  // Accept oversized UI/API input, then clamp to the selected model's limit in normalizeGenerationRequest.
  duration: z.coerce.number().min(1).max(3600),
  steps: z.coerce.number().int().min(4).max(50).default(8),
  cfgScale: z.coerce.number().min(0).max(12).default(1),
  format: z.enum(["mp3", "wav"]).optional().default("mp3"),
  seed: z.coerce.number().int().min(0).max(2147483647).optional(),
  mock: z.boolean().optional().default(false),
  title: z.string().trim().max(200).optional(),
  autoTitle: z.boolean().optional().default(false),
  batchRunId: z.string().regex(/^(?!\.)(?!.*\.\.)(?=.{1,80}$)[a-zA-Z0-9][a-zA-Z0-9._-]*$/).optional(),
  variationIndex: z.coerce.number().int().min(0).max(99).optional(),
  variationCount: z.coerce.number().int().min(1).max(99).optional(),
}).superRefine((value, ctx) => {
  const hasBatchRun = value.batchRunId !== undefined;
  const hasVariationIndex = value.variationIndex !== undefined;
  const hasVariationCount = value.variationCount !== undefined;
  if (hasBatchRun && (!hasVariationIndex || !hasVariationCount)) {
    ctx.addIssue({ code: "custom", message: "Batch generation requires variationIndex and variationCount", path: ["batchRunId"] });
  }
  if (!hasBatchRun && (hasVariationIndex || hasVariationCount)) {
    ctx.addIssue({ code: "custom", message: "Variation fields require batchRunId", path: [hasVariationIndex ? "variationIndex" : "variationCount"] });
  }
  if (hasVariationIndex && hasVariationCount && value.variationIndex! >= value.variationCount!) {
    ctx.addIssue({ code: "custom", message: "variationIndex must be less than variationCount", path: ["variationIndex"] });
  }
});

export type GenerateRequest = z.infer<typeof generateSchema>;

export function normalizeGenerationRequest(input: unknown): GenerateRequest {
  const parsed = generateSchema.parse(input);
  const option = modelOptions.find((m) => m.id === parsed.model);
  if (!option) return parsed;
  if (parsed.duration > option.maxDuration) {
    return { ...parsed, duration: option.maxDuration };
  }
  return parsed;
}

export const promptPresets = {
  sfx: [
    "cinematic spaceship door opening, hydraulic hiss, low metallic rumble, clean tail",
    "rain on a neon city window, distant thunder, soft traffic below, 8 seconds",
    "retro arcade power-up sparkle, glassy chimes, satisfying button click transient",
  ],
  music: [
    "uplifting synthwave instrumental, warm analog bass, shimmering pads, 118 BPM, clean mix",
    "dark cinematic orchestral trailer cue, taiko hits, brass swells, evolving tension, 90 BPM",
    "lofi hip hop loop, dusty drums, mellow rhodes chords, vinyl texture, 82 BPM",
  ],
};

export const promptTemplateGroups = [
  {
    id: "foley",
    label: "Foley",
    templates: [
      "close-mic leather jacket movement, subtle fabric creaks, realistic room tone, clean tail",
      "heavy boots on wet concrete, gritty footsteps, small puddle splashes, noir alley ambience",
    ],
  },
  {
    id: "ui-stings",
    label: "UI Stings",
    templates: [
      "premium app success chime, soft glass ping, tiny sparkle tail, no harsh transient",
      "futuristic error notification, muted synthetic buzz, quick descending tone, polished UI mix",
    ],
  },
  {
    id: "loops",
    label: "Loops",
    templates: [
      "seamless lofi drum loop, dusty kick and snare, warm vinyl noise, 82 BPM, four bars",
      "minimal techno percussion loop, tight hats, deep sub pulse, club-ready, 124 BPM",
    ],
  },
  {
    id: "trailer-hits",
    label: "Trailer Hits",
    templates: [
      "massive cinematic trailer impact, taiko hit, brass blast, sub drop, long dark tail",
      "rising tension whoosh into orchestral slam, metallic scrape, huge low-end impact",
    ],
  },
  {
    id: "ambience",
    label: "Ambience",
    templates: [
      "rainy cyberpunk alley ambience, distant traffic, neon hum, soft thunder, immersive stereo",
      "quiet forest at night, gentle wind through trees, insects, distant owl, natural spacious mix",
    ],
  },
  {
    id: "music-beds",
    label: "Music Beds",
    templates: [
      "warm corporate tech music bed, hopeful piano pulses, soft synths, clean background mix",
      "dark documentary underscore, low strings, sparse piano, subtle pulse, restrained tension",
    ],
  },
] as const;

export function buildVariationSeeds(baseSeed: number, count: number) {
  const safeCount = Math.min(Math.max(Math.floor(count), 1), 8);
  const normalizedBase = Math.min(Math.max(Math.floor(baseSeed), 0), 2147483647);
  return Array.from({ length: safeCount }, (_, index) => (normalizedBase + index) % 2147483648);
}

export const controlTips = {
  duration: {
    title: "Duration",
    body: "How long the clip should be. SFX usually shine at 1–8s; music sketches are nicer around 12–45s while iterating.",
  },
  steps: {
    title: "Steps",
    body: "More diffusion steps can add polish but cost time. Start at 8. Try 4–6 for quick drafts, 12–20 for keepers.",
  },
  cfgScale: {
    title: "CFG",
    body: "Prompt strength. Low values are more natural/loose; higher values obey the prompt harder but can get crunchy. Start at 1–2.",
  },
  format: {
    title: "Format",
    body: "MP3 is the default for easy sharing and smaller files. WAV keeps the raw render if you want to edit or master it later.",
  },
  seed: {
    title: "Seed",
    body: "Use the same seed with the same prompt/model/settings to reproduce or iterate a generation. Leave blank for random goblin dice.",
  },
  mock: {
    title: "Mock mode",
    body: "Fast fake audio for testing the UI without waking the model goblin. Turn it off for real Stable Audio 3 generation.",
  },
} as const;
