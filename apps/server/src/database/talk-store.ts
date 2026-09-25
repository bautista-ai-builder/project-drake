import { randomUUID } from "node:crypto";
import type pg from "pg";

export interface TalkRecord {
  conferenceId: string;
  conferenceName: string;
  stageId: string;
  stageName: string;
  talkId: string;
  title: string;
  speaker: string;
  sourceLanguage: string;
  targetLanguages: string[];
  status: "ready" | "starting" | "live" | "finalizing" | "completed" | "error";
  configuredAt?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds: number;
}

const selectTalk = `
  SELECT c.slug AS conference_id, c.name AS conference_name, s.slug AS stage_id, s.name AS stage_name,
    t.slug AS talk_id, t.title, t.speaker, t.source_language, t.enabled_targets, t.status,
    t.created_at AS configured_at, t.started_at, t.ended_at,
    EXTRACT(EPOCH FROM (COALESCE(t.ended_at, now()) - t.started_at)) AS duration_seconds
  FROM talks t
  JOIN stages s ON s.id = t.stage_id
  JOIN conferences c ON c.id = s.conference_id`;

export const mapTalk = (row: Record<string, unknown>): TalkRecord => ({
  conferenceId: String(row.conference_id),
  conferenceName: String(row.conference_name),
  stageId: String(row.stage_id),
  stageName: String(row.stage_name),
  talkId: String(row.talk_id),
  title: String(row.title),
  speaker: String(row.speaker),
  sourceLanguage: String(row.source_language),
  targetLanguages: row.enabled_targets as string[],
  status: row.status as TalkRecord["status"],
  ...(row.configured_at ? { configuredAt: new Date(String(row.configured_at)).toISOString() } : {}),
  ...(row.started_at ? { startedAt: new Date(String(row.started_at)).toISOString() } : {}),
  ...(row.ended_at ? { endedAt: new Date(String(row.ended_at)).toISOString() } : {}),
  durationSeconds: Math.max(0, Math.round(Number(row.duration_seconds ?? 0))),
});

export class TalkStore {
  constructor(private readonly pool: pg.Pool) {}

  async get(stageId: string, talkId: string): Promise<TalkRecord | undefined> {
    const result = await this.pool.query(`${selectTalk} WHERE s.slug = $1 AND t.slug = $2`, [stageId, talkId]);
    return result.rows[0] ? mapTalk(result.rows[0]) : undefined;
  }

  async getScoped(conferenceId: string, stageId: string, talkId: string): Promise<TalkRecord | undefined> {
    const result = await this.pool.query(`${selectTalk} WHERE c.slug = $1 AND s.slug = $2 AND t.slug = $3`, [conferenceId, stageId, talkId]);
    return result.rows[0] ? mapTalk(result.rows[0]) : undefined;
  }

  async history(conferenceId: string, stageId: string): Promise<TalkRecord[]> {
    const result = await this.pool.query(
      `${selectTalk} WHERE c.slug = $1 AND s.slug = $2 ORDER BY t.created_at DESC`,
      [conferenceId, stageId],
    );
    return result.rows.map(mapTalk);
  }

  async current(stageId: string): Promise<TalkRecord | undefined> {
    const result = await this.pool.query(
      `${selectTalk} WHERE s.slug = $1
       ORDER BY CASE t.status WHEN 'live' THEN 0 WHEN 'starting' THEN 1 WHEN 'ready' THEN 2 ELSE 3 END, t.created_at DESC
       LIMIT 1`,
      [stageId],
    );
    return result.rows[0] ? mapTalk(result.rows[0]) : undefined;
  }

  async list(conferenceId?: string): Promise<TalkRecord[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT ON (stage_id) * FROM (${selectTalk}${conferenceId ? " WHERE c.slug = $1" : ""}) configured
       ORDER BY stage_id, CASE status WHEN 'live' THEN 0 WHEN 'starting' THEN 1 WHEN 'ready' THEN 2 ELSE 3 END, configured_at DESC`,
      conferenceId ? [conferenceId] : [],
    );
    return result.rows.map(mapTalk);
  }

  async configure(input: Pick<TalkRecord, "conferenceId" | "stageId" | "talkId" | "title" | "speaker" | "sourceLanguage" | "targetLanguages">): Promise<TalkRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const stage = await client.query<{ id: string }>(
        `SELECT s.id FROM stages s JOIN conferences c ON c.id = s.conference_id
         WHERE c.slug = $1 AND s.slug = $2 FOR UPDATE`,
        [input.conferenceId, input.stageId],
      );
      if (!stage.rows[0]) throw new Error(`Unknown stage ${input.stageId}`);
      const collision = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(
          SELECT 1 FROM talks t JOIN stages s ON s.id=t.stage_id
          WHERE t.slug=$1 AND s.id<>$2
        ) AS exists`,
        [input.talkId, stage.rows[0].id],
      );
      if (collision.rows[0]?.exists) throw new Error("talk_slug_in_use");
      await client.query(
        `INSERT INTO talks (id, stage_id, slug, title, speaker, source_language, enabled_targets, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ready')
         ON CONFLICT (stage_id, slug) DO UPDATE SET title=EXCLUDED.title, speaker=EXCLUDED.speaker,
           source_language=EXCLUDED.source_language, enabled_targets=EXCLUDED.enabled_targets`,
        [randomUUID(), stage.rows[0].id, input.talkId, input.title, input.speaker, input.sourceLanguage, input.targetLanguages],
      );
      await client.query("COMMIT");
      return (await this.get(input.stageId, input.talkId))!;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async transition(stageId: string, talkId: string, status: TalkRecord["status"]): Promise<void> {
    await this.pool.query(
      `UPDATE talks t SET status=$3,
         started_at=CASE WHEN $3='live' THEN COALESCE(started_at, now()) ELSE started_at END,
         ended_at=CASE WHEN $3='completed' THEN now() ELSE ended_at END
       FROM stages s WHERE t.stage_id=s.id AND s.slug=$1 AND t.slug=$2`,
      [stageId, talkId, status],
    );
  }
}
