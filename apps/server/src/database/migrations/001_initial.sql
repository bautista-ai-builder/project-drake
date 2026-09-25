CREATE TABLE IF NOT EXISTS conferences (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stages (
  id uuid PRIMARY KEY,
  conference_id uuid NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conference_id, slug)
);
CREATE INDEX IF NOT EXISTS stages_conference_id_idx ON stages(conference_id);

CREATE TABLE IF NOT EXISTS talks (
  id uuid PRIMARY KEY,
  stage_id uuid NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  speaker text NOT NULL,
  source_language text NOT NULL,
  enabled_targets text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('ready', 'starting', 'live', 'finalizing', 'completed', 'error')),
  started_at timestamptz,
  ended_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage_id, slug)
);
CREATE INDEX IF NOT EXISTS talks_stage_status_idx ON talks(stage_id, status);
CREATE INDEX IF NOT EXISTS talks_started_at_idx ON talks(started_at);
CREATE UNIQUE INDEX IF NOT EXISTS talks_one_live_per_stage_idx ON talks(stage_id) WHERE status = 'live';

CREATE TABLE IF NOT EXISTS caption_events (
  message_id text PRIMARY KEY,
  conference_id text NOT NULL,
  stage_id text NOT NULL,
  talk_id text NOT NULL,
  sequence bigint NOT NULL,
  kind text NOT NULL,
  segment_id text,
  revision integer,
  source_segment_id text,
  source_language text,
  target_language text,
  text text,
  audio_start_sample bigint,
  audio_end_sample bigint,
  sample_rate integer,
  completeness text,
  stream_epoch integer NOT NULL,
  provider_epoch integer,
  provider text,
  model text,
  latency_ms double precision,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (talk_id, sequence)
);
CREATE UNIQUE INDEX IF NOT EXISTS caption_events_logical_idempotency_idx
  ON caption_events(talk_id, kind, COALESCE(segment_id, ''), COALESCE(target_language, ''), COALESCE(revision, 0));
CREATE INDEX IF NOT EXISTS caption_events_talk_sequence_idx ON caption_events(talk_id, sequence);
CREATE INDEX IF NOT EXISTS caption_events_talk_kind_audio_idx ON caption_events(talk_id, kind, audio_start_sample);
CREATE INDEX IF NOT EXISTS caption_events_stage_created_idx ON caption_events(stage_id, created_at);
