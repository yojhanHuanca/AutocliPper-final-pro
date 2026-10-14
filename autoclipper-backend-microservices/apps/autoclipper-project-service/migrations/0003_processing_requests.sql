CREATE TABLE processing_requests(id uuid PRIMARY KEY,upload_id uuid NOT NULL REFERENCES uploads(id),project_id uuid NOT NULL REFERENCES projects(id),workspace_id uuid NOT NULL,creator_id uuid NOT NULL,idempotency_key uuid NOT NULL,request_hash text NOT NULL,spec jsonb NOT NULL,reservation_bytes integer NOT NULL CHECK(reservation_bytes>0),status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled')),attempts integer NOT NULL DEFAULT 0,error_code text,started_at timestamptz,finished_at timestamptz,result jsonb,cleanup_pending boolean NOT NULL DEFAULT false,cancel_requested boolean NOT NULL DEFAULT false,cancel_delivered_at timestamptz,delivered_at timestamptz,settled_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(creator_id,idempotency_key),CHECK((status='succeeded')=(result IS NOT NULL)),CHECK((status IN ('succeeded','failed','cancelled'))=(finished_at IS NOT NULL)));
--> statement-breakpoint
ALTER TABLE processing_requests ADD COLUMN correlation_id uuid NOT NULL;
--> statement-breakpoint
CREATE INDEX processing_requests_project_idx ON processing_requests(project_id,created_at,id);
--> statement-breakpoint
CREATE INDEX processing_requests_active_idx ON processing_requests(workspace_id,status) WHERE settled_at IS NULL;
--> statement-breakpoint
CREATE INDEX processing_requests_outbox_idx ON processing_requests(created_at) WHERE delivered_at IS NULL;
--> statement-breakpoint
