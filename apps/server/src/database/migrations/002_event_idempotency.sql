DROP INDEX IF EXISTS caption_events_logical_idempotency_idx;

CREATE UNIQUE INDEX caption_events_caption_idempotency_idx
  ON caption_events(talk_id, kind, segment_id, COALESCE(target_language, ''), revision)
  WHERE kind IN ('transcript.final', 'translation.final');
