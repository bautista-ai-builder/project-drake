import type { TranscriptFinal, TranscriptPartial } from "@drake/contracts";
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { EventHub } from "../events/event-hub.js";
import { CaptionStore } from "./caption-store.js";

const base = {
  schemaVersion: 1 as const, messageId: "m", conferenceId: "c", stageId: "s", talkId: "t", sequence: 1,
  streamEpoch: 0, emittedAt: new Date().toISOString(), segmentId: "seg", revision: 1, audioStartSample: 0,
  audioEndSample: 1_600, sampleRate: 16_000, sourceLanguage: "en-US", text: "hello", providerEpoch: 0,
};

describe("CaptionStore", () => {
  it("persists finals but never partials", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new CaptionStore({ query } as unknown as pg.Pool);
    const hub = new EventHub();
    store.attach(hub);
    hub.publish({ ...base, type: "transcript.partial" } satisfies TranscriptPartial);
    hub.publish({ ...base, messageId: "final", sequence: 2, type: "transcript.final", completeness: "complete", provider: "fake", model: "fake" } satisfies TranscriptFinal);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    expect(query.mock.calls[0]?.[1]?.[0]).toBe("final");
  });

  it("restores the durable sequence and audio cursor after a runtime restart", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ sequence: "42", audio_end_sample: "96000", stream_epoch: 3 }] });
    const store = new CaptionStore({ query } as unknown as pg.Pool);
    await expect(store.runtimeCursor("talk")).resolves.toEqual({ sequence: 42, audioEndSample: 96_000, streamEpoch: 3 });
  });

  it("buffers a durable event while Postgres is unavailable and persists it after recovery", async () => {
    const query = vi.fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue({ rows: [] });
    const store = new CaptionStore({ query } as unknown as pg.Pool, 5);
    const hub = new EventHub();
    store.attach(hub);
    hub.publish({ ...base, messageId: "recoverable", type: "transcript.final", completeness: "complete", provider: "fake", model: "fake" } satisfies TranscriptFinal);
    await vi.waitFor(() => expect(store.status().failures).toBe(1));
    await vi.waitFor(() => expect(store.status()).toMatchObject({ status: "healthy", pending: 0 }));
    expect(query).toHaveBeenCalledTimes(2);
  });
});
