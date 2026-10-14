CREATE TABLE projects(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,creator_id uuid NOT NULL,name text NOT NULL,version integer NOT NULL DEFAULT 1 CHECK(version>0),idempotency_key uuid NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,UNIQUE(creator_id,idempotency_key));
--> statement-breakpoint
CREATE INDEX project_workspace_idx ON projects(workspace_id,created_at,id);
--> statement-breakpoint
CREATE TABLE workspace_storage(workspace_id uuid PRIMARY KEY,used_bytes bigint NOT NULL DEFAULT 0 CHECK(used_bytes>=0),reserved_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0));
--> statement-breakpoint
CREATE TABLE uploads(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,project_id uuid NOT NULL REFERENCES projects(id),creator_id uuid NOT NULL,idempotency_key uuid NOT NULL,request_hash text NOT NULL,object_key text UNIQUE NOT NULL,expected_bytes integer NOT NULL CHECK(expected_bytes>0),sha256 text NOT NULL,content_type text NOT NULL,mode text NOT NULL CHECK(mode IN ('put','multipart')),upload_id text,state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','confirmed','aborted')),etag text,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '2 hours',cleaned_at timestamptz,UNIQUE(creator_id,idempotency_key));
--> statement-breakpoint
CREATE INDEX uploads_project_idx ON uploads(project_id,created_at);
--> statement-breakpoint
CREATE TABLE inspection_requests(upload_id uuid PRIMARY KEY REFERENCES uploads(id) ON DELETE CASCADE,correlation_id uuid NOT NULL,delivered_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE INDEX inspection_requests_pending_idx ON inspection_requests(created_at) WHERE delivered_at IS NULL;
--> statement-breakpoint
