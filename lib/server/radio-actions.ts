// Zod contract for `POST /api/radio`.
//
// The radio POST handler is a 16-action dispatcher. Previously it read raw
// `body.label` / `body.seedPrompt` / `body.rating` values from an unvalidated
// `Record<string, unknown>` through a sequential `if`-chain, inconsistent with
// the Zod-validated `/api/generate` (ARC-009). This module exposes a single
// discriminated union on `action`, parsed once at the top of POST.
//
// Field typing is intentionally permissive: payload fields are `unknown` because
// the route performs its own normalization on them (e.g. `createRadioStyle`,
// `normalizeRadioStyleId`, `normalizeRadioRatingPayload` all accept `unknown`
// and coerce). Validating those shapes here would either duplicate the
// normalizers or change which payloads are accepted. The CONTRACT this enforces
// is the `action` discriminator: an unknown/missing action is rejected with a
// 400 ("Unknown radio action"), exactly as the previous fall-through did.
// `.passthrough()` preserves every key so the route's existing reads are
// unaffected. The inferred `RadioActionRequest` union is the shared type for
// clients and tests.

import { z } from "zod";

const permissive = <T extends z.ZodTypeAny>(schema: T) => schema.optional();

/**
 * The 16 actions accepted by `POST /api/radio`. Each variant lists the payload
 * keys the route reads; all are `unknown` (normalized at the call site) and
 * `.passthrough()` keeps any additional keys.
 */
export const radioActionRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("createStyle"),
    label: permissive(z.unknown()),
    seedPrompt: permissive(z.unknown()),
    negativePrompt: permissive(z.unknown()),
  }).passthrough(),
  z.object({
    action: z.literal("draftStyle"),
    request: permissive(z.unknown()),
  }).passthrough(),
  z.object({
    action: z.literal("updateStyle"),
    styleId: permissive(z.unknown()),
    label: permissive(z.unknown()),
    seedPrompt: permissive(z.unknown()),
    negativePrompt: permissive(z.unknown()),
  }).passthrough(),
  z.object({
    action: z.literal("deleteStyle"),
    styleId: permissive(z.unknown()),
  }).passthrough(),
  z.object({
    action: z.literal("configure"),
    styleId: permissive(z.unknown()),
    promptModel: permissive(z.unknown()),
    announceEnabled: permissive(z.unknown()),
    songLengthMinutes: permissive(z.unknown()),
    unlikedTrackExpirationHours: permissive(z.unknown()),
    ttsProvider: permissive(z.unknown()),
    ttsVoice: permissive(z.unknown()),
    announcementPrefix: permissive(z.unknown()),
    announcementSuffix: permissive(z.unknown()),
  }).passthrough(),
  z.object({
    action: z.literal("testVoice"),
    ttsProvider: permissive(z.unknown()),
    ttsVoice: permissive(z.unknown()),
    announcementPrefix: permissive(z.unknown()),
    announcementSuffix: permissive(z.unknown()),
  }).passthrough(),
  z.object({
    action: z.literal("ttsVoices"),
    ttsProvider: permissive(z.unknown()),
    ttsVoice: permissive(z.unknown()),
  }).passthrough(),
  z.object({
    action: z.literal("draft"),
    styleId: permissive(z.unknown()),
    promptModel: permissive(z.unknown()),
  }).passthrough(),
  z.object({
    action: z.literal("track"),
    filename: permissive(z.unknown()),
    title: permissive(z.unknown()),
    prompt: permissive(z.unknown()),
    styleId: permissive(z.unknown()),
    promptProvider: permissive(z.unknown()),
    promptModel: permissive(z.unknown()),
    announce: permissive(z.unknown()),
    durationSeconds: permissive(z.unknown()),
  }).passthrough(),
  z.object({
    action: z.literal("fallbackTrack"),
    reason: permissive(z.unknown()),
  }).passthrough(),
  z.object({
    action: z.literal("selectTrack"),
    filename: permissive(z.unknown()),
  }).passthrough(),
  z.object({
    action: z.literal("skipTrack"),
  }).passthrough(),
  z.object({
    action: z.literal("deleteTrack"),
    filename: permissive(z.unknown()),
  }).passthrough(),
  z.object({
    action: z.literal("rating"),
    filename: permissive(z.unknown()),
    styleId: permissive(z.unknown()),
    phrase: permissive(z.unknown()),
    rating: permissive(z.unknown()),
  }).passthrough(),
  z.object({
    action: z.literal("deleteFeedback"),
    rating: permissive(z.unknown()),
    phrase: permissive(z.unknown()),
    styleId: permissive(z.unknown()),
  }).passthrough(),
  z.object({
    action: z.literal("cleanup"),
  }).passthrough(),
]);

/** Inferred request type for `POST /api/radio` — the shared action contract. */
export type RadioActionRequest = z.infer<typeof radioActionRequestSchema>;

/** The literal action strings accepted by `POST /api/radio`. */
export type RadioAction = RadioActionRequest["action"];
