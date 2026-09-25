import { z } from "zod";

export const languageCodeSchema = z.string().min(2).max(16);

export const eventEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  messageId: z.string().min(1),
  type: z.string().min(1),
  conferenceId: z.string().min(1),
  stageId: z.string().min(1),
  talkId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  streamEpoch: z.number().int().nonnegative(),
  emittedAt: z.string().datetime(),
});

const captionTimingSchema = z.object({
  segmentId: z.string().min(1),
  revision: z.number().int().positive(),
  audioStartSample: z.number().int().nonnegative(),
  audioEndSample: z.number().int().nonnegative(),
  sampleRate: z.number().int().positive(),
  sourceLanguage: languageCodeSchema,
});

export const transcriptPartialSchema = eventEnvelopeSchema.extend({
  type: z.literal("transcript.partial"),
  ...captionTimingSchema.shape,
  text: z.string(),
  providerEpoch: z.number().int().nonnegative(),
});

export const transcriptFinalSchema = eventEnvelopeSchema.extend({
  type: z.literal("transcript.final"),
  ...captionTimingSchema.shape,
  text: z.string(),
  completeness: z.enum(["complete", "incomplete"]),
  providerEpoch: z.number().int().nonnegative(),
  provider: z.string().min(1),
  model: z.string().min(1),
  latencyMs: z.number().nonnegative().optional(),
});

export const translationFinalSchema = eventEnvelopeSchema.extend({
  type: z.literal("translation.final"),
  ...captionTimingSchema.shape,
  sourceSegmentId: z.string().min(1),
  targetLanguage: languageCodeSchema,
  text: z.string(),
  provider: z.string().min(1),
  model: z.string().min(1),
  latencyMs: z.number().nonnegative().optional(),
});

export const componentHealthSchema = z.enum([
  "disconnected",
  "connecting",
  "healthy",
  "degraded",
  "failed",
]);

export const talkStatusSchema = z.enum([
  "ready",
  "starting",
  "live",
  "finalizing",
  "completed",
  "error",
]);

export const stageStatusSchema = eventEnvelopeSchema.extend({
  type: z.literal("stage.status"),
  stageStatus: talkStatusSchema,
  audioStatus: componentHealthSchema,
  sttStatus: componentHealthSchema,
  translationStatus: z.record(languageCodeSchema, componentHealthSchema),
  reasonCode: z.string().optional(),
  detail: z.string().optional(),
});

export const streamGapSchema = eventEnvelopeSchema.extend({
  type: z.literal("stream.gap"),
  audioStartSample: z.number().int().nonnegative(),
  audioEndSample: z.number().int().nonnegative(),
  sampleRate: z.number().int().positive(),
  reason: z.string().min(1),
  recoverable: z.boolean(),
  providerEpoch: z.number().int().nonnegative(),
});

export const canonicalEventSchema = z.discriminatedUnion("type", [
  transcriptPartialSchema,
  transcriptFinalSchema,
  translationFinalSchema,
  stageStatusSchema,
  streamGapSchema,
]);

export type TranscriptPartial = z.infer<typeof transcriptPartialSchema>;
export type TranscriptFinal = z.infer<typeof transcriptFinalSchema>;
export type TranslationFinal = z.infer<typeof translationFinalSchema>;
export type ComponentHealth = z.infer<typeof componentHealthSchema>;
export type TalkStatus = z.infer<typeof talkStatusSchema>;
export type StageStatus = z.infer<typeof stageStatusSchema>;
export type StreamGap = z.infer<typeof streamGapSchema>;
export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;

export const isDurableEvent = (event: CanonicalEvent): boolean =>
  event.type !== "transcript.partial";
