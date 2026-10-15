ALTER TABLE editor_revisions ADD COLUMN secondary_upload_id uuid REFERENCES uploads(id);
--> statement-breakpoint
ALTER TABLE editor_revisions ADD CONSTRAINT revision_secondary_matches_spec CHECK(secondary_upload_id IS NOT DISTINCT FROM (render_spec->'splitScreen'->>'secondaryUploadId')::uuid AND secondary_upload_id IS NOT DISTINCT FROM (spec->'splitScreen'->>'secondaryUploadId')::uuid);
--> statement-breakpoint
ALTER TABLE processing_requests ADD COLUMN secondary_upload_id uuid REFERENCES uploads(id);
--> statement-breakpoint
ALTER TABLE processing_requests ADD CONSTRAINT request_secondary_matches_spec CHECK(secondary_upload_id IS NOT DISTINCT FROM (spec->'splitScreen'->>'secondaryUploadId')::uuid);
