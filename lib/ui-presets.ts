// UI-only copy for the generation form: the control-tooltip text and the
// prompt-template picker groups.
//
// These were previously colocated with the server-side Zod contract in
// `lib/generation.ts`, which mixed UI content with the request schema
// (ARC-016). They have no runtime role on the server, so they live here next to
// their only consumer (`app/page.tsx`). The schema, `normalizeGenerationRequest`,
// and the model metadata stayed in `lib/generation.ts`.

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
