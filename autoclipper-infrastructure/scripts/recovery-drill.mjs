import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, sep } from 'node:path';
import { Readable } from 'node:stream';
import { encryptArchive, decryptArchive, verifyArchive } from '../../autoclipper-backend-microservices/scripts/recovery/archive.mjs';

// Deliberately a lab driver, not a command to snapshot/stop an existing stack.
// Every Docker resource is new, labelled and addressed by an unguessable run ID.
const root = fileURLToPath(new URL('../../', import.meta.url));
const docker = process.env.DOCKER_BIN ?? 'docker';
const id = randomUUID(), label = `autoclipper.recovery-drill=${id}`;
const prefix = `ac-recovery-${id}`, network = `${prefix}-net`;
const directory = resolve(root, '.local', 'recovery', id);
assert.ok(directory.startsWith(resolve(root, '.local', 'recovery') + sep));
const images = {
  postgres: 'postgres:18.6-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c',
  storage: 'rustfs/rustfs:1.0.1@sha256:1803faef57627e2d9c2e7d89d655d712ddded5389040054987163043fecb6a3c',
  redis: 'redis:8.2.10-bookworm@sha256:47670742d7924adbcdb404d1288b6327815b23141969c0939b8e5d61f78c2634',
  verifier: 'autoclipper-backend:0.2.0',
};
const containers = [], volumes = [];
let createdNetwork = false;
function child(args, input) {
  const process = spawn(docker, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  process.stdin.on('error', () => {});
  const timer = setTimeout(() => process.kill(), args[0] === 'info' ? 15000 : 180000);
  const chunks = [], errors = [];
  process.stderr.on('data', chunk => { if (Buffer.concat(errors).length < 65536) errors.push(chunk); });
  const done = new Promise((resolve, reject) => {
    process.on('error', () => { clearTimeout(timer); reject(new Error('DOCKER_UNAVAILABLE')); });
    process.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`DOCKER_COMMAND_FAILED_${code}`)); });
  });
  // Install a handler immediately; streaming commands may fail before pipeline awaits.
  done.catch(() => {});
  if (input !== undefined) process.stdin.end(input);
  return { process, chunks, errors, done };
}
async function command(args, input = '') {
  const running = child(args, input);
  running.process.stdout.on('data', chunk => running.chunks.push(chunk));
  await running.done;
  return Buffer.concat(running.chunks).toString().trim();
}
async function waitReady(name) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      await command(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'autoclipper_bootstrap', '-d', 'postgres']);
      return;
    } catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  throw new Error('ISOLATED_POSTGRES_NOT_READY');
}
async function assertOwned(kind, name) {
  const value = JSON.parse(await command([kind, 'inspect', name]))[0];
  const labels = kind === 'container' ? value.Config.Labels : value.Labels;
  assert.equal(labels?.['autoclipper.recovery-drill'], id, 'refuse to mutate a foreign Docker resource');
  return value;
}
async function volume(name) {
  await command(['volume', 'create', '--label', label, name]);
  volumes.push(name);
}
async function run(name, args) {
  await command(['create', '--pull=never', '--name', name, '--label', label, '--network', network, ...args]);
  containers.push(name);
  await command(['start', name]);
}
async function fixture(config) {
  const name = `${prefix}-fixture-${config.phase}`;
  await command(['create', '-i', '--pull=never', '--name', name, '--label', label, '--network', network, '--memory', '384m', '--cpus', '1', '--pids-limit', '128', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=96m,uid=1000,gid=1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--mount', `type=bind,source=${join(root, 'autoclipper-backend-microservices', 'scripts', 'recovery')},target=/app/scripts/recovery,readonly`, images.verifier, 'node', 'scripts/recovery/fixture.mjs']);
  containers.push(name);
  const output = await command(['start', '-a', '-i', name], JSON.stringify(config));
  const state = await assertOwned('container', name);
  if (state.State.ExitCode !== 0) {
    const diagnostic = output.split(/\r?\n/).findLast(line => line.startsWith('{"errorCode":'));
    if (diagnostic) {
      const { errorCode, checkpoint } = JSON.parse(diagnostic);
      if (/^[A-Z_0-9]+$/.test(errorCode) && /^[A-Z_0-9]+$/.test(checkpoint)) throw new Error(`FIXTURE_${checkpoint}_${errorCode}`);
    }
    throw new Error('ISOLATED_FIXTURE_FAILED');
  }
  const report = output.split(/\r?\n/).findLast(line => line.startsWith('{"phase":'));
  assert.ok(report, 'missing isolated verification report');
  return JSON.parse(report);
}
async function coldArchive(name, volumeName, kind, key) {
  const container = await assertOwned('container', name);
  assert.equal(container.State.Running, false);
  assert.equal(container.State.ExitCode, 0, 'source must shut down cleanly');
  const context = `${id}:${kind}:${container.Image}`;
  const path = join(directory, `${kind}.enc`);
  const helper = `${prefix}-backup-${kind}`;
  await command(['create', '--pull=never', '--name', helper, '--label', label, '--network', 'none', '--read-only', '--memory', '96m', '--cpus', '0.5', '--cap-drop', 'ALL', '--cap-add', 'DAC_OVERRIDE', '--mount', `type=volume,source=${volumeName},target=/snapshot,readonly`, '--entrypoint', 'bash', images.postgres, '-ceu', kind === 'postgres' ? 'test "$(cat /snapshot/18/docker/PG_VERSION)" = 18; test ! -e /snapshot/18/docker/postmaster.pid; test -z "$(find /snapshot -type l -print -quit)"; pg_controldata /snapshot/18/docker | grep -Eq "Database cluster state:[[:space:]]+shut down$"; tar -C /snapshot -cf - .' : 'test -z "$(find /snapshot -type l -print -quit)"; tar -C /snapshot -cf - .']);
  containers.push(helper);
  const stream = child(['start', '-a', helper], '');
  try { await encryptArchive(stream.process.stdout, path, key, context); await stream.done; }
  catch (error) { stream.process.kill(); await stream.done.catch(() => {}); throw error; }
  await verifyArchive(path, key, context);
  assert.equal((await assertOwned('container', helper)).State.ExitCode, 0, 'archive helper must exit successfully');
  return { path, context, image: container.Image };
}
async function restoreArchive(archive, volumeName, kind, key) {
  await verifyArchive(archive.path, key, archive.context);
  const helper = `${prefix}-restore-${kind}`;
  await command(['create', '-i', '--pull=never', '--name', helper, '--label', label, '--network', 'none', '--read-only', '--memory', '96m', '--cpus', '0.5', '--cap-drop', 'ALL', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'CHOWN', '--cap-add', 'FOWNER', '--mount', `type=volume,source=${volumeName},target=/restore`, '--entrypoint', 'bash', images.postgres, '-ceu', 'test -z "$(find /restore -mindepth 1 -print -quit)"; tar --numeric-owner -C /restore -xf -']);
  containers.push(helper);
  const stream = child(['start', '-a', '-i', helper]);
  stream.process.stdout.resume();
  try { await decryptArchive(archive.path, key, archive.context, stream.process.stdin); await stream.done; }
  catch (error) { stream.process.kill(); await stream.done.catch(() => {}); throw error; }
  assert.equal((await assertOwned('container', helper)).State.ExitCode, 0);
}
async function clean() {
  const errors = [];
  for (const name of [...containers].reverse()) {
    try { await assertOwned('container', name); await command(['rm', '-f', name]); } catch { errors.push('container'); }
  }
  for (const name of [...volumes].reverse()) {
    try { await assertOwned('volume', name); await command(['volume', 'rm', name]); } catch { errors.push('volume'); }
  }
  if (createdNetwork) {
    try { await assertOwned('network', network); await command(['network', 'rm', network]); } catch { errors.push('network'); }
  }
  return errors;
}

const started = Date.now();
let result, failure;
try {
  const info = JSON.parse(await command(['info', '--format', '{{json .}}']));
  assert.ok(info.NCPU >= 2 && info.MemTotal >= 3 * 1024 ** 3, 'requires Docker Linux, 2 CPUs and 3 GiB; no image downloads or shared service stops');
  for (const image of Object.values(images)) await command(['image', 'inspect', image, '--format', '{{.Id}}']);
  await mkdir(directory, { recursive: true });
  const key = randomBytes(32), password = randomBytes(24).toString('hex');
  const accessKey = randomBytes(16).toString('hex'), secretKey = randomBytes(32).toString('hex'), internalToken = randomBytes(32).toString('hex');
  const keyDirectory = resolve(root, '.local', 'recovery-keys');
  await mkdir(keyDirectory, { recursive: true });
  await writeFile(join(keyDirectory, `${id}.key`), key, { flag: 'wx', mode: 0o600 });
  const envPath = join(directory, 'fixture.env');
  const variables = { POSTGRES_USER: 'autoclipper_bootstrap', POSTGRES_PASSWORD: password, RUSTFS_ACCESS_KEY: accessKey, RUSTFS_SECRET_KEY: secretKey, RUSTFS_CONSOLE_ENABLE: 'false' };
  for (const service of ['MEDIA', 'IDENTITY', 'WORKSPACE', 'PROJECT', 'ANALYSIS', 'BILLING']) for (const role of ['OWNER', 'RUNTIME']) variables[`${service}_${role}_PASSWORD`] = password;
  await writeFile(envPath, Object.entries(variables).map(([key, value]) => `${key}=${value}`).join('\n'), { flag: 'wx', mode: 0o600 });
  await command(['network', 'create', '--internal', '--label', label, network]); createdNetwork = true;
  for (const role of ['source-pg', 'source-storage', 'target-pg', 'target-storage']) await volume(`${prefix}-${role}`);
  const sourcePg = `${prefix}-source-pg`, sourceStorage = `${prefix}-source-storage`;
  const sourcePgVolume = `${prefix}-source-pg`, sourceStorageVolume = `${prefix}-source-storage`;
  await run(sourcePg, ['--network-alias', 'source-pg', '--memory', '384m', '--cpus', '0.5', '--env-file', envPath, '--mount', `type=volume,source=${sourcePgVolume},target=/var/lib/postgresql`, ...['media', 'business'].flatMap((name, index) => ['--mount', `type=bind,source=${join(root, 'autoclipper-infrastructure', 'postgres', `init-${name}.sh`)},target=/docker-entrypoint-initdb.d/${index + 1}-${name}.sh,readonly`]), images.postgres]);
  await run(sourceStorage, ['--network-alias', 'source-storage', '--memory', '640m', '--cpus', '0.5', '--env-file', envPath, '--mount', `type=volume,source=${sourceStorageVolume},target=/data`, images.storage, '/data']);
  await waitReady(sourcePg);
  const expected = await fixture({ phase: 'seed', pgHost: 'source-pg', storageHost: 'source-storage', password, accessKey, secretKey, internalToken });
  const backupStarted = Date.now();
  for (const name of [sourcePg, sourceStorage]) { await assertOwned('container', name); await command(['stop', '-t', '60', name]); }
  const postgresArchive = await coldArchive(sourcePg, sourcePgVolume, 'postgres', key);
  const storageArchive = await coldArchive(sourceStorage, sourceStorageVolume, 'storage', key);
  const privateConfig = Buffer.from(JSON.stringify({ password, accessKey, secretKey, internalToken, expected }));
  await encryptArchive(Readable.from(privateConfig), join(directory, 'configuration.enc'), key, `${id}:configuration`);
  const backupSeconds = (Date.now() - backupStarted) / 1000;
  const restoreStarted = Date.now();
  // Prove wrong-key rejection without creating an extraction process.
  await assert.rejects(verifyArchive(postgresArchive.path, randomBytes(32), postgresArchive.context));
  await restoreArchive(postgresArchive, `${prefix}-target-pg`, 'postgres', key);
  await restoreArchive(storageArchive, `${prefix}-target-storage`, 'storage', key);
  // Recover the credentials and manifest from their encrypted envelope too.
  const configChunks = [];
  const { Writable } = await import('node:stream');
  await decryptArchive(join(directory, 'configuration.enc'), key, `${id}:configuration`, new Writable({ write(chunk, _encoding, done) { configChunks.push(chunk); done(); } }));
  const restoredConfig = JSON.parse(Buffer.concat(configChunks).toString());
  const restoredEnvPath = join(directory, 'restored-storage.env');
  await writeFile(restoredEnvPath, `RUSTFS_ACCESS_KEY=${restoredConfig.accessKey}\nRUSTFS_SECRET_KEY=${restoredConfig.secretKey}\nRUSTFS_CONSOLE_ENABLE=false`, { flag: 'wx', mode: 0o600 });
  await run(`${prefix}-target-pg`, ['--network-alias', 'target-pg', '--memory', '384m', '--cpus', '0.5', '--mount', `type=volume,source=${prefix}-target-pg,target=/var/lib/postgresql`, images.postgres]);
  await run(`${prefix}-target-storage`, ['--network-alias', 'target-storage', '--memory', '640m', '--cpus', '0.5', '--env-file', restoredEnvPath, '--mount', `type=volume,source=${prefix}-target-storage,target=/data`, images.storage, '/data']);
  await run(`${prefix}-target-redis`, ['--network-alias', 'target-redis', '--memory', '128m', '--cpus', '0.25', images.redis, 'redis-server', '--save', '', '--appendonly', 'no']);
  await waitReady(`${prefix}-target-pg`);
  const verified = await fixture({ ...restoredConfig, phase: 'verify', pgHost: 'target-pg', storageHost: 'target-storage' });
  result = { runId: id, status: 'passed', checkpointAt: expected.checkpointAt, backupSeconds, restoreAndVerifySeconds: (Date.now() - restoreStarted) / 1000, elapsedSeconds: (Date.now() - started) / 1000, databaseCount: verified.databases.length, objectCount: verified.objects.length, crossDatabaseDenials: verified.crossDatabaseDenials, runtimeDdlDenials: verified.runtimeDdlDenials, adminGrantWriteDenied: verified.adminGrantWriteDenied, replayedInspection: verified.replayedInspection, images, archiveContexts: { postgres: postgresArchive.context, storage: storageArchive.context }, productionRpoRtoValidated: false };
} catch (error) { failure = error; }
const cleanupErrors = await clean();
for (const filename of ['fixture.env', 'restored-storage.env']) {
  try { await unlink(join(directory, filename)); } catch (error) { if (error.code !== 'ENOENT') cleanupErrors.push('private-env'); }
}
if (cleanupErrors.length) failure = new Error(`ISOLATED_RESOURCE_CLEANUP_FAILED_${cleanupErrors.join('_')}`);
if (failure) {
  // Do not print Docker stderr, env, URLs or SQL exception payloads.
  console.error(JSON.stringify({ status: 'failed', runId: id, code: failure instanceof assert.AssertionError ? 'RECOVERY_ASSERTION_FAILED' : failure.message.match(/^[A-Z_0-9]+$/)?.[0] ?? 'RECOVERY_DRILL_FAILED', cleanupErrors }));
  process.exitCode = 1;
} else {
  await writeFile(join(directory, 'report.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(result));
}
