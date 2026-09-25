import { describe, expect, it } from "vitest";
import { canonicalEventSchema, isDurableEvent } from "./events.js";

const envelope = {
  schemaVersion: 1 as const,
  messageId: "msg-1",
  conferenceId: "nerdearla-2026",
  stageId: "main",
  talkId: "opening",
  sequence: 1,
  streamEpoch: 0,
  emittedAt: "2026-09-24T15:00:00.000Z",
};

describe("canonical events", () => {
  it("accepts a transcript partial and classifies it as ephemeral", () => {
    const event = canonicalEventSchema.parse({
      ...envelope,
      type: "transcript.partial",
      segmentId: "segment-1",
      revision: 1,
      audioStartSample: 0,
      audioEndSample: 16_000,
      sampleRate: 16_000,
      sourceLanguage: "en",
      text: "Hello",
      providerEpoch: 0,
    });

    expect(isDurableEvent(event)).toBe(false);
  });

  it("accepts a final translation and classifies it as durable", () => {
    const event = canonicalEventSchema.parse({
      ...envelope,
      type: "translation.final",
      segmentId: "segment-1-es",
      sourceSegmentId: "segment-1",
      revision: 1,
      audioStartSample: 0,
      audioEndSample: 16_000,
      sampleRate: 16_000,
      sourceLanguage: "en",
      targetLanguage: "es",
      text: "Hola",
      provider: "google",
      model: "nmt",
    });

    expect(isDurableEvent(event)).toBe(true);
  });
});

