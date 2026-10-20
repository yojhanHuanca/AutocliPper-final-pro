ALTER TABLE analysis_jobs ADD COLUMN cleanup_pending boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX analysis_jobs_cleanup_pending_idx ON analysis_jobs(finished_at,id) WHERE cleanup_pending=true;
