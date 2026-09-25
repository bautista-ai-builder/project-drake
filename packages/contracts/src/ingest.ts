import { z } from "zod";
import { languageCodeSchema } from "./events.js";

export const ingestHelloSchema = z.object({
  type: z.literal("ingest.hello"),
  protocolVersion: z.literal(1),
  talkId: z.string().min(1),
  sourceLanguage: languageCodeSchema,
  codec: z.literal("pcm_s16le"),
  sampleRate: z.literal(16_000),
  channels: z.literal(1),
  captureSessionId: z.string().min(1),
  startingSampleOffset: z.number().int().nonnegative(),
});

export const ingestStartSchema = z.object({
  type: z.literal("ingest.start"),
});

export const ingestStopSchema = z.object({
  type: z.literal("ingest.stop"),
  reason: z.string().min(1),
  finalSampleOffset: z.number().int().nonnegative(),
});

export const ingestHeartbeatSchema = z.object({
  type: z.literal("ingest.heartbeat"),
  lastFrameSent: z.number().int().nonnegative(),
  bufferedAmount: z.number().int().nonnegative(),
  audioLevel: z.number().min(0).max(1).optional(),
});

export const ingestResumeSchema = z.object({
  type: z.literal("ingest.resume"),
  captureSessionId: z.string().min(1),
  availableFromSample: z.number().int().nonnegative(),
  availableToSample: z.number().int().nonnegative(),
  lastServerAck: z.number().int().nonnegative(),
});

export const ingestClientMessageSchema = z.discriminatedUnion("type", [
  ingestHelloSchema,
  ingestStartSchema,
  ingestStopSchema,
  ingestHeartbeatSchema,
  ingestResumeSchema,
]);

export const ingestServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ingest.ready"), expectedSampleOffset: z.number().int().nonnegative() }),
  z.object({ type: z.literal("ingest.ack"), frameSequence: z.number().int().nonnegative(), acceptedThroughSample: z.number().int().nonnegative() }),
  z.object({ type: z.literal("ingest.resume_from"), sampleOffset: z.number().int().nonnegative() }),
  z.object({ type: z.literal("ingest.status"), status: z.string().min(1), detail: z.string().optional() }),
  z.object({ type: z.literal("ingest.warning"), code: z.string().min(1), detail: z.string() }),
  z.object({ type: z.literal("ingest.error"), code: z.string().min(1), detail: z.string(), retryable: z.boolean() }),
  z.object({ type: z.literal("talk.stopped"), talkId: z.string().min(1) }),
]);

export type IngestHello = z.infer<typeof ingestHelloSchema>;
export type IngestClientMessage = z.infer<typeof ingestClientMessageSchema>;
export type IngestServerMessage = z.infer<typeof ingestServerMessageSchema>;

export const AUDIO_FRAME_HEADER_BYTES = 16;

export interface AudioFrameHeader {
  protocolVersion: number;
  frameSequence: number;
  startSample: number;
  sampleCount: number;
}

const UINT32_BYTES = 4;

export const encodeAudioFrame = (header: AudioFrameHeader, pcm: Int16Array): ArrayBuffer => {
  if (header.sampleCount !== pcm.length) {
    throw new Error(`sampleCount ${header.sampleCount} does not match PCM length ${pcm.length}`);
  }

  const output = new ArrayBuffer(AUDIO_FRAME_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(output);
  view.setUint32(0 * UINT32_BYTES, header.protocolVersion, true);
  view.setUint32(1 * UINT32_BYTES, header.frameSequence, true);
  view.setUint32(2 * UINT32_BYTES, header.startSample, true);
  view.setUint32(3 * UINT32_BYTES, header.sampleCount, true);
  new Int16Array(output, AUDIO_FRAME_HEADER_BYTES).set(pcm);
  return output;
};

export const decodeAudioFrame = (frame: ArrayBuffer): { header: AudioFrameHeader; pcm: Int16Array } => {
  if (frame.byteLength < AUDIO_FRAME_HEADER_BYTES || (frame.byteLength - AUDIO_FRAME_HEADER_BYTES) % 2 !== 0) {
    throw new Error("Invalid audio frame length");
  }

  const view = new DataView(frame);
  const header = {
    protocolVersion: view.getUint32(0 * UINT32_BYTES, true),
    frameSequence: view.getUint32(1 * UINT32_BYTES, true),
    startSample: view.getUint32(2 * UINT32_BYTES, true),
    sampleCount: view.getUint32(3 * UINT32_BYTES, true),
  };
  const pcm = new Int16Array(frame.slice(AUDIO_FRAME_HEADER_BYTES));
  if (header.sampleCount !== pcm.length) throw new Error("Audio frame sample count mismatch");
  return { header, pcm };
};
