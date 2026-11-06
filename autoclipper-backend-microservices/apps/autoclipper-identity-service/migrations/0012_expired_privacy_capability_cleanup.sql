CREATE FUNCTION reap_expired_privacy_capabilities(max_rows integer DEFAULT 250) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE removed integer:=0; batch_removed integer;
BEGIN
  IF max_rows IS NULL OR max_rows<1 OR max_rows>250 THEN
    RAISE EXCEPTION 'max_rows must be between 1 and 250' USING ERRCODE='22023';
  END IF;

  WITH expired AS (
    SELECT token_hash FROM public.privacy_export_capabilities
    WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT max_rows FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.privacy_export_capabilities c USING expired e WHERE c.token_hash=e.token_hash;
  GET DIAGNOSTICS batch_removed=ROW_COUNT; removed:=removed+batch_removed;

  WITH expired AS (
    SELECT token_hash FROM public.privacy_project_export_capabilities
    WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT max_rows FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.privacy_project_export_capabilities c USING expired e WHERE c.token_hash=e.token_hash;
  GET DIAGNOSTICS batch_removed=ROW_COUNT; removed:=removed+batch_removed;

  WITH expired AS (
    SELECT token_hash FROM public.privacy_billing_export_capabilities
    WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT max_rows FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.privacy_billing_export_capabilities c USING expired e WHERE c.token_hash=e.token_hash;
  GET DIAGNOSTICS batch_removed=ROW_COUNT; removed:=removed+batch_removed;

  WITH expired AS (
    SELECT token_hash FROM public.privacy_task_export_capabilities
    WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT max_rows FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.privacy_task_export_capabilities c USING expired e WHERE c.token_hash=e.token_hash;
  GET DIAGNOSTICS batch_removed=ROW_COUNT; removed:=removed+batch_removed;

  RETURN removed;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION reap_expired_privacy_capabilities(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION reap_expired_privacy_capabilities(integer) TO autoclipper_identity_runtime;
