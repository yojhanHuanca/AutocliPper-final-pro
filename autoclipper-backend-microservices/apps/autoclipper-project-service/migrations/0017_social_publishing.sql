CREATE TABLE social_connections (
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('youtube','tiktok')),
  token_cipher text NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,provider)
);
--> statement-breakpoint
CREATE TABLE social_oauth_states (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('youtube','tiktok')),
  verifier_cipher text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
--> statement-breakpoint
CREATE TABLE social_publications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('youtube','tiktok')),
  processing_id uuid NOT NULL REFERENCES processing_requests(id),
  upload_id uuid NOT NULL REFERENCES uploads(id),
  workspace_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  spec jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','uploading','processing','published','inbox','failed','unknown')),
  remote_id text,
  remote_url text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,idempotency_key)
);
--> statement-breakpoint
CREATE INDEX social_publications_pending_idx ON social_publications(updated_at) WHERE state IN ('queued','uploading','processing');
