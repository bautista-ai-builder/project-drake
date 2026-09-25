import type { CanonicalEvent } from "@drake/contracts";
import { describe, expect, it, vi } from "vitest";
import { EventHub } from "../events/event-hub.js";
import type { SttCallbacks, SttProvider } from "../providers/stt.js";
import type { TranslationProvider } from "../providers/translation.js";
import { TranslationScheduler } from "../translation/scheduler.js";
import { StageSupervisor } from "./stage-supervisor.js";

class MatrixStt implements SttProvider {
  name = "matrix-stt"; model = "fixture"; callbacks?: SttCallbacks;
  async connect(_input: unknown, callbacks: SttCallbacks) {
    this.callbacks = callbacks;
    return { sendAudio() {}, finish() {}, close() {} };
  }
}

const provider: TranslationProvider = {
  name: "matrix-translation", model: "fixture",
  async translate(text, source, target) { return `${source}->${target}:${text}`; },
};

describe("ES/EN/PT pipeline matrix", () => {
  it.each([
    { source: "es", targets: ["en"] },
    { source: "en", targets: ["es"] },
    { source: "pt", targets: ["en"] },
    { source: "es", targets: ["en", "pt"] },
  ])("routes $source to $targets", async ({ source, targets }) => {
    const stt = new MatrixStt(); const hub = new EventHub(); const events: CanonicalEvent[] = [];
    hub.subscribe((event) => events.push(event));
    const supervisor = new StageSupervisor(
      { conferenceId: "event", stageId: "stage", talkId: `talk-${source}-${targets.join("-")}`, sourceLanguage: source, targetLanguages: targets },
      stt, hub, new TranslationScheduler(provider, hub, { retryDelayMs: 1 }),
    );
    await supervisor.start(); supervisor.acceptAudio(0, new Int16Array(1_600)); stt.callbacks!.onFinal("contenido");
    await vi.waitFor(() => expect(events.filter((event) => event.type === "translation.final")).toHaveLength(targets.length));
    const original = events.find((event) => event.type === "transcript.final");
    const translations = events.filter((event) => event.type === "translation.final");
    expect(original).toMatchObject({ sourceLanguage: source, text: "contenido" });
    expect(translations.map((event) => event.type === "translation.final" && event.targetLanguage).sort()).toEqual([...targets].sort());
    expect(targets).not.toContain(source);
    supervisor.stop();
  });
});
