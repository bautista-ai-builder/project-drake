import type { SttProvider } from "../providers/stt.js";
import { describe, expect, it } from "vitest";
import { EventHub } from "../events/event-hub.js";
import { StageRegistry } from "./registry.js";

const stt: SttProvider = {
  name: "fake", model: "fake-1",
  async connect() { return { sendAudio() {}, finish() {}, close() {} }; },
};

describe("StageRegistry", () => {
  it("isolates supervisors and snapshots by stage", async () => {
    const registry = new StageRegistry(stt, new EventHub());
    const main = registry.getOrCreate({ conferenceId: "c", stageId: "main", talkId: "t1", sourceLanguage: "en", targetLanguages: ["es"] });
    const ai = registry.getOrCreate({ conferenceId: "c", stageId: "ai", talkId: "t2", sourceLanguage: "es", targetLanguages: ["en"] });
    await Promise.all([main.start(), ai.start()]);
    main.acceptAudio(0, new Int16Array(800));
    expect(registry.snapshots()).toHaveLength(2);
    expect(registry.activeForStage("main")?.snapshot().acceptedThroughSample).toBe(800);
    expect(registry.activeForStage("ai")?.snapshot().acceptedThroughSample).toBe(0);
  });
});
