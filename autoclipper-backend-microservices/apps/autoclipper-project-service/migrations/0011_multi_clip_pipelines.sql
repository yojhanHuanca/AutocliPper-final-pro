ALTER TABLE pipelines DROP CONSTRAINT pipelines_status_check;
ALTER TABLE pipelines ADD CONSTRAINT pipelines_status_check CHECK(status IN ('queued','audio','analysis','render','stopping','succeeded','partial_failed','failed','cancelled'));
DO $$
DECLARE terminal_check record;
BEGIN
  FOR terminal_check IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid='pipelines'::regclass
      AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%finished_at%'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE pipelines DROP CONSTRAINT %I',terminal_check.conname);
  END LOOP;
END $$;
ALTER TABLE pipelines ADD CONSTRAINT pipelines_terminal_state_check CHECK((status IN ('succeeded','partial_failed','failed','cancelled'))=(finished_at IS NOT NULL));
ALTER TABLE pipelines DROP CONSTRAINT pipelines_version_check;
ALTER TABLE pipelines ADD CONSTRAINT pipelines_version_check CHECK(version BETWEEN 1 AND 20);
ALTER TABLE pipelines DROP CONSTRAINT pipelines_remaining_reservation_bytes_check;
ALTER TABLE pipelines ADD CONSTRAINT pipelines_remaining_reservation_bytes_check CHECK(remaining_reservation_bytes IN (0,68157440,202375168,270532608,338690048));
ALTER TABLE pipeline_events DROP CONSTRAINT pipeline_events_status_check;
ALTER TABLE pipeline_events ADD CONSTRAINT pipeline_events_status_check CHECK(status IN ('queued','audio','analysis','render','stopping','succeeded','partial_failed','failed','cancelled'));
ALTER TABLE pipeline_events DROP CONSTRAINT pipeline_events_version_check;
ALTER TABLE pipeline_events ADD CONSTRAINT pipeline_events_version_check CHECK(version BETWEEN 1 AND 20);
ALTER TABLE processing_requests ADD COLUMN pipeline_clip_index smallint;
ALTER TABLE processing_requests ADD CONSTRAINT processing_pipeline_clip_index_check CHECK(pipeline_clip_index IS NULL OR pipeline_clip_index BETWEEN 0 AND 2);
DROP INDEX processing_requests_pipeline_stage_idx;
CREATE UNIQUE INDEX processing_requests_pipeline_stage_idx ON processing_requests(pipeline_id,(spec->>'kind'),COALESCE(pipeline_clip_index,(-1)::smallint)) WHERE pipeline_id IS NOT NULL;
