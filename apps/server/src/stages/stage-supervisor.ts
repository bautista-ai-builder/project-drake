import { randomUUID } from "node:crypto";
import type { ComponentHealth, StageStatus, StreamGap, TalkStatus, TranscriptFinal, TranscriptPartial } from "@drake/contracts";
import { SampleRingBuffer } from "../audio/sample-ring.js";
import type { EventHub } from "../events/event-hub.js";
import type { SttProvider, SttSession } from "../providers/stt.js";
import type { TranslationScheduler } from "../translation/scheduler.js";

export interface TalkRuntimeConfig {
  conferenceId: string;
  stageId: string;
  talkId: string;
  sourceLanguage: string;
  targetLanguages: string[];
  vocabulary?: string[];
  initialSequence?: number;
  initialExpectedSample?: number;
  initialStreamEpoch?: number;
}

export type SupervisorSnapshot = {
  conferenceId: string;
  stageId: string;
  talkId: string;
  stageStatus: TalkStatus;
  audioStatus: ComponentHealth;
  sttStatus: ComponentHealth;
  translationStatus: Record<string, ComponentHealth>;
  provider: string;
  model: string;
  providerEpoch: number;
  streamEpoch: number;
  acceptedThroughSample: number;
  audioSeconds: number;
  lastAudioAt?: string;
  reconnects: number;
  providerRecoveries: number;
  rotations: number;
  gaps: number;
};

export class StageSupervisor {
  private session: SttSession | undefined;
  private connectPromise: Promise<void> | undefined;
  private rotationPromise: Promise<void> | undefined;
  private rotationTimer: ReturnType<typeof setTimeout> | undefined;
  private rotationDue = false;
  private suppressCallbacksThroughSample = -1;
  private sequence: number;
  private providerEpoch = 0;
  private streamEpoch: number;
  private expectedSample: number;
  private segmentStartSample: number;
  private revision = 0;
  private segmentId = randomUUID();
  private stageStatus: TalkStatus = "ready";
  private audioStatus: ComponentHealth = "disconnected";
  private sttStatus: ComponentHealth = "disconnected";
  private translationStatus: Record<string, ComponentHealth>;
  private captureSessionId?: string;
  private reconnects = 0;
  private providerRecoveries = 0;
  private recoveryPromise: Promise<void> | undefined;
  private rotations = 0;
  private gaps = 0;
  private lastAudioAt?: string;
  private readonly ring = new SampleRingBuffer(16_000, 20);

  constructor(
    readonly config: TalkRuntimeConfig,
    private readonly stt: SttProvider,
    private readonly hub: EventHub,
    private readonly translations?: TranslationScheduler,
    private readonly rotationMs = 8 * 60_000,
  ) {
    this.sequence = config.initialSequence ?? 0;
    this.expectedSample = config.initialExpectedSample ?? 0;
    this.segmentStartSample = this.expectedSample;
    this.streamEpoch = config.initialStreamEpoch ?? 0;
    this.translationStatus = Object.fromEntries(config.targetLanguages.map((target) => [target, translations ? "healthy" : "disconnected"]));
  }

  async start(): Promise<void> {
    if (this.session) return;
    if (this.connectPromise) return this.connectPromise;
    this.stageStatus = "starting";
    this.sttStatus = "connecting";
    this.emitStatus("stage_starting");
    this.connectPromise = this.connectSession(this.providerEpoch).then((session) => {
      this.session = session;
      this.stageStatus = "live";
      this.sttStatus = "healthy";
      this.scheduleRotation();
      this.emitStatus("stage_live");
    });
    return this.connectPromise.finally(() => { this.connectPromise = undefined; });
  }

  attachIngest(captureSessionId: string): number {
    if (this.captureSessionId || this.expectedSample > 0) {
      this.streamEpoch += 1;
      this.reconnects += 1;
    }
    this.captureSessionId = captureSessionId;
    this.audioStatus = "healthy";
    this.emitStatus("ingest_attached");
    return this.expectedSample;
  }

  detachIngest(): void {
    if (this.stageStatus !== "completed") {
      this.audioStatus = "disconnected";
      this.emitStatus("ingest_detached");
    }
  }

  resumeFrom(availableFromSample: number): number {
    if (availableFromSample <= this.expectedSample) return this.expectedSample;
    this.publishGap(this.expectedSample, availableFromSample, "reconnect_buffer_exhausted");
    this.expectedSample = availableFromSample;
    this.segmentStartSample = Math.max(this.segmentStartSample, availableFromSample);
    return availableFromSample;
  }

  acceptAudio(startSample: number, pcm: Int16Array): { acceptedThroughSample: number; gap?: { from: number; to: number } } {
    if (!this.session && this.stageStatus !== "live") throw new Error("STT session is not ready");
    const gap = startSample > this.expectedSample ? { from: this.expectedSample, to: startSample } : undefined;
    if (startSample < this.expectedSample) return { acceptedThroughSample: this.expectedSample };
    this.ring.append({ startSample, pcm });
    this.expectedSample = startSample + pcm.length;
    this.lastAudioAt = new Date().toISOString();
    this.audioStatus = "healthy";
    this.session?.sendAudio(pcm);
    if (gap) this.publishGap(gap.from, gap.to, "ingest_sample_gap");
    return { acceptedThroughSample: this.expectedSample, ...(gap ? { gap } : {}) };
  }

  finish(): void {
    if (this.stageStatus === "completed") return;
    this.stageStatus = "finalizing";
    this.emitStatus("operator_stop");
    this.session?.finish();
  }

  stop(): void {
    clearTimeout(this.rotationTimer);
    this.session?.close();
    this.session = undefined;
    this.stageStatus = "completed";
    this.audioStatus = "disconnected";
    this.sttStatus = "disconnected";
    this.emitStatus("talk_completed");
  }

  snapshot(): SupervisorSnapshot {
    return {
      conferenceId: this.config.conferenceId,
      stageId: this.config.stageId,
      talkId: this.config.talkId,
      stageStatus: this.stageStatus,
      audioStatus: this.audioStatus,
      sttStatus: this.sttStatus,
      translationStatus: { ...this.translationStatus },
      provider: this.stt.name,
      model: this.stt.model,
      providerEpoch: this.providerEpoch,
      streamEpoch: this.streamEpoch,
      acceptedThroughSample: this.expectedSample,
      audioSeconds: this.expectedSample / 16_000,
      ...(this.lastAudioAt ? { lastAudioAt: this.lastAudioAt } : {}),
      reconnects: this.reconnects,
      providerRecoveries: this.providerRecoveries,
      rotations: this.rotations,
      gaps: this.gaps,
    };
  }

  async rotateNow(): Promise<void> {
    if (this.rotationPromise || !this.session) return this.rotationPromise;
    const previous = this.session;
    const nextEpoch = this.providerEpoch + 1;
    this.sttStatus = "connecting";
    this.emitStatus("provider_rotating");
    this.rotationPromise = this.connectSession(nextEpoch).then((next) => {
      const replayFrom = Math.max(0, this.expectedSample - 32_000);
      for (const chunk of this.ring.range(replayFrom, this.expectedSample)) next.sendAudio(chunk.pcm);
      this.providerEpoch = nextEpoch;
      this.suppressCallbacksThroughSample = this.expectedSample;
      this.session = next;
      this.rotations += 1;
      this.rotationDue = false;
      this.sttStatus = "healthy";
      previous.close();
      this.scheduleRotation();
      this.emitStatus("provider_rotated");
    }).catch((error) => {
      this.sttStatus = "degraded";
      this.emitStatus("provider_rotation_failed", String(error));
      throw error;
    }).finally(() => { this.rotationPromise = undefined; });
    return this.rotationPromise;
  }

  private connectSession(epoch: number): Promise<SttSession> {
    return this.stt.connect(
      { languageCode: this.config.sourceLanguage, ...(this.config.vocabulary ? { vocabulary: this.config.vocabulary } : {}) },
      {
        onPartial: (text) => { if (this.callbacksAllowed(epoch)) this.emitPartial(text); },
        onFinal: (text) => { if (this.callbacksAllowed(epoch)) this.emitFinal(text); },
        onError: (error) => {
          if (epoch !== this.providerEpoch) return;
          this.session = undefined;
          this.sttStatus = "degraded";
          this.emitStatus("stt_provider_error", error.message);
          void this.recoverProvider(epoch);
        },
        onClose: (reason) => {
          if (epoch !== this.providerEpoch || this.stageStatus !== "live") return;
          this.session = undefined;
          this.sttStatus = "degraded";
          this.emitStatus("stt_session_closed", reason);
          void this.recoverProvider(epoch);
        },
      },
    );
  }

  private async recoverProvider(failedEpoch: number): Promise<void> {
    if (this.recoveryPromise || this.stageStatus === "completed") return this.recoveryPromise;
    this.recoveryPromise = (async () => {
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const nextEpoch = failedEpoch + attempt;
        this.providerEpoch = nextEpoch;
        this.sttStatus = "connecting";
        this.emitStatus("stt_reconnecting", `attempt=${attempt}`);
        try {
          const next = await this.connectSession(nextEpoch);
          const replayThrough = this.expectedSample;
          const replayFrom = Math.max(0, replayThrough - 32_000);
          for (const chunk of this.ring.range(replayFrom, replayThrough)) next.sendAudio(chunk.pcm);
          this.suppressCallbacksThroughSample = replayThrough;
          this.session = next;
          this.providerRecoveries += 1;
          this.sttStatus = "healthy";
          this.emitStatus("stt_recovered");
          return;
        } catch (error) {
          this.emitStatus("stt_reconnect_failed", String(error));
          if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        }
      }
      this.sttStatus = "failed";
      this.stageStatus = "error";
      this.emitStatus("stt_recovery_exhausted");
    })().finally(() => { this.recoveryPromise = undefined; });
    return this.recoveryPromise;
  }

  private scheduleRotation(): void {
    clearTimeout(this.rotationTimer);
    this.rotationTimer = setTimeout(() => { this.rotationDue = true; }, this.rotationMs);
  }

  private callbacksAllowed(epoch: number): boolean {
    return epoch === this.providerEpoch && this.expectedSample > this.suppressCallbacksThroughSample;
  }

  private envelope(type: string) {
    return {
      schemaVersion: 1 as const,
      messageId: randomUUID(),
      type,
      conferenceId: this.config.conferenceId,
      stageId: this.config.stageId,
      talkId: this.config.talkId,
      sequence: this.nextSequence(),
      streamEpoch: this.streamEpoch,
      emittedAt: new Date().toISOString(),
    };
  }

  private emitPartial(text: string): void {
    this.revision += 1;
    const event: TranscriptPartial = {
      ...this.envelope("transcript.partial"), type: "transcript.partial", segmentId: this.segmentId,
      revision: this.revision, audioStartSample: this.segmentStartSample, audioEndSample: this.expectedSample,
      sampleRate: 16_000, sourceLanguage: this.config.sourceLanguage, text, providerEpoch: this.providerEpoch,
    };
    this.hub.publish(event);
  }

  private emitFinal(text: string): void {
    this.revision += 1;
    const event: TranscriptFinal = {
      ...this.envelope("transcript.final"), type: "transcript.final", segmentId: this.segmentId,
      revision: this.revision, audioStartSample: this.segmentStartSample, audioEndSample: this.expectedSample,
      sampleRate: 16_000, sourceLanguage: this.config.sourceLanguage, text, completeness: "complete",
      providerEpoch: this.providerEpoch, provider: this.stt.name, model: this.stt.model,
    };
    this.hub.publish(event);
    for (const target of this.config.targetLanguages) this.translations?.enqueue(event, target, () => this.nextSequence(), (health) => {
      if (this.translationStatus[target] === health) return;
      this.translationStatus[target] = health;
      this.emitStatus(health === "healthy" ? "translation_healthy" : "translation_degraded");
    });
    this.segmentStartSample = this.expectedSample;
    this.segmentId = randomUUID();
    this.revision = 0;
    if (this.rotationDue) void this.rotateNow();
    if (this.stageStatus === "finalizing") this.stop();
  }

  private publishGap(from: number, to: number, reason: string): void {
    if (to <= from) return;
    this.gaps += 1;
    const event: StreamGap = {
      ...this.envelope("stream.gap"), type: "stream.gap", audioStartSample: from, audioEndSample: to,
      sampleRate: 16_000, reason, recoverable: true, providerEpoch: this.providerEpoch,
    };
    this.hub.publish(event);
  }

  private emitStatus(reasonCode: string, detail?: string): void {
    const event: StageStatus = {
      ...this.envelope("stage.status"), type: "stage.status", stageStatus: this.stageStatus,
      audioStatus: this.audioStatus, sttStatus: this.sttStatus, translationStatus: { ...this.translationStatus },
      reasonCode, ...(detail ? { detail: detail.slice(0, 300) } : {}),
    };
    this.hub.publish(event);
  }

  private nextSequence = () => ++this.sequence;
}
