import { randomBytes } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';

const directory = new URL('./', import.meta.url);
const rootEnv = new URL('.env', directory);
const secret = () => randomBytes(32).toString('hex');

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return values;
}

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function appendMissing(file, entries, { rejectEmpty = false } = {}) {
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

const generatedCredentials = [
  'IDENTITY_OWNER_PASSWORD', 'IDENTITY_RUNTIME_PASSWORD',
  'WORKSPACE_OWNER_PASSWORD', 'WORKSPACE_RUNTIME_PASSWORD',
  'PROJECT_OWNER_PASSWORD', 'PROJECT_RUNTIME_PASSWORD',
  'ANALYSIS_OWNER_PASSWORD', 'ANALYSIS_RUNTIME_PASSWORD',
  'AUTH_ENCRYPTION_KEY', 'CSRF_SIGNING_KEY',
  'BILLING_OWNER_PASSWORD', 'BILLING_RUNTIME_PASSWORD',
];
const baseEnv = parseEnv(await readOptional(rootEnv));
for (const key of ['POSTGRES_ADMIN_PASSWORD', 'MEDIA_OWNER_PASSWORD', 'MEDIA_RUNTIME_PASSWORD', 'REDIS_PASSWORD', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'INTERNAL_TOKEN']) {
  if (!baseEnv.get(key)?.trim()) throw new Error('Run setup-local.mjs first or restore the existing infrastructure .env; no credential value was printed.');
}
await appendMissing(rootEnv, generatedCredentials.map((key) => [key, secret]), { rejectEmpty: true });
const values = parseEnv(await readFile(rootEnv, 'utf8'));
for (const key of generatedCredentials) {
  if (!values.get(key)?.trim()) throw new Error(`Required local credential ${key} is missing; no credential value was printed.`);
}

const common = [
  'NODE_ENV=development', 'HOST=127.0.0.1', 'COOKIE_AUTH=true', 'ENABLE_DOCS=true', 'CORS_ORIGIN=http://localhost:4200',
  `INTERNAL_TOKEN=${values.get('INTERNAL_TOKEN') ?? ''}`,
  `CSRF_SIGNING_KEY=${values.get('CSRF_SIGNING_KEY')}`,
  'IDENTITY_URL=http://127.0.0.1:3002', 'WORKSPACE_URL=http://127.0.0.1:3003',
];

function serviceEntries(name, port) {
  const upper = name.toUpperCase();
  const lines = [
    ...common,
    `PORT=${port}`,
    `DATABASE_URL=postgresql://autoclipper_${name}_runtime:${values.get(`${upper}_RUNTIME_PASSWORD`)}@127.0.0.1:15432/autoclipper_${name}`,
    `MIGRATION_DATABASE_URL=postgresql://autoclipper_${name}_owner:${values.get(`${upper}_OWNER_PASSWORD`)}@127.0.0.1:15432/autoclipper_${name}`,
  ];
  if (name === 'identity') lines.push(`AUTH_ENCRYPTION_KEY=${values.get('AUTH_ENCRYPTION_KEY')}`, `GOOGLE_CLIENT_ID=${values.get('GOOGLE_CLIENT_ID') ?? ''}`, 'SMTP_HOST=127.0.0.1', 'SMTP_PORT=11025', 'SMTP_FROM=AutoClipper <no-reply@autoclipper.test>', `REDIS_URL=redis://:${values.get('REDIS_PASSWORD')}@127.0.0.1:16379/1`);
  if (name === 'workspace') lines.push(`AUTH_ENCRYPTION_KEY=${values.get('AUTH_ENCRYPTION_KEY')}`);
  if (name === 'project' || name === 'analysis') lines.push('ANALYSIS_URL=http://127.0.0.1:3006', 'MEDIA_URL=http://127.0.0.1:3001', 'S3_ENDPOINT=http://127.0.0.1:19000', 'S3_PUBLIC_ENDPOINT=http://127.0.0.1:19000', 'S3_REGION=us-east-1', 'S3_BUCKET=autoclipper-media', `S3_ACCESS_KEY=${values.get('S3_ACCESS_KEY')}`, `S3_SECRET_KEY=${values.get('S3_SECRET_KEY')}`);
  if (name === 'analysis') lines.push(`REDIS_URL=redis://:${values.get('REDIS_PASSWORD')}@127.0.0.1:16379/2`, 'TEMP_DIR=.local/analysis-temp', 'PAID_AI_ENABLED=false');
  return lines.map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  });
}

for (const [name, port] of [['identity', 3002], ['workspace', 3003], ['project', 3004], ['analysis', 3006], ['billing', 3007]]) {
  const file = new URL(`../autoclipper-backend-microservices/.env.${name}`, directory);
  await appendMissing(file, serviceEntries(name, port), { rejectEmpty: true });
}

const gateway = new URL('../autoclipper-backend-microservices/.env.gateway', directory);
await appendMissing(gateway, [
  ['COOKIE_AUTH', 'true'], ['IDENTITY_URL', 'http://127.0.0.1:3002'], ['WORKSPACE_URL', 'http://127.0.0.1:3003'],
  ['PROJECT_URL', 'http://127.0.0.1:3004'], ['INTERNAL_TOKEN', values.get('INTERNAL_TOKEN') ?? ''], ['BILLING_URL', 'http://127.0.0.1:3007'],
], { rejectEmpty: true });

console.log('Stage 2 local environment prepared without printing credential values. Existing entries were preserved.');
