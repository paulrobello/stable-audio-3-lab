// Radio station subsystem — public API barrel.
//
// This package was split from the former monolithic `lib/radio.ts` into focused
// submodules (`types`, `styles`, `tts`, `prompts`, `state`, `urls`). The index
// re-exports the full public surface so every existing `import { ... } from
// "@/lib/radio"` (and the colocated `lib/radio.test.ts` import from `./radio`)
// keeps resolving unchanged.
//
// `./_internal` holds low-level helpers that were private before the split and
// is intentionally NOT re-exported here, preserving the pre-split public surface.

export * from "./types";
export * from "./styles";
export * from "./tts";
export * from "./prompts";
export * from "./state";
export * from "./urls";
