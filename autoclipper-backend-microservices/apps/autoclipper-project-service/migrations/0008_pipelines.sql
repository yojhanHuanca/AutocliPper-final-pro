CREATE TABLE pipelines (
  id uuid PRIMARY KEY,
  upload_id uuid NOT NULL REFERENCES uploads(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  workspace_id uuid NOT NULL,
  creator_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK(length(request_hash)=64),
  spec jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','audio','analysis','render','stopping','succeeded','failed','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 8),
  remaining_reservation_bytes integer NOT NULL DEFAULT 202375168 CHECK(remaining_reservation_bytes IN (0,68157440,202375168)),
  cancel_requested boolean NOT NULL DEFAULT false,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
  finished_at timestamptz,
  UNIQUE(creator_id,idempotency_key),
  CHECK((status IN ('succeeded','failed','cancelled'))=(finished_at IS NOT NULL)),
  CHECK(finished_at IS NULL OR remaining_reservation_bytes=0)
);
CREATE INDEX pipelines_active_idx ON pipelines(id) WHERE finished_at IS NULL;
CREATE INDEX pipelines_workspace_idx ON pipelines(workspace_id) WHERE finished_at IS NULL;
--> statement-breakpoint
ALTER TABLE processing_requests ADD COLUMN pipeline_id uuid REFERENCES pipelines(id);
CREATE UNIQUE INDEX processing_requests_pipeline_stage_idx ON processing_requests(pipeline_id,(spec->>'kind')) WHERE pipeline_id IS NOT NULL;
ALTER TABLE analysis_requests ADD COLUMN pipeline_id uuid UNIQUE REFERENCES pipelines(id);
--> statement-breakpoint
CREATE TABLE pipeline_events (
  pipeline_id uuid NOT NULL REFERENCES pipelines(id),
  version integer NOT NULL CHECK(version BETWEEN 1 AND 8),
  status text NOT NULL CHECK(status IN ('queued','audio','analysis','render','stopping','succeeded','failed','cancelled')),
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(pipeline_id,version)
);
CREATE FUNCTION reject_pipeline_event_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'pipeline events are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER pipeline_event_immutable BEFORE UPDATE OR DELETE ON pipeline_events FOR EACH ROW EXECUTE FUNCTION reject_pipeline_event_change();
