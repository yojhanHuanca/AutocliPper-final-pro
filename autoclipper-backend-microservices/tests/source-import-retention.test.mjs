import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  cleanupExpiredFailedSourceImports,
  FAILED_SOURCE_IMPORT_CLEANUP_BATCH_SIZE,
  FAILED_SOURCE_IMPORT_CLEANUP_INTERVAL_MS,
  FAILED_SOURCE_IMPORT_CLEANUP_SQL,
  FAILED_SOURCE_IMPORT_RETENTION_DAYS,
} from '../apps/autoclipper-project-service/dist/application/source-import-retention.js';
import { ProjectService } from '../apps/autoclipper-project-service/dist/application/project.service.js';

test('failed source import cleanup is aged, bounded, locked, and metadata-only', async () => {
  let captured;
  const result = await cleanupExpiredFailedSourceImports({
    query: async sql => { captured = sql; return { rows: [{ id: 'expired-import' }], rowCount: 1 }; },
  });
  assert.equal(captured, FAILED_SOURCE_IMPORT_CLEANUP_SQL);
  assert.equal(result.rowCount, 1);
  assert.match(captured, /state = 'failed'/u);
  assert.match(captured, /external_effect_started_at IS NULL[\s\S]*provider_resource_id IS NULL/u, 'failed VOD imports with known or uncertain remote clip creation stay deduplicated');
  assert.match(captured, new RegExp(`updated_at <= now\\(\\) - interval '${FAILED_SOURCE_IMPORT_RETENTION_DAYS} days'`));
  assert.match(captured, /projects\.id = source_imports\.project_id[\s\S]*projects\.workspace_id = source_imports\.workspace_id/u);
  assert.doesNotMatch(captured, /\bworkspaces\b/iu, 'Project cannot verify the Workspace service database row from its local cleanup query');
  assert.match(captured, /upload_id IS NULL[\s\S]*OR EXISTS[\s\S]*uploads\.creator_id = source_imports\.creator_id[\s\S]*uploads\.project_id = source_imports\.project_id[\s\S]*uploads\.workspace_id = source_imports\.workspace_id[\s\S]*uploads\.state = 'aborted'[\s\S]*uploads\.cleaned_at IS NOT NULL/u);
  assert.doesNotMatch(captured, /projects\.creator_id\s*=\s*source_imports\.creator_id/u, 'a collaborator may import into a shared project');
  assert.match(captured, new RegExp(`LIMIT ${FAILED_SOURCE_IMPORT_CLEANUP_BATCH_SIZE}`));
  assert.match(captured, /FOR UPDATE OF source_imports SKIP LOCKED/u);
  assert.match(captured, /DELETE FROM source_imports/u);
  assert.match(captured, /ORDER BY source_imports\.updated_at, source_imports\.id\s+LIMIT 50\s+FOR UPDATE OF source_imports SKIP LOCKED/u, 'PostgreSQL requires the batch limit before the row-locking clause');
  assert.doesNotMatch(captured, /DELETE\s+FROM\s+(?:uploads|projects|workspaces|twitch_links|workspace_storage)/iu);
});

test('project service throttles cleanup attempts per process', async () => {
  const service = Object.create(ProjectService.prototype);
  let calls = 0;
  service.pool = { query: async () => { calls += 1; return { rows: [] }; } };
  service.nextFailedSourceImportCleanupAt = 0;
  await service.cleanupFailedSourceImports();
  await service.cleanupFailedSourceImports();
  assert.equal(calls, 1);
  assert.equal(FAILED_SOURCE_IMPORT_CLEANUP_INTERVAL_MS, 60_000);
  service.nextFailedSourceImportCleanupAt = Date.now() - 1;
  await service.cleanupFailedSourceImports();
  assert.equal(calls, 2);
});

test('retention index and privacy inventory keep global and shared-content deletion out of scope', async () => {
  const migration = await readFile(new URL('../apps/autoclipper-project-service/migrations/0014_failed_source_import_retention.sql', import.meta.url), 'utf8');
  const projectBaseMigration = await readFile(new URL('../apps/autoclipper-project-service/migrations/0000_project.sql', import.meta.url), 'utf8');
  const projectImportMigration = await readFile(new URL('../apps/autoclipper-project-service/migrations/0012_twitch_source_imports.sql', import.meta.url), 'utf8');
  const vodImportMigration = await readFile(new URL('../apps/autoclipper-project-service/migrations/0015_twitch_vod_clip_import_state.sql', import.meta.url), 'utf8');
  const identityTwitchMigration = await readFile(new URL('../apps/autoclipper-identity-service/migrations/0013_twitch_oauth_links.sql', import.meta.url), 'utf8');
  const projectService = await readFile(new URL('../apps/autoclipper-project-service/src/application/project.service.ts', import.meta.url), 'utf8');
  const identityService = await readFile(new URL('../apps/autoclipper-identity-service/src/application/identity.service.ts', import.meta.url), 'utf8');
  assert.match(migration, /ON source_imports\s*\(updated_at,id\)\s*WHERE state='failed'/u);
  assert.match(projectImportMigration, /project_id uuid NOT NULL REFERENCES projects\(id\) ON DELETE CASCADE/u);
  assert.match(vodImportMigration, /provider_resource_id text/u);
  assert.match(vodImportMigration, /external_effect_started_at timestamptz/u);
  assert.match(projectBaseMigration, /project_id uuid NOT NULL REFERENCES projects\(id\)/u, 'uploads require coordinated deletion before a project row can be hard-deleted');
  assert.match(identityTwitchMigration, /user_id uuid PRIMARY KEY REFERENCES users\(id\) ON DELETE CASCADE/u);
  assert.match(projectService, /UPDATE projects SET deleted_at=now\(\),version=version\+1 WHERE id=\$1/u);
  assert.doesNotMatch(projectService, /DELETE FROM projects/u);
  assert.match(identityService, /DELETE FROM twitch_links WHERE user_id=\$1/u);
  assert.doesNotMatch(identityService, /DELETE FROM source_imports|DELETE FROM uploads|DELETE FROM objects/u);
  const catalog = JSON.parse(await readFile(new URL('../privacy/data-map.json', import.meta.url), 'utf8'));
  assert.equal(catalog.retentionPolicy, 'undecided');
  assert.equal(catalog.deletionExecutor, 'not-implemented');
  const identity = catalog.services.find(service => service.application === 'autoclipper-identity-service');
  const twitch = identity.groups.find(group => group.tables.includes('twitch_links'));
  assert.match(twitch.blocker, /pending request/u);
  assert.match(twitch.blocker, /does not purge project imports or media/u);
  const project = catalog.services.find(service => service.application === 'autoclipper-project-service');
  const imports = project.groups.find(group => group.tables.includes('source_imports'));
  assert.match(imports.projection, /30 days/u);
  assert.match(imports.projection, /aborted and storage cleanup is confirmed/u);
  assert.match(imports.projection, /upload creator\/project\/workspace matching the import/u);
  assert.match(imports.projection, /creator need not equal the shared project's creator/u);
  assert.match(imports.projection, /known or uncertain Twitch clip-creation side effect are retained/u);
  assert.match(imports.projection, /cannot confirm that a matching workspace row still exists in the separate Workspace database/u);
  assert.match(imports.blocker, /workspace table is in another database and is not checked by this metadata cleanup/u);
  assert.match(imports.blocker, /only sets deleted_at/u);
  assert.match(imports.blocker, /uploads reference projects without cascade/u);
  assert.match(imports.blocker, /No global purge is implemented/u);
});
