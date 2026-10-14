CREATE TABLE workspaces(id uuid PRIMARY KEY,creator_id uuid NOT NULL,name text NOT NULL,kind text NOT NULL CHECK(kind IN ('personal','team')),idempotency_key uuid NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(creator_id,idempotency_key));
--> statement-breakpoint
CREATE UNIQUE INDEX personal_owner_idx ON workspaces(creator_id) WHERE kind='personal';
--> statement-breakpoint
CREATE TABLE memberships(workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id uuid NOT NULL,role text NOT NULL CHECK(role IN ('owner','admin','editor','reader')),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,user_id));
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_owner_idx ON memberships(workspace_id) WHERE role='owner';
--> statement-breakpoint
CREATE INDEX memberships_user_idx ON memberships(user_id);
--> statement-breakpoint
CREATE TABLE workspace_audit(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,actor_id uuid NOT NULL,action text NOT NULL,subject_id uuid,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
