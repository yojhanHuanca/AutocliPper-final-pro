CREATE TABLE security_audit(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id) ON DELETE SET NULL,action text NOT NULL,correlation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX security_audit_user_created_idx ON security_audit(user_id,created_at,id);
