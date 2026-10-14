CREATE TABLE analysis_jobs(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,creator_id uuid NOT NULL,source jsonb NOT NULL,spec jsonb NOT NULL,request_hash text NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','transcribing','selecting','succeeded','failed','cancelled')),correlation_id uuid NOT NULL,attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),cancel_requested boolean NOT NULL DEFAULT false,provider_outcome_unknown boolean NOT NULL DEFAULT false,error_code text,started_at timestamptz,finished_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),CHECK((status IN ('succeeded','failed','cancelled'))=(finished_at IS NOT NULL)));
--> statement-breakpoint
ALTER TABLE analysis_jobs ADD COLUMN transcription_revision text NOT NULL,ADD COLUMN selection_revision text;
--> statement-breakpoint
CREATE INDEX analysis_jobs_workspace_idx ON analysis_jobs(workspace_id,created_at,id);
--> statement-breakpoint
CREATE INDEX analysis_jobs_active_idx ON analysis_jobs(status,id) WHERE status IN ('queued','transcribing','selecting');
--> statement-breakpoint
CREATE TABLE analysis_outbox(job_id uuid PRIMARY KEY REFERENCES analysis_jobs(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz);
--> statement-breakpoint
CREATE INDEX analysis_outbox_pending_idx ON analysis_outbox(created_at) WHERE delivered_at IS NULL;
--> statement-breakpoint
CREATE TABLE transcripts(id uuid PRIMARY KEY,job_id uuid UNIQUE NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,language text NOT NULL,provider text NOT NULL CHECK(provider IN ('whisper_cpp','deepgram')),model text NOT NULL,revision text NOT NULL,input_sha256 text NOT NULL,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE segment_selections(job_id uuid PRIMARY KEY REFERENCES analysis_jobs(id) ON DELETE CASCADE,model text NOT NULL,revision text NOT NULL,prompt_version text NOT NULL,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE provider_attempts(id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,provider text NOT NULL,state text NOT NULL CHECK(state IN ('started','succeeded','failed','unknown')),estimated_external_cost_usd numeric(14,8) NOT NULL DEFAULT 0 CHECK(estimated_external_cost_usd>=0),request_id text,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz);
--> statement-breakpoint
CREATE INDEX provider_attempts_job_idx ON provider_attempts(job_id,created_at);
--> statement-breakpoint
CREATE TABLE analysis_phase_attempts(id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,phase text NOT NULL CHECK(phase IN ('transcribing','selecting')),attempt integer NOT NULL CHECK(attempt>0),started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,error_code text,UNIQUE(job_id,phase,attempt));
--> statement-breakpoint
