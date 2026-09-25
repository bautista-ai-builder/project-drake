import { randomUUID } from "node:crypto";
import type { TranscriptFinal, TranslationFinal } from "@drake/contracts";
import type { EventHub } from "../events/event-hub.js";
import type { TranslationProvider } from "../providers/translation.js";

export class TranslationScheduler {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly provider: TranslationProvider,
    private readonly hub: EventHub,
    private readonly options: { attempts?: number; timeoutMs?: number; retryDelayMs?: number } = {},
  ) {}

  enqueue(source: TranscriptFinal, targetLanguage: string, nextSequence: () => number, onHealth?: (health: "healthy" | "degraded") => void): void {
    const key = `${source.talkId}:${targetLanguage}`;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const started = performance.now();
        const text = await this.translateWithRetry(source, targetLanguage);
        const event: TranslationFinal = {
          schemaVersion: source.schemaVersion,
          messageId: randomUUID(),
          type: "translation.final",
          conferenceId: source.conferenceId,
          stageId: source.stageId,
          talkId: source.talkId,
          sequence: nextSequence(),
          streamEpoch: source.streamEpoch,
          emittedAt: new Date().toISOString(),
          segmentId: `${source.segmentId}:${targetLanguage}`,
          revision: source.revision,
          audioStartSample: source.audioStartSample,
          audioEndSample: source.audioEndSample,
          sampleRate: source.sampleRate,
          sourceLanguage: source.sourceLanguage,
          sourceSegmentId: source.segmentId,
          targetLanguage,
          text,
          provider: this.provider.name,
          model: this.provider.model,
          latencyMs: performance.now() - started,
        };
        this.hub.publish(event);
        onHealth?.("healthy");
      })
      .catch((error) => {
        onHealth?.("degraded");
        console.error({ error, talkId: source.talkId, targetLanguage }, "Translation failed; original remains live");
      });
    this.queues.set(key, current);
  }

  private async translateWithRetry(source: TranscriptFinal, targetLanguage: string): Promise<string> {
    const attempts = this.options.attempts ?? 2;
    const timeoutMs = this.options.timeoutMs ?? 4_000;
    const retryDelayMs = this.options.retryDelayMs ?? 200;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            this.provider.translate(source.text, source.sourceLanguage, targetLanguage),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error(`Translation timed out after ${timeoutMs}ms`)), timeoutMs);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
    throw lastError;
  }
}
