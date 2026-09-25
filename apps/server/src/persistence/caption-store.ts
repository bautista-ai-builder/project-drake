import type { CanonicalEvent } from "@drake/contracts";
import { canonicalEventSchema, isDurableEvent } from "@drake/contracts";
import type pg from "pg";
import type { EventHub } from "../events/event-hub.js";

const value = (event: CanonicalEvent, key: string) => key in event ? (event as unknown as Record<string, unknown>)[key] : null;

export class CaptionStore {
  private readonly pending: CanonicalEvent[] = [];
  private draining = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private healthy = true;
  private failures = 0;
  private lastError?: string;

  constructor(
    private readonly pool: pg.Pool,
    private readonly retryDelayMs = 1_000,
  ) {}

  attach(hub: EventHub): () => void {
    return hub.subscribe((event) => {
      if (!isDurableEvent(event)) return;
      this.enqueue(event);
    });
  }

  status() {
    return {
      status: this.healthy ? "healthy" as const : "degraded" as const,
      pending: this.pending.length,
      failures: this.failures,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  private enqueue(event: CanonicalEvent): void {
    this.pending.push(event);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.pending.length === 0) return;
    this.draining = true;
    clearTimeout(this.retryTimer);
    try {
      while (this.pending[0]) {
        await this.persist(this.pending[0]);
        this.pending.shift();
      }
      this.healthy = true;
      delete this.lastError;
    } catch (error) {
      this.healthy = false;
      this.failures += 1;
      this.lastError = String(error).slice(0, 300);
      this.retryTimer = setTimeout(() => void this.drain(), this.retryDelayMs);
    } finally {
      this.draining = false;
    }
  }

  async persist(event: CanonicalEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO caption_events (
        message_id, conference_id, stage_id, talk_id, sequence, kind, segment_id, revision,
        source_segment_id, source_language, target_language, text, audio_start_sample, audio_end_sample,
        sample_rate, completeness, stream_epoch, provider_epoch, provider, model, latency_ms, payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb)
      ON CONFLICT DO NOTHING`,
      [
        event.messageId, event.conferenceId, event.stageId, event.talkId, event.sequence, event.type,
        value(event, "segmentId"), value(event, "revision"), value(event, "sourceSegmentId"),
        value(event, "sourceLanguage"), value(event, "targetLanguage"), value(event, "text"),
        value(event, "audioStartSample"), value(event, "audioEndSample"), value(event, "sampleRate"),
        value(event, "completeness"), event.streamEpoch, value(event, "providerEpoch"), value(event, "provider"),
        value(event, "model"), value(event, "latencyMs"), JSON.stringify(event),
      ],
    );
  }

  async replay(talkId: string, afterSequence = 0): Promise<CanonicalEvent[]> {
    const result = await this.pool.query<{ payload: unknown }>(
      "SELECT payload FROM caption_events WHERE talk_id = $1 AND sequence > $2 ORDER BY sequence ASC",
      [talkId, afterSequence],
    );
    return result.rows.map((row) => canonicalEventSchema.parse(row.payload));
  }

  async runtimeCursor(talkId: string): Promise<{ sequence: number; audioEndSample: number; streamEpoch: number }> {
    const result = await this.pool.query<{ sequence: string | null; audio_end_sample: string | null; stream_epoch: number | null }>(
      `SELECT MAX(sequence)::text AS sequence, MAX(audio_end_sample)::text AS audio_end_sample,
         MAX(stream_epoch) AS stream_epoch FROM caption_events WHERE talk_id=$1`,
      [talkId],
    );
    const row = result.rows[0];
    return {
      sequence: Number(row?.sequence ?? 0),
      audioEndSample: Number(row?.audio_end_sample ?? 0),
      streamEpoch: Number(row?.stream_epoch ?? 0),
    };
  }
}
