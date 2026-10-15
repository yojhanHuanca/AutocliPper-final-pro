ALTER TABLE processing_tasks ADD COLUMN secondary_inspection_id uuid REFERENCES inspection_tasks(id);
--> statement-breakpoint
ALTER TABLE processing_tasks ADD CONSTRAINT secondary_inspection_matches_spec CHECK(secondary_inspection_id IS NOT DISTINCT FROM (spec->'splitScreen'->>'secondaryUploadId')::uuid);
