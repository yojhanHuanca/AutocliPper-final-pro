CREATE TABLE analysis_requests (
  id uuid PRIMARY KEY,
  audio_processing_id uuid NOT NULL REFERENCES processing_requests(id),
  upload_id uuid NOT NULL REFERENCES uploads(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  workspace_id uuid NOT NULL,
  creator_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  source jsonb NOT NULL,
  spec jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  delivered_at timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  cancel_delivered_at timestamptz,
  cached_status jsonb,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,idempotency_key),
  CHECK (length(request_hash)=64),
  CHECK (finished_at IS NULL OR cached_status->>'status' IN ('succeeded','failed','cancelled'))
);
CREATE INDEX analysis_requests_pending_idx ON analysis_requests(created_at) WHERE delivered_at IS NULL;
CREATE INDEX analysis_requests_active_idx ON analysis_requests(id) WHERE finished_at IS NULL;
CREATE INDEX analysis_requests_workspace_idx ON analysis_requests(workspace_id,created_at DESC);
