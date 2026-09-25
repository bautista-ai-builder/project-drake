import type { CanonicalEvent, TranscriptFinal, TranslationFinal } from "@drake/contracts";
import { describe, expect, it } from "vitest";
import { renderText, renderVtt, selectCaptions } from "./captions.js";

const original: TranscriptFinal = {
  schemaVersion: 1, messageId: "o", type: "transcript.final", conferenceId: "c", stageId: "s", talkId: "t",
  sequence: 1, streamEpoch: 0, emittedAt: new Date().toISOString(), segmentId: "seg", revision: 1,
  audioStartSample: 16_000, audioEndSample: 40_000, sampleRate: 16_000, sourceLanguage: "en-US",
  text: "Deploy with Kubernetes.", completeness: "complete", providerEpoch: 0, provider: "fake", model: "fake",
};
const translated: TranslationFinal = {
  ...original, messageId: "tr", type: "translation.final", sequence: 2, segmentId: "seg:es",
  sourceSegmentId: "seg", targetLanguage: "es", text: "Desplegá con Kubernetes.", provider: "translation", model: "nmt",
};

describe("caption exports", () => {
  const events: CanonicalEvent[] = [translated, original];

  it("selects one language without mixing original and translation", () => {
    expect(selectCaptions(events, "original").map((item) => item.text)).toEqual([original.text]);
    expect(selectCaptions(events, "es").map((item) => item.text)).toEqual([translated.text]);
  });

  it("renders WebVTT timestamps from the audio sample clock", () => {
    expect(renderVtt([original])).toContain("00:00:01.000 --> 00:00:02.500\nDeploy with Kubernetes.");
  });

  it("renders timestamped plain text", () => {
    expect(renderText([translated])).toBe("[00:00:01.000] Desplegá con Kubernetes.\n");
  });
});
