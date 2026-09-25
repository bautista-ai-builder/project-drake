import type { TranscriptFinal } from "@drake/contracts";
import { describe, expect, it, vi } from "vitest";
import { EventHub } from "../events/event-hub.js";
import type { TranslationProvider } from "../providers/translation.js";
import { TranslationScheduler } from "./scheduler.js";

const source: TranscriptFinal = {
  schemaVersion: 1, messageId: "m", type: "transcript.final", conferenceId: "c", stageId: "s", talkId: "t",
  sequence: 1, streamEpoch: 0, emittedAt: new Date().toISOString(), segmentId: "seg", revision: 1,
  audioStartSample: 0, audioEndSample: 1_600, sampleRate: 16_000, sourceLanguage: "en-US", text: "hello",
  completeness: "complete", providerEpoch: 0, provider: "fake", model: "fake",
};

describe("TranslationScheduler", () => {
  it("publishes translation later without blocking the original event", async () => {
    let release!: (value: string) => void;
    const delayed = new Promise<string>((resolve) => { release = resolve; });
    const provider: TranslationProvider = { name: "fake", model: "fake", translate: () => delayed };
    const hub = new EventHub();
    const observed: string[] = [];
    hub.subscribe((event) => { observed.push(event.type); });
    hub.publish(source);
    new TranslationScheduler(provider, hub).enqueue(source, "es", () => 2);
    expect(observed).toEqual(["transcript.final"]);
    release("hola");
    await vi.waitFor(() => expect(observed).toEqual(["transcript.final", "translation.final"]));
  });

  it("retries a transient provider failure and recovers health", async () => {
    const translate = vi.fn()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValue("hola");
    const provider: TranslationProvider = { name: "fake", model: "fake", translate };
    const hub = new EventHub();
    const health: string[] = [];
    const events: string[] = [];
    hub.subscribe((event) => events.push(event.type));
    new TranslationScheduler(provider, hub, { attempts: 2, timeoutMs: 100, retryDelayMs: 1 })
      .enqueue(source, "es", () => 2, (value) => health.push(value));
    await vi.waitFor(() => expect(events).toContain("translation.final"));
    expect(translate).toHaveBeenCalledTimes(2);
    expect(health).toEqual(["healthy"]);
  });

  it("marks translation degraded after bounded failures without affecting the original", async () => {
    const provider: TranslationProvider = { name: "fake", model: "fake", translate: vi.fn().mockRejectedValue(new Error("offline")) };
    const hub = new EventHub();
    const observed: string[] = [];
    let health = "healthy";
    hub.subscribe((event) => observed.push(event.type));
    hub.publish(source);
    new TranslationScheduler(provider, hub, { attempts: 2, timeoutMs: 100, retryDelayMs: 1 })
      .enqueue(source, "es", () => 2, (value) => { health = value; });
    await vi.waitFor(() => expect(health).toBe("degraded"));
    expect(observed).toEqual(["transcript.final"]);
  });
});
