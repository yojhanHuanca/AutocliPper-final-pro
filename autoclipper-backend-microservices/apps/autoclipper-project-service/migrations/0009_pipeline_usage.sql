ALTER TABLE pipelines ADD COLUMN usage_state text NOT NULL DEFAULT 'legacy' CHECK(usage_state IN ('legacy','pending','accepted','rejected'));
ALTER TABLE pipelines ALTER COLUMN usage_state SET DEFAULT 'pending';
ALTER TABLE pipelines ADD COLUMN usage_spec jsonb;
ALTER TABLE pipelines ADD COLUMN usage_error text;
ALTER TABLE pipelines ADD CONSTRAINT pipeline_usage_spec_check CHECK((usage_state='legacy')=(usage_spec IS NULL));
CREATE TABLE pipeline_usage_outbox(
  id uuid PRIMARY KEY,
  pipeline_id uuid NOT NULL REFERENCES pipelines(id),
  stage text NOT NULL CHECK(stage IN ('audio','analysis','render')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE(pipeline_id,stage),
  CHECK(payload->>'eventId'=id::text AND payload->>'pipelineId'=pipeline_id::text AND payload->>'stage'=stage)
);
CREATE INDEX pipeline_usage_outbox_pending_idx ON pipeline_usage_outbox(created_at) WHERE delivered_at IS NULL;
--> statement-breakpoint
CREATE FUNCTION protect_pipeline_usage_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.pipeline_id<>OLD.pipeline_id OR NEW.stage<>OLD.stage OR NEW.payload<>OLD.payload THEN RAISE EXCEPTION 'usage event is immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER pipeline_usage_outbox_immutable BEFORE UPDATE OR DELETE ON pipeline_usage_outbox FOR EACH ROW EXECUTE FUNCTION protect_pipeline_usage_outbox();
