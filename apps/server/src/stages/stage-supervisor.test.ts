import type { SttCallbacks, SttProvider } from "../providers/stt.js";
import { describe, expect, it, vi } from "vitest";
import { EventHub } from "../events/event-hub.js";
import { StageSupervisor } from "./stage-supervisor.js";

class FakeStt implements SttProvider {
  name = "fake"; model = "fake-1"; callbacks: SttCallbacks[] = []; sent: Int16Array[][] = []; closed = 0;
  async connect(_input: unknown, callbacks: SttCallbacks) {
    const sent: Int16Array[] = [];
    this.callbacks.push(callbacks); this.sent.push(sent);
    return { sendAudio: (pcm: Int16Array) => sent.push(pcm), finish: () => undefined, close: () => { this.closed += 1; } };
  }
}

describe("StageSupervisor", () => {
  it("publishes a final using the audio sample clock", async () => {
    const stt = new FakeStt();
    const hub = new EventHub();
    const supervisor = new StageSupervisor(
      { conferenceId: "c", stageId: "s", talkId: "t", sourceLanguage: "en-US", targetLanguages: [] }, stt, hub,
    );
    await supervisor.start();
    supervisor.acceptAudio(0, new Int16Array(1_600));
    stt.callbacks[0]!.onFinal("Hello Drake");
    expect(hub.snapshot("t").find((event) => event.type === "transcript.final")).toMatchObject({
      type: "transcript.final", text: "Hello Drake", audioEndSample: 1_600,
    });
  });

  it("resumes from available client audio and records an explicit gap", async () => {
    const stt = new FakeStt();
    const hub = new EventHub();
    const supervisor = new StageSupervisor(
      { conferenceId: "c", stageId: "s", talkId: "t", sourceLanguage: "en-US", targetLanguages: [] }, stt, hub,
    );
    await supervisor.start();
    supervisor.attachIngest("capture-a");
    expect(supervisor.resumeFrom(48_000)).toBe(48_000);
    supervisor.acceptAudio(48_000, new Int16Array(1_600));
    expect(hub.snapshot("t").some((event) => event.type === "stream.gap" && event.audioEndSample === 48_000)).toBe(true);
  });

  it("continues durable cursors with a new stream epoch after runtime restart", async () => {
    const stt = new FakeStt();
    const supervisor = new StageSupervisor(
      { conferenceId: "c", stageId: "s", talkId: "t", sourceLanguage: "en-US", targetLanguages: [], initialSequence: 40, initialExpectedSample: 32_000, initialStreamEpoch: 2 },
      stt, new EventHub(),
    );
    await supervisor.start();
    expect(supervisor.attachIngest("capture")).toBe(32_000);
    expect(supervisor.snapshot()).toMatchObject({ streamEpoch: 3, reconnects: 1, acceptedThroughSample: 32_000 });
    supervisor.stop();
  });

  it("rotates provider sessions with pre-roll and a new authority epoch", async () => {
    const stt = new FakeStt();
    const hub = new EventHub();
    const supervisor = new StageSupervisor(
      { conferenceId: "c", stageId: "s", talkId: "t", sourceLanguage: "en-US", targetLanguages: [] }, stt, hub,
    );
    await supervisor.start();
    supervisor.acceptAudio(0, new Int16Array(1_600));
    await supervisor.rotateNow();
    expect(stt.callbacks).toHaveLength(2);
    expect(stt.sent[1]).toHaveLength(1);
    expect(stt.closed).toBe(1);
    expect(supervisor.snapshot()).toMatchObject({ providerEpoch: 1, rotations: 1, sttStatus: "healthy" });
  });

  it("schedules rotation at a final boundary after an artificial limit", async () => {
    const stt = new FakeStt();
    const hub = new EventHub();
    const supervisor = new StageSupervisor(
      { conferenceId: "c", stageId: "s", talkId: "t", sourceLanguage: "en-US", targetLanguages: [] }, stt, hub, undefined, 1,
    );
    await supervisor.start();
    supervisor.acceptAudio(0, new Int16Array(1_600));
    await new Promise((done) => setTimeout(done, 5));
    stt.callbacks[0]!.onFinal("Boundary");
    await vi.waitFor(() => expect(supervisor.snapshot().rotations).toBe(1));
    supervisor.stop();
  });

  it("recovers a failed provider session with ring-buffer replay while the stage stays live", async () => {
    const stt = new FakeStt();
    const supervisor = new StageSupervisor(
      { conferenceId: "c", stageId: "s", talkId: "t", sourceLanguage: "en-US", targetLanguages: [] }, stt, new EventHub(),
    );
    await supervisor.start();
    supervisor.acceptAudio(0, new Int16Array(1_600));
    stt.callbacks[0]!.onError(new Error("provider disconnected"));
    supervisor.acceptAudio(1_600, new Int16Array(1_600));
    await vi.waitFor(() => expect(supervisor.snapshot()).toMatchObject({
      stageStatus: "live", sttStatus: "healthy", providerEpoch: 1, providerRecoveries: 1, acceptedThroughSample: 3_200,
    }));
    expect(stt.sent[1]?.reduce((total, chunk) => total + chunk.length, 0)).toBe(3_200);
    supervisor.stop();
  });

  it("recovers when a provider closes without first emitting an error", async () => {
    const stt = new FakeStt();
    const supervisor = new StageSupervisor(
      { conferenceId: "c", stageId: "s", talkId: "t", sourceLanguage: "en-US", targetLanguages: [] }, stt, new EventHub(),
    );
    await supervisor.start();
    stt.callbacks[0]!.onClose("network closed");
    await vi.waitFor(() => expect(supervisor.snapshot()).toMatchObject({ sttStatus: "healthy", providerRecoveries: 1 }));
    supervisor.stop();
  });
});
