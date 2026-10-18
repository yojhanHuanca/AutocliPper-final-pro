CREATE TABLE admin_grants(user_id uuid PRIMARY KEY REFERENCES users(id),permissions text[] NOT NULL CHECK(cardinality(permissions) BETWEEN 1 AND 4 AND permissions <@ ARRAY['users.read','workspaces.read','jobs.read','consumption.read']::text[] AND array_position(permissions,NULL) IS NULL),workspace_ids uuid[],revision integer NOT NULL DEFAULT 1 CHECK(revision>0),revoked_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),CHECK(workspace_ids IS NULL OR (cardinality(workspace_ids) BETWEEN 1 AND 50 AND array_position(workspace_ids,NULL) IS NULL AND NOT ('users.read'=ANY(permissions)))));
--> statement-breakpoint
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON admin_grants FROM autoclipper_identity_runtime;
--> statement-breakpoint
CREATE TABLE admin_elevations(session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,grant_revision integer NOT NULL CHECK(grant_revision>0),expires_at timestamptz NOT NULL);
--> statement-breakpoint
CREATE TABLE admin_access_audit(id uuid PRIMARY KEY,actor_user_id uuid,subject_user_id uuid,permission text CHECK(permission IN ('users.read','workspaces.read','jobs.read','consumption.read')),workspace_id uuid,outcome text NOT NULL CHECK(outcome IN ('allowed','denied','reauthenticated','reauth_denied','grant','revoke')),correlation_id uuid NOT NULL,operator_reference text CHECK(operator_reference ~ '^[A-Za-z0-9_-]{1,64}$'),created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX admin_access_audit_actor_idx ON admin_access_audit(actor_user_id,created_at,id);
--> statement-breakpoint
CREATE FUNCTION immutable_admin_access_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Administrative access audit is immutable' USING ERRCODE='23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER admin_access_audit_immutable BEFORE UPDATE OR DELETE ON admin_access_audit FOR EACH ROW EXECUTE FUNCTION immutable_admin_access_audit();
--> statement-breakpoint
REVOKE UPDATE,DELETE,TRUNCATE ON admin_access_audit FROM autoclipper_identity_runtime;
