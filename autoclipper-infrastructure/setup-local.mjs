import { randomBytes } from 'node:crypto';
import { access, appendFile, readFile } from 'node:fs/promises';

const directory = new URL('./', import.meta.url);
const rootEnv = new URL('.env', directory);
const secret = () => randomBytes(32).toString('hex');
const rootSecrets = new Map([
  ['POSTGRES_ADMIN_PASSWORD', secret],
  ['MEDIA_OWNER_PASSWORD', secret],
  ['MEDIA_RUNTIME_PASSWORD', secret],
  ['REDIS_PASSWORD', secret],
  ['S3_ACCESS_KEY', () => randomBytes(16).toString('hex')],
  ['S3_SECRET_KEY', secret],
  ['INTERNAL_TOKEN', secret],
]);

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function toEntries(lines) {
  return lines.map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  });
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function ensureEntries(file, entries, { rejectEmpty = false } = {}) {
  const current = await readOptional(file);
  const values = parseEnv(current);
  const missing = [];
  for (const [key, value] of entries) {
    if (values.has(key)) {
      if (rejectEmpty && !values.get(key)?.trim() && (typeof value === 'function' || value.trim())) {
        throw new Error(`Existing environment entry ${key} is empty; refusing to replace existing local values.`);
      }
      continue;
    }
    missing.push([key, typeof value === 'function' ? value() : value]);
  }
  if (missing.length === 0) return;
  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
  const additions = missing.map(([key, value]) => `${key}=${value}`).join('\n');
  await appendFile(file, `${prefix}${additions}\n`, { encoding: 'utf8', mode: 0o600 });
}

const businessEnvFiles = ['identity', 'workspace', 'project', 'analysis', 'billing']
  .map((name) => new URL(`../autoclipper-backend-microservices/.env.${name}`, directory));
const dependentEnvFiles = [
  new URL('../autoclipper-backend-microservices/.env.media', directory),
  new URL('../autoclipper-backend-microservices/.env.gateway', directory),
  ...businessEnvFiles,
];
const dependentEnvExists = (await Promise.all(dependentEnvFiles.map(exists))).some(Boolean);
const rootEnvExists = await exists(rootEnv);
if (!rootEnvExists && dependentEnvExists) {
  throw new Error('Local service environment files exist while infrastructure .env is missing; refusing to generate replacement credentials. Restore the original .env first.');
}

if (rootEnvExists && dependentEnvExists) {
  const existing = parseEnv(await readFile(rootEnv, 'utf8'));
  const incomplete = [...rootSecrets.keys()].some((key) => !existing.get(key)?.trim());
  if (incomplete) {
    throw new Error('Existing local service environment files depend on infrastructure credentials that are missing; refusing to generate replacements. Restore the original .env first.');
  }
}

await ensureEntries(rootEnv, [...rootSecrets], { rejectEmpty: true });
const values = parseEnv(await readFile(rootEnv, 'utf8'));
for (const key of rootSecrets.keys()) {
  if (!values.get(key)?.trim()) throw new Error('Infrastructure .env is missing a required local credential; no credential value was printed.');
}

const media = [
  'NODE_ENV=development', 'HOST=127.0.0.1', 'PORT=3001', 'ENABLE_DOCS=true', 'CORS_ORIGIN=http://localhost:4200',
  `DATABASE_URL=postgresql://autoclipper_media_runtime:${values.get('MEDIA_RUNTIME_PASSWORD')}@127.0.0.1:15432/autoclipper_media`,
  `MIGRATION_DATABASE_URL=postgresql://autoclipper_media_owner:${values.get('MEDIA_OWNER_PASSWORD')}@127.0.0.1:15432/autoclipper_media`,
  `REDIS_URL=redis://:${values.get('REDIS_PASSWORD')}@127.0.0.1:16379/0`,
  'S3_ENDPOINT=http://127.0.0.1:19000', 'S3_REGION=us-east-1', 'S3_BUCKET=autoclipper-media', 'S3_FORCE_PATH_STYLE=true',
  `S3_ACCESS_KEY=${values.get('S3_ACCESS_KEY')}`, `S3_SECRET_KEY=${values.get('S3_SECRET_KEY')}`, `INTERNAL_TOKEN=${values.get('INTERNAL_TOKEN')}`,
  'TEMP_DIR=.local/tmp', 'WORKER_CONCURRENCY=2', 'MAX_PROBE_BYTES=104857600', 'MAX_VIDEO_SECONDS=3600', 'PROBE_TIMEOUT_MS=30000',
];
await ensureEntries(new URL('../autoclipper-backend-microservices/.env.media', directory), toEntries(media), { rejectEmpty: true });

const gateway = [
  'NODE_ENV=development', 'HOST=127.0.0.1', 'PORT=3000', 'ENABLE_DOCS=true', 'CORS_ORIGIN=http://localhost:4200',
];
await ensureEntries(new URL('../autoclipper-backend-microservices/.env.gateway', directory), toEntries(gateway), { rejectEmpty: true });

console.log('Stage 1 local environment prepared without printing credential values. Run setup-stage2.mjs next for business-service credentials.');
