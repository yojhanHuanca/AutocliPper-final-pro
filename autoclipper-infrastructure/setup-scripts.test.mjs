import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const infrastructure = new URL('./', import.meta.url);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'autoclipper-setup-contract-'));
  const infra = join(root, 'autoclipper-infrastructure');
  const backend = join(root, 'autoclipper-backend-microservices');
  await mkdir(infra, { recursive: true });
  await mkdir(backend, { recursive: true });
  await copyFile(new URL('setup-local.mjs', infrastructure), join(infra, 'setup-local.mjs'));
  await copyFile(new URL('setup-stage2.mjs', infrastructure), join(infra, 'setup-stage2.mjs'));
  return { root, infra, backend };
}

function runSetup(directory, script) {
  return spawnSync(process.execPath, [join(directory, script)], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 20_000,
  });
}

function assertNoCredentialValues(output, files) {
  for (const content of files) {
    for (const line of content.split(/\r?\n/u)) {
      const match = /^([A-Z_][A-Z0-9_]*)=(.+)$/u.exec(line);
      if (match && /(PASSWORD|TOKEN|SECRET|_KEY|ENCRYPTION_KEY|_URL)/u.test(match[1])) {
        assert.ok(!output.includes(match[2]), `setup output exposed value for ${match[1]}`);
      }
    }
  }
}

test('local setup stages are repeatable, preserve existing credentials, and do not print values', async (t) => {
  const env = await fixture();
  t.after(() => rm(env.root, { recursive: true, force: true }));
  const preservedInfraPassword = 'fixture-existing-admin-password-never-print';
  await writeFile(join(env.infra, '.env'), `POSTGRES_ADMIN_PASSWORD=${preservedInfraPassword}\n`, { mode: 0o600 });

  const stage1 = runSetup(env.infra, 'setup-local.mjs');
  assert.equal(stage1.status, 0, stage1.stderr);
  assert.match(stage1.stdout, /without printing credential values/u);
  await assert.rejects(readFile(join(env.backend, '.env.identity')));

  const stage2 = runSetup(env.infra, 'setup-stage2.mjs');
  assert.equal(stage2.status, 0, stage2.stderr);
  assert.match(stage2.stdout, /without printing credential values/u);

  const fileNames = [
    '.env',
    '.env.media',
    '.env.gateway',
    '.env.identity',
    '.env.workspace',
    '.env.project',
    '.env.analysis',
    '.env.billing',
  ];
  const snapshot = new Map();
  for (const name of fileNames) {
    const path = name === '.env' ? join(env.infra, name) : join(env.backend, name);
    snapshot.set(name, await readFile(path, 'utf8'));
  }
  assert.match(snapshot.get('.env'), new RegExp(`^POSTGRES_ADMIN_PASSWORD=${preservedInfraPassword}$`, 'mu'));
  assert.match(snapshot.get('.env.analysis'), /^PAID_AI_ENABLED=false$/mu);
  assert.doesNotMatch(snapshot.get('.env.analysis'), /^OLLAMA_/mu);

  const rerunStage1 = runSetup(env.infra, 'setup-local.mjs');
  const rerunStage2 = runSetup(env.infra, 'setup-stage2.mjs');
  assert.equal(rerunStage1.status, 0, rerunStage1.stderr);
  assert.equal(rerunStage2.status, 0, rerunStage2.stderr);
  const output = `${stage1.stdout}${stage1.stderr}${stage2.stdout}${stage2.stderr}${rerunStage1.stdout}${rerunStage1.stderr}${rerunStage2.stdout}${rerunStage2.stderr}`;
  const finalFiles = [];
  for (const name of fileNames) {
    const path = name === '.env' ? join(env.infra, name) : join(env.backend, name);
    const content = await readFile(path, 'utf8');
    assert.equal(content, snapshot.get(name), `${name} changed on a repeated setup`);
    finalFiles.push(content);
  }
  assertNoCredentialValues(output, finalFiles);
});

test('stage one refuses replacement credentials when service environments exist but infrastructure .env is lost', async (t) => {
  const env = await fixture();
  t.after(() => rm(env.root, { recursive: true, force: true }));
  const existingServiceEnv = 'CUSTOM_EXISTING_SECRET=fixture-preserved-service-secret\n';
  await writeFile(join(env.backend, '.env.identity'), existingServiceEnv, { mode: 0o600 });

  const result = runSetup(env.infra, 'setup-local.mjs');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to generate replacement credentials/u);
  assert.equal(await readFile(join(env.backend, '.env.identity'), 'utf8'), existingServiceEnv);
  await assert.rejects(readFile(join(env.infra, '.env')));
  assertNoCredentialValues(`${result.stdout}${result.stderr}`, [existingServiceEnv]);
});

test('default app Compose keeps paid AI closed and omits the Ollama override', async () => {
  const compose = await Promise.all([
    readFile(new URL('compose.yaml', infrastructure), 'utf8'),
    readFile(new URL('compose.business.yaml', infrastructure), 'utf8'),
    readFile(new URL('compose.web.yaml', infrastructure), 'utf8'),
  ]);
  const defaultCompose = compose.join('\n');
  const envExample = await readFile(new URL('.env.example', infrastructure), 'utf8');
  const readme = await readFile(new URL('../README.md', infrastructure), 'utf8');
  const quickstart = readme.split('## Current source limits')[0];
  const composeCommand = quickstart.split('Build and start the app profile')[1]?.split('```powershell')[1]?.split('```')[0] ?? '';

  assert.match(defaultCompose, /PAID_AI_ENABLED:\s*\$\{PAID_AI_ENABLED:-false\}/u);
  assert.match(defaultCompose, /AI_MAX_ESTIMATED_USD_PER_JOB:\s*\$\{AI_MAX_ESTIMATED_USD_PER_JOB:-0\}/u);
  assert.match(envExample, /^OPENAI_API_KEY=$/mu);
  assert.match(envExample, /^PAID_AI_ENABLED=false$/mu);
  assert.match(envExample, /^AI_MAX_ESTIMATED_USD_PER_JOB=0$/mu);
  assert.doesNotMatch(defaultCompose, /OLLAMA|ollama/u);
  assert.doesNotMatch(composeCommand, /compose\.analysis-local\.yaml|setup-analysis-model/u);
  assert.ok(quickstart.indexOf('node setup-local.mjs') < quickstart.indexOf('node setup-stage2.mjs'));
  assert.ok(quickstart.indexOf('node setup-stage2.mjs') < quickstart.indexOf('docker compose @compose up'));
  assert.match(quickstart, /localhost:4200\/health\/ready/u);
  assert.match(quickstart, /localhost:3005\/v1\/health\/ready/u);
});
