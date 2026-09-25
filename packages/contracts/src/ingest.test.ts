import { describe, expect, it } from "vitest";
import { decodeAudioFrame, encodeAudioFrame } from "./ingest.js";

describe("audio frame codec", () => {
  it("round-trips header and signed PCM samples", () => {
    const pcm = Int16Array.from([-32768, -1, 0, 1, 32767]);
    const encoded = encodeAudioFrame(
      { protocolVersion: 1, frameSequence: 7, startSample: 16_000, sampleCount: pcm.length },
      pcm,
    );
    const decoded = decodeAudioFrame(encoded);
    expect(decoded.header).toEqual({ protocolVersion: 1, frameSequence: 7, startSample: 16_000, sampleCount: 5 });
    expect([...decoded.pcm]).toEqual([...pcm]);
  });

  it("rejects a mismatched sample count", () => {
    expect(() =>
      encodeAudioFrame({ protocolVersion: 1, frameSequence: 0, startSample: 0, sampleCount: 2 }, Int16Array.of(1)),
    ).toThrow(/sampleCount/);
  });
});
