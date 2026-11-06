CREATE TABLE source_imports (
  id uuid PRIMARY KEY,
  creator_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK(provider='twitch'),
  source_id text NOT NULL CHECK(length(source_id) BETWEEN 1 AND 128),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  upload_id uuid REFERENCES uploads(id),
  state text NOT NULL DEFAULT 'importing' CHECK(state IN ('importing','succeeded','failed')),
  error_code text CHECK(error_code IS NULL OR error_code ~ '^[A-Z_]{1,100}$'),
  lease_until timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,idempotency_key),
  UNIQUE(project_id,provider,source_id)
);
CREATE INDEX source_imports_project_created_idx ON source_imports(project_id,created_at DESC);
