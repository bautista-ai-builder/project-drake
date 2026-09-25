import { randomUUID } from "node:crypto";
import type pg from "pg";
import { mapTalk, type TalkRecord } from "./talk-store.js";

export interface ConferenceSummary {
  conferenceId: string;
  name: string;
  stageCount: number;
  liveTalkCount: number;
  status: "live" | "ready";
  createdAt: string;
}

export interface StageSummary {
  conferenceId: string;
  stageId: string;
  stageName: string;
  talkCount: number;
  currentTalk?: TalkRecord;
}

export class ConferenceStore {
  constructor(private readonly pool: pg.Pool) {}

  async list(): Promise<ConferenceSummary[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT c.slug AS conference_id, c.name, c.created_at,
        COUNT(DISTINCT s.id)::int AS stage_count,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status IN ('starting','live','finalizing'))::int AS live_talk_count
       FROM conferences c
       LEFT JOIN stages s ON s.conference_id=c.id
       LEFT JOIN talks t ON t.stage_id=s.id
       GROUP BY c.id ORDER BY c.created_at DESC`,
    );
    return result.rows.map((row) => ({
      conferenceId: String(row.conference_id), name: String(row.name),
      stageCount: Number(row.stage_count), liveTalkCount: Number(row.live_talk_count),
      status: Number(row.live_talk_count) > 0 ? "live" : "ready",
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  }

  async create(input: { conferenceId: string; name: string }): Promise<ConferenceSummary> {
    await this.pool.query(
      "INSERT INTO conferences (id, slug, name) VALUES ($1,$2,$3)",
      [randomUUID(), input.conferenceId, input.name],
    );
    return (await this.list()).find((event) => event.conferenceId === input.conferenceId)!;
  }

  async get(conferenceId: string): Promise<{ conference: ConferenceSummary; stages: StageSummary[] } | undefined> {
    const conference = (await this.list()).find((event) => event.conferenceId === conferenceId);
    if (!conference) return undefined;
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT s.slug AS stage_id, s.name AS stage_name,
        (SELECT COUNT(*)::int FROM talks counted WHERE counted.stage_id=s.id) AS talk_count,
        c.slug AS conference_id,
        t.slug AS talk_id, t.title, t.speaker, t.source_language, t.enabled_targets, t.status,
        t.created_at AS configured_at, t.started_at, t.ended_at,
        EXTRACT(EPOCH FROM (COALESCE(t.ended_at, now()) - t.started_at)) AS duration_seconds,
        c.name AS conference_name
       FROM stages s JOIN conferences c ON c.id=s.conference_id
       LEFT JOIN LATERAL (
         SELECT * FROM talks candidate WHERE candidate.stage_id=s.id AND candidate.status<>'completed'
         ORDER BY CASE candidate.status WHEN 'live' THEN 0 WHEN 'starting' THEN 1 WHEN 'ready' THEN 2 ELSE 3 END,
           candidate.created_at DESC LIMIT 1
       ) t ON true
       WHERE c.slug=$1 ORDER BY s.created_at`,
      [conferenceId],
    );
    return {
      conference,
      stages: result.rows.map((row) => ({
        conferenceId, stageId: String(row.stage_id), stageName: String(row.stage_name),
        talkCount: Number(row.talk_count),
        ...(row.talk_id ? { currentTalk: mapTalk(row) } : {}),
      })),
    };
  }

  async createStage(input: { conferenceId: string; stageId: string; stageName: string }): Promise<StageSummary> {
    const collision = await this.pool.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM stages WHERE slug=$1) AS exists", [input.stageId]);
    if (collision.rows[0]?.exists) throw new Error("stage_slug_in_use");
    const inserted = await this.pool.query(
      `INSERT INTO stages (id, conference_id, slug, name)
       SELECT $1,c.id,$2,$3 FROM conferences c WHERE c.slug=$4 RETURNING id`,
      [randomUUID(), input.stageId, input.stageName, input.conferenceId],
    );
    if (!inserted.rows[0]) throw new Error("conference_not_found");
    return { conferenceId: input.conferenceId, stageId: input.stageId, stageName: input.stageName, talkCount: 0 };
  }
}
