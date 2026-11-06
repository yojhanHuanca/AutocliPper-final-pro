CREATE TABLE privacy_task_export_capabilities(
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  request_id uuid NOT NULL REFERENCES privacy_requests(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  access_token_hash text NOT NULL REFERENCES access_tokens(token_hash) ON DELETE CASCADE,
  scope text NOT NULL CHECK(scope IN ('media-task-attribution-v1','analysis-attribution-v1')),
  idempotency_key uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 seconds')
);
--> statement-breakpoint
CREATE INDEX privacy_task_capability_expiration_idx ON privacy_task_export_capabilities(expires_at);
--> statement-breakpoint
REVOKE UPDATE,DELETE,TRUNCATE ON privacy_task_export_capabilities FROM autoclipper_identity_runtime;
--> statement-breakpoint
ALTER TABLE privacy_request_scopes DROP CONSTRAINT privacy_request_scopes_status_check;
--> statement-breakpoint
ALTER TABLE privacy_request_scopes ADD CONSTRAINT privacy_request_scopes_status_check CHECK(status IN ('pending','prepared','owner_unavailable','snapshot_changed','limit_exceeded','attribution_missing','not_implemented'));
--> statement-breakpoint
ALTER TABLE privacy_request_scopes DROP CONSTRAINT privacy_request_scopes_last_error_code_check;
--> statement-breakpoint
ALTER TABLE privacy_request_scopes ADD CONSTRAINT privacy_request_scopes_last_error_code_check CHECK(last_error_code IS NULL OR last_error_code IN ('OWNER_UNAVAILABLE','OWNER_REJECTED','INVALID_OWNER_RECEIPT','SNAPSHOT_CHANGED','SCOPE_TOO_LARGE','ATTRIBUTION_MISSING','NOT_IMPLEMENTED'));
--> statement-breakpoint
UPDATE privacy_request_scopes SET supported=true,status='pending',last_error_code=NULL,updated_at=now() WHERE scope IN ('media-task-attribution-v1','analysis-attribution-v1') AND status='not_implemented';
