import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cookieName } from '@autoclipper/http-security';
import { ProjectService } from '../apps/autoclipper-project-service/dist/application/project.service.js';

const projectId = 'bfc2f594-3148-47b0-bb3a-509814b36904';
const ownerId = 'ea8c8bf6-6029-478e-9208-7d08a2615c75';
const collaboratorId = '88a68d7b-e817-484d-bfe8-a5808e6ed657';
const config = { CORS_ORIGIN: 'http://localhost:4200', CSRF_SIGNING_KEY: 'fixture-signing-key' };

function requestWithCsrf() {
  const payload = `${Date.now()}.project-trash-fixture`;
  const token = `${payload}.${createHmac('sha256', config.CSRF_SIGNING_KEY).update(payload).digest('base64url')}`;
  return { headers: { origin: config.CORS_ORIGIN, cookie: `autoclipper_csrf=${token}; ${cookieName('access')}=fixture-access-token`, 'x-csrf-token': token } };
}

test('project trash replays as success without repeating the tombstone update or deleting shared rows/media', async () => {
  const events = [];
  const service = Object.create(ProjectService.prototype);
  service.config = { ...config, IDENTITY_URL: 'http://identity.fixture', WORKSPACE_URL: 'http://workspace.fixture', INTERNAL_TOKEN: 'fixture-internal-token' };
  let deletedAt = null;
  let version = 1;
  service.pool = { query: async (sql, values) => {
    events.push({ kind: 'query', sql, values });
    if (sql === 'SELECT * FROM projects WHERE id=$1') return { rows: [{ id: projectId, workspace_id: 'fixture-workspace', creator_id: ownerId, name: 'Fixture shared project', version, deleted_at: deletedAt, request_hash: 'fixture' }] };
    if (sql.startsWith('UPDATE projects SET deleted_at=now()')) {
      if (deletedAt) return { rows: [] };
      deletedAt = new Date();
      version += 1;
      return { rows: [{ id: projectId }] };
    }
    if (sql.startsWith('SELECT id FROM projects WHERE id=$1 AND deleted_at IS NOT NULL')) return { rows: deletedAt ? [{ id: projectId }] : [] };
    throw new Error(`Unexpected project trash query: ${sql}`);
  } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(init.body);
    events.push({ kind: 'authorization', url, body });
    if (url === 'http://identity.fixture/v1/internal/authenticate') {
      assert.deepEqual(body, { token: 'fixture-access-token' });
      return new globalThis.Response(JSON.stringify({ id: collaboratorId, email: 'collaborator@example.test' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === 'http://workspace.fixture/v1/internal/authorize') {
      assert.deepEqual(body, { userId: collaboratorId, workspaceId: 'fixture-workspace', minimum: 'editor' });
      return new globalThis.Response(JSON.stringify({ role: 'editor' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected auth request: ${url}`);
  };

  try {
    assert.deepEqual(await service.trash(requestWithCsrf(), projectId), { trashed: true });
    assert.deepEqual(await service.trash(requestWithCsrf(), projectId), { trashed: true });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const projectQueries = events.filter(event => event.kind === 'query');
  assert.deepEqual(projectQueries.map(event => event.sql), [
    'SELECT * FROM projects WHERE id=$1',
    'UPDATE projects SET deleted_at=now(),version=version+1 WHERE id=$1 AND deleted_at IS NULL RETURNING id',
    'SELECT * FROM projects WHERE id=$1',
    'UPDATE projects SET deleted_at=now(),version=version+1 WHERE id=$1 AND deleted_at IS NULL RETURNING id',
    'SELECT id FROM projects WHERE id=$1 AND deleted_at IS NOT NULL',
  ]);
  assert.equal(projectQueries.filter(event => event.sql.startsWith('UPDATE projects')).length, 2);
  assert.equal(version, 2, 'the repeated request must not increment project version');
  assert.equal(deletedAt instanceof Date, true);
  assert.equal(events.filter(event => event.kind === 'authorization' && event.url.endsWith('/authorize')).length, 2, 'each replay rechecks current workspace access');
  assert.equal(projectQueries.some(event => /\b(DELETE|INSERT)\b/iu.test(event.sql)), false);

  const projectService = await readFile(new URL('../apps/autoclipper-project-service/src/application/project.service.ts', import.meta.url), 'utf8');
  assert.match(projectService, /SELECT \* FROM projects WHERE id=\$1 AND deleted_at IS NULL/u);
  assert.doesNotMatch(projectService, /DELETE\s+FROM\s+projects/iu);
  const trash = projectService.slice(projectService.indexOf('async trash('), projectService.indexOf('private async twitchSourceCapabilityStatus('));
  assert.doesNotMatch(trash, /idempotency[-_ ]?key/iu, 'project trash is idempotent by tombstone state, without an operation key');
  const projectMigration = await readFile(new URL('../apps/autoclipper-project-service/migrations/0000_project.sql', import.meta.url), 'utf8');
  assert.match(projectMigration, /CREATE TABLE uploads[\s\S]*project_id uuid NOT NULL REFERENCES projects\(id\)/u);
  assert.doesNotMatch(projectMigration, /uploads[\s\S]*project_id uuid NOT NULL REFERENCES projects\(id\) ON DELETE CASCADE/u);
});

test('workspace member removal deletes membership state only, never the workspace or project content', async () => {
  const service = await readFile(new URL('../apps/autoclipper-workspace-service/src/application/workspace.service.ts', import.meta.url), 'utf8');
  const remove = service.slice(service.indexOf('async remove('), service.indexOf('async transfer('));
  assert.match(remove, /DELETE FROM memberships WHERE workspace_id=\$1 AND user_id=\$2/u);
  assert.match(remove, /INSERT INTO workspace_audit[\s\S]*'membership\.removed'/u);
  assert.doesNotMatch(remove, /DELETE FROM (?:workspaces|projects|uploads|objects|workspace_storage)/iu);
  const controller = await readFile(new URL('../apps/autoclipper-workspace-service/src/interfaces/workspace.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /@Delete\("workspaces\/:id\/members\/:member"\)/u);
  assert.doesNotMatch(controller, /@Delete\("workspaces\/:id"\)/u);
});
