CREATE TABLE privacy_export_receipts(
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  user_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  scope text NOT NULL CHECK(scope='project-attribution-v1'),
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,idempotency_key)
);
--> statement-breakpoint
CREATE TABLE privacy_export_audit(
  id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES privacy_export_receipts(id),
  actor_user_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('prepared','replayed','snapshot_changed')),
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX privacy_export_audit_receipt_idx ON privacy_export_audit(receipt_id,created_at);
--> statement-breakpoint
CREATE FUNCTION reject_privacy_export_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'privacy export history is immutable' USING ERRCODE='23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER privacy_export_receipt_immutable BEFORE UPDATE OR DELETE ON privacy_export_receipts FOR EACH ROW EXECUTE FUNCTION reject_privacy_export_history_change();
--> statement-breakpoint
CREATE TRIGGER privacy_export_audit_immutable BEFORE UPDATE OR DELETE ON privacy_export_audit FOR EACH ROW EXECUTE FUNCTION reject_privacy_export_history_change();
--> statement-breakpoint
REVOKE UPDATE,DELETE,TRUNCATE ON privacy_export_receipts,privacy_export_audit FROM autoclipper_project_runtime;
