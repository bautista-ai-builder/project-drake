import { describe, expect, it } from "vitest";
import { StreamingPcm16Resampler, floatToPcm16 } from "./pcm.js";

describe("PCM conversion", () => {
  it("clamps floats to signed 16-bit PCM", () => {
    expect([floatToPcm16(-2), floatToPcm16(0), floatToPcm16(2)]).toEqual([-32768, 0, 32767]);
  });

  it("emits exactly 16k samples for one second at 48k", () => {
    const resampler = new StreamingPcm16Resampler(48_000);
    const output = resampler.push(new Float32Array(48_000));
    expect(output).toHaveLength(16_000);
  });
});
