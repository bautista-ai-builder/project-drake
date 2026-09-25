import { describe, expect, it } from "vitest";
import { SampleRingBuffer } from "./sample-ring.js";

describe("SampleRingBuffer", () => {
  it("retains only the configured recent window", () => {
    const ring = new SampleRingBuffer(10, 2);
    ring.append({ startSample: 0, pcm: new Int16Array(10) });
    ring.append({ startSample: 10, pcm: new Int16Array(10) });
    ring.append({ startSample: 20, pcm: new Int16Array(10) });
    expect(ring.availableFromSample).toBe(10);
    expect(ring.range(15, 25).map((chunk) => chunk.startSample)).toEqual([10, 20]);
  });
});
