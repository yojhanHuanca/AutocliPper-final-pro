CREATE TABLE privacy_export_capabilities(
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  request_id uuid NOT NULL REFERENCES privacy_requests(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  access_token_hash text NOT NULL REFERENCES access_tokens(token_hash) ON DELETE CASCADE,
  scope text NOT NULL CHECK(scope='workspace-memberships-v1'),
  idempotency_key uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 seconds')
);
--> statement-breakpoint
CREATE INDEX privacy_capability_expiration_idx ON privacy_export_capabilities(expires_at);
--> statement-breakpoint
REVOKE UPDATE,DELETE,TRUNCATE ON privacy_export_capabilities FROM autoclipper_identity_runtime;
