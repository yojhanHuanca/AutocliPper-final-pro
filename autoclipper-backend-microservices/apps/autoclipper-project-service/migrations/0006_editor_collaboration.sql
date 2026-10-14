ALTER TABLE editor_drafts ADD COLUMN review_status text NOT NULL DEFAULT 'draft' CHECK(review_status IN ('draft','review','approved')),
  ADD COLUMN review_version integer NOT NULL DEFAULT 1 CHECK(review_version>0),
  ADD COLUMN approved_revision_version integer,
  ADD CONSTRAINT approved_revision_fk FOREIGN KEY(id,approved_revision_version) REFERENCES editor_revisions(draft_id,version),
  ADD CONSTRAINT approved_revision_current CHECK(approved_revision_version IS NULL OR approved_revision_version=current_version),
  ADD CONSTRAINT approval_state_consistent CHECK((review_status='approved')=(approved_revision_version IS NOT NULL));
--> statement-breakpoint
CREATE TABLE editor_comments (
  id uuid PRIMARY KEY,sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  draft_id uuid NOT NULL REFERENCES editor_drafts(id) ON DELETE CASCADE,revision_version integer NOT NULL,
  author_id uuid NOT NULL,time_seconds double precision NOT NULL CHECK(time_seconds>=0 AND time_seconds<=120),
  text text NOT NULL CHECK(length(text) BETWEEN 1 AND 2000),version integer NOT NULL DEFAULT 1 CHECK(version>0),
  idempotency_key uuid NOT NULL,request_hash text NOT NULL CHECK(length(request_hash)=64),
  created_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,
  FOREIGN KEY(draft_id,revision_version) REFERENCES editor_revisions(draft_id,version),UNIQUE(author_id,idempotency_key)
);
--> statement-breakpoint
CREATE INDEX editor_comments_revision_idx ON editor_comments(draft_id,revision_version,sequence DESC);
--> statement-breakpoint
CREATE TABLE editor_approvals (
  id uuid PRIMARY KEY,draft_id uuid NOT NULL REFERENCES editor_drafts(id) ON DELETE CASCADE,revision_version integer NOT NULL,
  approver_id uuid NOT NULL,review_version integer NOT NULL CHECK(review_version>0),correlation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(draft_id,revision_version) REFERENCES editor_revisions(draft_id,version),UNIQUE(draft_id,revision_version,review_version,approver_id)
);
--> statement-breakpoint
CREATE TRIGGER editor_approval_immutable BEFORE UPDATE OR DELETE ON editor_approvals FOR EACH ROW EXECUTE FUNCTION protect_editor_revision();
--> statement-breakpoint
CREATE TABLE editor_review_links (
  id uuid PRIMARY KEY,draft_id uuid NOT NULL REFERENCES editor_drafts(id) ON DELETE CASCADE,revision_version integer NOT NULL,
  creator_id uuid NOT NULL,token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64),
  processing_id uuid REFERENCES processing_requests(id),created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,revoked_at timestamptz,
  FOREIGN KEY(draft_id,revision_version) REFERENCES editor_revisions(draft_id,version),
  CHECK(expires_at<=created_at+interval '7 days')
);
--> statement-breakpoint
CREATE INDEX editor_review_links_draft_idx ON editor_review_links(draft_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE TABLE editor_audit (
  id uuid PRIMARY KEY,sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  draft_id uuid NOT NULL REFERENCES editor_drafts(id) ON DELETE CASCADE,actor_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('revision.created','revision.updated','revision.restored','comment.created','comment.deleted','review.requested','review.returned','review.approved','link.created','link.revoked')),
  details jsonb NOT NULL,correlation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX editor_audit_draft_idx ON editor_audit(draft_id,sequence DESC);
--> statement-breakpoint
GRANT USAGE ON SEQUENCE editor_comments_sequence_seq,editor_audit_sequence_seq TO autoclipper_project_runtime;
--> statement-breakpoint
CREATE TRIGGER editor_audit_immutable BEFORE UPDATE OR DELETE ON editor_audit FOR EACH ROW EXECUTE FUNCTION protect_editor_revision();
--> statement-breakpoint
CREATE FUNCTION reset_editor_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_version<>OLD.current_version THEN
    NEW.review_status='draft';NEW.review_version=OLD.review_version+1;NEW.approved_revision_version=NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER editor_review_reset BEFORE UPDATE OF current_version ON editor_drafts FOR EACH ROW EXECUTE FUNCTION reset_editor_review();
--> statement-breakpoint
CREATE FUNCTION audit_editor_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO editor_audit(id,draft_id,actor_id,action,details,correlation_id)
    VALUES(gen_random_uuid(),NEW.draft_id,NEW.author_id,'revision.'||NEW.action,jsonb_build_object('revisionVersion',NEW.version,'restoredFromVersion',NEW.restored_from_version),NEW.correlation_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER editor_revision_audit AFTER INSERT ON editor_revisions FOR EACH ROW EXECUTE FUNCTION audit_editor_revision();
