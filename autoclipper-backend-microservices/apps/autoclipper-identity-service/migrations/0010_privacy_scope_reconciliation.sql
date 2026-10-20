CREATE TABLE privacy_scope_receipts(
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES privacy_requests(id) ON DELETE RESTRICT,
  scope text NOT NULL,
  owner_receipt_id uuid NOT NULL,
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,scope,owner_receipt_id)
);
--> statement-breakpoint
CREATE FUNCTION reject_privacy_scope_receipt_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'privacy scope receipt history is immutable' USING ERRCODE='23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER privacy_scope_receipt_immutable BEFORE UPDATE OR DELETE ON privacy_scope_receipts FOR EACH ROW EXECUTE FUNCTION reject_privacy_scope_receipt_change();
--> statement-breakpoint
CREATE TABLE privacy_request_scopes(
  request_id uuid NOT NULL REFERENCES privacy_requests(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK(scope IN ('identity-profile-v1','workspace-memberships-v1','project-attribution-v1','media-task-attribution-v1','analysis-attribution-v1','consumption-attribution-v1')),
  required boolean NOT NULL DEFAULT true,
  supported boolean NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','prepared','owner_unavailable','snapshot_changed','limit_exceeded','not_implemented')),
  current_receipt_id uuid REFERENCES privacy_scope_receipts(id) ON DELETE RESTRICT,
  last_error_code text CHECK(last_error_code IS NULL OR last_error_code IN ('OWNER_UNAVAILABLE','OWNER_REJECTED','INVALID_OWNER_RECEIPT','SNAPSHOT_CHANGED','SCOPE_TOO_LARGE','NOT_IMPLEMENTED')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(request_id,scope),
  CHECK((status='prepared')=(current_receipt_id IS NOT NULL)),
  CHECK(supported OR status='not_implemented')
);
--> statement-breakpoint
CREATE INDEX privacy_request_scopes_status_idx ON privacy_request_scopes(request_id,required,status);
--> statement-breakpoint
REVOKE UPDATE,DELETE,TRUNCATE ON privacy_scope_receipts FROM autoclipper_identity_runtime;
--> statement-breakpoint
INSERT INTO privacy_request_scopes(request_id,scope,required,supported,status,last_error_code)
SELECT p.id,s.scope,true,s.supported,CASE WHEN s.supported THEN 'pending' ELSE 'not_implemented' END,CASE WHEN s.supported THEN NULL ELSE 'NOT_IMPLEMENTED' END
FROM privacy_requests p CROSS JOIN (VALUES
  ('identity-profile-v1',true),
  ('workspace-memberships-v1',true),
  ('project-attribution-v1',true),
  ('media-task-attribution-v1',false),
  ('analysis-attribution-v1',false),
  ('consumption-attribution-v1',true)
) AS s(scope,supported)
WHERE p.kind='export';
