import type pg from "pg";

export const FAILED_SOURCE_IMPORT_RETENTION_DAYS = 30;
export const FAILED_SOURCE_IMPORT_CLEANUP_INTERVAL_MS = 60_000;
export const FAILED_SOURCE_IMPORT_CLEANUP_BATCH_SIZE = 50;

export const FAILED_SOURCE_IMPORT_CLEANUP_SQL = `
WITH expired AS (
  SELECT source_imports.id
  FROM source_imports
  WHERE source_imports.state = 'failed'
    AND source_imports.updated_at <= now() - interval '${FAILED_SOURCE_IMPORT_RETENTION_DAYS} days'
    AND source_imports.external_effect_started_at IS NULL
    AND source_imports.provider_resource_id IS NULL
    AND EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = source_imports.project_id
        AND projects.workspace_id = source_imports.workspace_id
    )
    AND (
      source_imports.upload_id IS NULL
      OR EXISTS (
        SELECT 1 FROM uploads
        WHERE uploads.id = source_imports.upload_id
          AND uploads.creator_id = source_imports.creator_id
          AND uploads.project_id = source_imports.project_id
          AND uploads.workspace_id = source_imports.workspace_id
          AND uploads.state = 'aborted'
          AND uploads.cleaned_at IS NOT NULL
      )
    )
  ORDER BY source_imports.updated_at, source_imports.id
  LIMIT ${FAILED_SOURCE_IMPORT_CLEANUP_BATCH_SIZE}
  FOR UPDATE OF source_imports SKIP LOCKED
)
DELETE FROM source_imports
USING expired
WHERE source_imports.id = expired.id
RETURNING source_imports.id`;

export async function cleanupExpiredFailedSourceImports(pool: Pick<pg.Pool, "query">) {
  return pool.query(FAILED_SOURCE_IMPORT_CLEANUP_SQL);
}
