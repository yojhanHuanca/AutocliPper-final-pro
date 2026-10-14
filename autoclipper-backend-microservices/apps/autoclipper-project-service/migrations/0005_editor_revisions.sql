CREATE TABLE editor_drafts (
  id uuid PRIMARY KEY, upload_id uuid NOT NULL REFERENCES uploads(id),
  project_id uuid NOT NULL REFERENCES projects(id), workspace_id uuid NOT NULL,
  creator_id uuid NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 150),
  current_version integer NOT NULL DEFAULT 1 CHECK(current_version>0),
  idempotency_key uuid NOT NULL, request_hash text NOT NULL CHECK(length(request_hash)=64),
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,idempotency_key)
);
--> statement-breakpoint
CREATE INDEX editor_drafts_project_idx ON editor_drafts(project_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE TABLE editor_revisions (
  id uuid PRIMARY KEY,draft_id uuid NOT NULL REFERENCES editor_drafts(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version>0),author_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('created','updated','restored')),
  restored_from_version integer, spec jsonb NOT NULL,render_spec jsonb NOT NULL,
  correlation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(draft_id,version),
  CHECK((action='restored')=(restored_from_version IS NOT NULL)),
  FOREIGN KEY(draft_id,restored_from_version) REFERENCES editor_revisions(draft_id,version) DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
ALTER TABLE editor_drafts ADD CONSTRAINT editor_current_revision_fk FOREIGN KEY(id,current_version) REFERENCES editor_revisions(draft_id,version) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION protect_editor_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM editor_drafts WHERE id=OLD.draft_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Editor revisions are immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER editor_revision_immutable BEFORE UPDATE OR DELETE ON editor_revisions FOR EACH ROW EXECUTE FUNCTION protect_editor_revision();
--> statement-breakpoint
ALTER TABLE processing_requests ADD COLUMN editor_revision_id uuid REFERENCES editor_revisions(id);
--> statement-breakpoint
CREATE INDEX processing_editor_revision_idx ON processing_requests(editor_revision_id,created_at DESC) WHERE editor_revision_id IS NOT NULL;
