CREATE FUNCTION enforce_workspace_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workspace_uuid uuid;
BEGIN
  IF TG_TABLE_NAME='workspaces' THEN
    IF TG_OP='DELETE' THEN workspace_uuid:=OLD.id; ELSE workspace_uuid:=NEW.id; END IF;
  ELSE
    IF TG_OP='DELETE' THEN workspace_uuid:=OLD.workspace_id; ELSE workspace_uuid:=NEW.workspace_id; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM workspaces WHERE id=workspace_uuid) AND (SELECT count(*) FROM memberships WHERE workspace_id=workspace_uuid AND role='owner')<>1 THEN
    RAISE EXCEPTION 'WORKSPACE_OWNER_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER workspace_owner_membership AFTER INSERT OR UPDATE OR DELETE ON memberships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_workspace_owner();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER workspace_owner_creation AFTER INSERT ON workspaces DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_workspace_owner();
