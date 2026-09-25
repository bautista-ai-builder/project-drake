import type { EventHub } from "../events/event-hub.js";
import type { SttProvider } from "../providers/stt.js";
import type { TranslationScheduler } from "../translation/scheduler.js";
import { StageSupervisor, type TalkRuntimeConfig } from "./stage-supervisor.js";

export class StageRegistry {
  private readonly supervisors = new Map<string, StageSupervisor>();

  constructor(
    private readonly stt: SttProvider,
    private readonly hub: EventHub,
    private readonly translations?: TranslationScheduler,
    private readonly rotationMs?: number,
  ) {}

  getOrCreate(config: TalkRuntimeConfig): StageSupervisor {
    const key = `${config.stageId}:${config.talkId}`;
    const existing = this.supervisors.get(key);
    if (existing) return existing;
    const supervisor = new StageSupervisor(config, this.stt, this.hub, this.translations, this.rotationMs);
    this.supervisors.set(key, supervisor);
    return supervisor;
  }

  get(stageId: string, talkId: string): StageSupervisor | undefined {
    return this.supervisors.get(`${stageId}:${talkId}`);
  }

  activeForStage(stageId: string): StageSupervisor | undefined {
    return [...this.supervisors.values()].find((supervisor) =>
      supervisor.config.stageId === stageId && supervisor.snapshot().stageStatus !== "completed");
  }

  snapshots() {
    return [...this.supervisors.values()].map((supervisor) => supervisor.snapshot());
  }

  stop(stageId: string, talkId: string): void {
    this.get(stageId, talkId)?.stop();
  }
}
