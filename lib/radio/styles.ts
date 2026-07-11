// Built-in radio style catalog and pure style-data helpers.
//
// Owns the `radioStyles` seed catalog plus the lookups/normalizers that resolve
// which styles are available (built-ins + custom, minus deleted) and validate a
// style id against that set. Style *mutators* (`createRadioStyle`,
// `updateRadioStyle`, `deleteRadioStyle`) live in `./state` because they apply
// state-machine transitions (they call `selectRadioStyle`); the style-data
// normalizers they depend on (`normalizeCustomRadioStyles`,
// `normalizeDeletedRadioStyleIds`, `makeUniqueRadioStyleId`) are exported from
// here so the state module can reuse them without re-implementing.

import type { RadioStyle, RadioStyleId, RadioState } from "./types";
import { cleanShortText, shortHash } from "./_internal";

export const radioStyles: RadioStyle[] = [
  {
    id: "synthwave",
    label: "Synthwave Night Drive",
    seedPrompt: "instrumental synthwave, warm analog bass, neon pads, clean punchy drums, 112 BPM, no vocals",
    negativePrompt: "muddy low end, harsh cymbals, distorted clipping, vocals",
  },
  {
    id: "ambient",
    label: "Ambient Signal Drift",
    seedPrompt: "slow evolving ambient instrumental, wide pads, gentle arpeggios, spacious reverb, soft texture",
    negativePrompt: "busy drums, abrupt transitions, harsh noise, vocals",
  },
  {
    id: "cinematic",
    label: "Cinematic Trailer Pulse",
    seedPrompt: "cinematic instrumental cue, pulsing low strings, restrained brass swells, deep percussion, dramatic arc",
    negativePrompt: "cartoon sounds, thin drums, brittle synths, vocals",
  },
  {
    id: "lofi",
    label: "Lofi Study Loop",
    seedPrompt: "lofi hip hop instrumental, dusty drums, mellow rhodes chords, warm tape saturation, 82 BPM",
    negativePrompt: "overly bright hats, harsh clipping, aggressive lead synths, vocals",
  },
  {
    id: "experimental",
    label: "Experimental Machine Folk",
    seedPrompt: "experimental instrumental, organic plucks, glitchy tape loops, subtle modular synth pulses, intimate mix",
    negativePrompt: "random noise wall, novelty sounds, abrasive clipping, vocals",
  },
];

export function getAvailableRadioStyles(stateOrCustomStyles?: Pick<RadioState, "customStyles" | "deletedStyleIds"> | RadioStyle[]): RadioStyle[] {
  const customStyles = Array.isArray(stateOrCustomStyles) ? stateOrCustomStyles : stateOrCustomStyles?.customStyles ?? [];
  const deletedStyleIds = new Set(Array.isArray(stateOrCustomStyles) ? [] : stateOrCustomStyles?.deletedStyleIds ?? []);
  const customById = new Map(customStyles.map((style) => [style.id, style]));
  const builtInIds = new Set(radioStyles.map((style) => style.id));
  return [
    ...radioStyles.filter((style) => !deletedStyleIds.has(style.id)).map((style) => customById.get(style.id) ?? style),
    ...customStyles.filter((style) => style.id && !builtInIds.has(style.id) && !deletedStyleIds.has(style.id)),
  ];
}

export function normalizeRadioStyleId(value: unknown, customStyles: RadioStyle[] = [], deletedStyleIds: RadioStyleId[] = []): RadioStyleId {
  const availableStyles = getAvailableRadioStyles({ customStyles, deletedStyleIds });
  return availableStyles.some((style) => style.id === value) ? value as RadioStyleId : availableStyles[0]?.id ?? "synthwave";
}

export function normalizeRadioStyleUrlParam(value: unknown, customStyles: RadioStyle[] = [], deletedStyleIds: RadioStyleId[] = []): RadioStyleId | undefined {
  return getAvailableRadioStyles({ customStyles, deletedStyleIds }).some((style) => style.id === value) ? value as RadioStyleId : undefined;
}

export function getRadioStyle(styleId: RadioStyleId, customStyles: RadioStyle[] = [], deletedStyleIds: RadioStyleId[] = []) {
  return getAvailableRadioStyles({ customStyles, deletedStyleIds }).find((style) => style.id === styleId) ?? radioStyles[0];
}

export function makeUniqueRadioStyleId(label: string, styles: RadioStyle[]) {
  const base = slugForStyleId(label) || "custom-style";
  const used = new Set(styles.map((style) => style.id));
  if (!used.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const id = `${base}-${index}`;
    if (!used.has(id)) return id;
  }
  return `${base}-${shortHash(`${label}-${Date.now()}`)}`;
}

export function normalizeCustomRadioStyles(value: unknown): RadioStyle[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const customStyles: RadioStyle[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const input = item as Partial<RadioStyle>;
    const label = typeof input.label === "string" ? cleanShortText(input.label, "", 80) : "";
    const seedPrompt = typeof input.seedPrompt === "string" ? cleanShortText(input.seedPrompt, "", 1000) : "";
    if (label.length < 2 || seedPrompt.length < 8) continue;
    const idInput = typeof input.id === "string" ? slugForStyleId(input.id) : slugForStyleId(label);
    const id = idInput && !seen.has(idInput) ? idInput : makeUniqueRadioStyleId(label, [...radioStyles, ...customStyles]);
    seen.add(id);
    customStyles.push({
      id,
      label,
      seedPrompt,
      negativePrompt: typeof input.negativePrompt === "string"
        ? cleanShortText(input.negativePrompt, "vocals, clipping, harsh noise", 500)
        : "vocals, clipping, harsh noise",
    });
  }
  return customStyles.slice(-30);
}

export function normalizeDeletedRadioStyleIds(value: unknown): RadioStyleId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const styleIds: RadioStyleId[] = [];
  for (const item of value) {
    const styleId = typeof item === "string" ? slugForStyleId(item) : "";
    if (!styleId || seen.has(styleId)) continue;
    seen.add(styleId);
    styleIds.push(styleId);
  }
  return styleIds.slice(-30);
}

function slugForStyleId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
}
