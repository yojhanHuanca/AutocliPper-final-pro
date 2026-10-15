CREATE TABLE plan_versions (
  id uuid PRIMARY KEY,
  version text UNIQUE NOT NULL CHECK(length(version)=64),
  kind text NOT NULL CHECK(kind='development'),
  label text NOT NULL,
  processing_seconds_per_month integer NOT NULL CHECK(processing_seconds_per_month BETWEEN 1 AND 100000000),
  active_pipelines integer NOT NULL CHECK(active_pipelines BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_entitlements(workspace_id uuid PRIMARY KEY,plan_version_id uuid NOT NULL REFERENCES plan_versions(id),assigned_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE usage_periods (
  workspace_id uuid NOT NULL REFERENCES workspace_entitlements(workspace_id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL CHECK(period_end>period_start),
  plan_version_id uuid NOT NULL REFERENCES plan_versions(id),
  budget_seconds integer NOT NULL CHECK(budget_seconds>0),
  consumed_seconds integer NOT NULL DEFAULT 0 CHECK(consumed_seconds>=0),
  reserved_seconds integer NOT NULL DEFAULT 0 CHECK(reserved_seconds>=0),
  PRIMARY KEY(workspace_id,period_start),
  CHECK(consumed_seconds+reserved_seconds<=budget_seconds)
);
CREATE TABLE usage_reservations (
  pipeline_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  creator_id uuid NOT NULL,
  period_start timestamptz NOT NULL,
  request_hash text NOT NULL CHECK(length(request_hash)=64),
  budgets jsonb NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','settled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  FOREIGN KEY(workspace_id,period_start) REFERENCES usage_periods(workspace_id,period_start),
  CHECK((state='settled')=(settled_at IS NOT NULL))
);
CREATE INDEX usage_reservations_workspace_idx ON usage_reservations(workspace_id) WHERE state='open';
CREATE TABLE usage_admissions(pipeline_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,request_hash text NOT NULL CHECK(length(request_hash)=64),admitted boolean NOT NULL,code text,created_at timestamptz NOT NULL DEFAULT now(),CHECK(admitted=(code IS NULL)));
CREATE TABLE usage_inbox(event_id uuid PRIMARY KEY,pipeline_id uuid NOT NULL REFERENCES usage_reservations(pipeline_id),stage text NOT NULL CHECK(stage IN ('audio','analysis','render')),request_hash text NOT NULL CHECK(length(request_hash)=64),processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE usage_stage_settlements (
  pipeline_id uuid NOT NULL REFERENCES usage_reservations(pipeline_id),
  stage text NOT NULL CHECK(stage IN ('audio','analysis','render')),
  event_id uuid NOT NULL UNIQUE REFERENCES usage_inbox(event_id),
  request_hash text NOT NULL CHECK(length(request_hash)=64),
  outcome text NOT NULL CHECK(outcome IN ('succeeded','failed','cancelled','skipped')),
  actual_seconds integer NOT NULL CHECK(actual_seconds>=0),
  PRIMARY KEY(pipeline_id,stage),
  CHECK((outcome='succeeded')=(actual_seconds>0))
);
CREATE TABLE usage_ledger (
  id bigserial PRIMARY KEY,
  pipeline_id uuid NOT NULL REFERENCES usage_reservations(pipeline_id),
  workspace_id uuid NOT NULL,
  period_start timestamptz NOT NULL,
  stage text NOT NULL CHECK(stage IN ('audio','analysis','render')),
  kind text NOT NULL CHECK(kind IN ('reserve','consume','release')),
  seconds integer NOT NULL CHECK(seconds>=0),
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pipeline_id,stage,kind),
  FOREIGN KEY(workspace_id,period_start) REFERENCES usage_periods(workspace_id,period_start)
);
CREATE INDEX usage_ledger_workspace_idx ON usage_ledger(workspace_id,id DESC);
--> statement-breakpoint
CREATE FUNCTION reject_consumption_history_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'consumption history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER plan_version_immutable BEFORE UPDATE OR DELETE ON plan_versions FOR EACH ROW EXECUTE FUNCTION reject_consumption_history_change();
CREATE TRIGGER entitlement_immutable BEFORE UPDATE OR DELETE ON workspace_entitlements FOR EACH ROW EXECUTE FUNCTION reject_consumption_history_change();
CREATE TRIGGER usage_inbox_immutable BEFORE UPDATE OR DELETE ON usage_inbox FOR EACH ROW EXECUTE FUNCTION reject_consumption_history_change();
CREATE TRIGGER usage_settlement_immutable BEFORE UPDATE OR DELETE ON usage_stage_settlements FOR EACH ROW EXECUTE FUNCTION reject_consumption_history_change();
CREATE TRIGGER usage_ledger_immutable BEFORE UPDATE OR DELETE ON usage_ledger FOR EACH ROW EXECUTE FUNCTION reject_consumption_history_change();
CREATE TRIGGER usage_admission_immutable BEFORE UPDATE OR DELETE ON usage_admissions FOR EACH ROW EXECUTE FUNCTION reject_consumption_history_change();
