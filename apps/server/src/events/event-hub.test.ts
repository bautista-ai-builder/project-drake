import type { TranscriptPartial } from "@drake/contracts";
import { describe, expect, it } from "vitest";
import { EventHub } from "./event-hub.js";

const partial = (revision: number, text: string): TranscriptPartial => ({
  schemaVersion: 1, messageId: `m-${revision}`, type: "transcript.partial", conferenceId: "c", stageId: "s",
  talkId: "t", sequence: revision, streamEpoch: 0, emittedAt: new Date().toISOString(), segmentId: "seg",
  revision, audioStartSample: 0, audioEndSample: revision * 100, sampleRate: 16_000, sourceLanguage: "en-US",
  text, providerEpoch: 0,
});

describe("EventHub", () => {
  it("coalesces partial revisions in its snapshot", () => {
    const hub = new EventHub();
    hub.publish(partial(1, "hel"));
    hub.publish(partial(2, "hello"));
    expect(hub.snapshot("t")).toHaveLength(1);
    expect((hub.snapshot("t")[0] as TranscriptPartial).text).toBe("hello");
  });
});
