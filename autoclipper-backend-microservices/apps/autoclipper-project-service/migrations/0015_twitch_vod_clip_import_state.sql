ALTER TABLE source_imports
  ADD COLUMN provider_resource_id text
    CHECK (provider_resource_id IS NULL OR provider_resource_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  ADD COLUMN external_effect_started_at timestamptz;
