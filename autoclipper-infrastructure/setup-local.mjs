import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const secret = () => randomBytes(32).toString('hex');
const values = { POSTGRES_ADMIN_PASSWORD: secret(), MEDIA_OWNER_PASSWORD: secret(), MEDIA_RUNTIME_PASSWORD: secret(), REDIS_PASSWORD: secret(), S3_ACCESS_KEY: randomBytes(16).toString('hex'), S3_SECRET_KEY: secret(), INTERNAL_TOKEN: secret() };
const directory = new URL('./', import.meta.url);
// Exclusive creation prevents overwriting existing credentials and stranding volumes.
await writeFile(new URL('.env', directory), Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
const media = [
  'NODE_ENV=development', 'HOST=127.0.0.1', 'PORT=3001', 'ENABLE_DOCS=true', 'CORS_ORIGIN=http://localhost:4200',
  `DATABASE_URL=postgresql://autoclipper_media_runtime:${values.MEDIA_RUNTIME_PASSWORD}@127.0.0.1:15432/autoclipper_media`,
  `MIGRATION_DATABASE_URL=postgresql://autoclipper_media_owner:${values.MEDIA_OWNER_PASSWORD}@127.0.0.1:15432/autoclipper_media`,
  `REDIS_URL=redis://:${values.REDIS_PASSWORD}@127.0.0.1:16379/0`,
  'S3_ENDPOINT=http://127.0.0.1:19000', 'S3_REGION=us-east-1', 'S3_BUCKET=autoclipper-media', 'S3_FORCE_PATH_STYLE=true',
  `S3_ACCESS_KEY=${values.S3_ACCESS_KEY}`, `S3_SECRET_KEY=${values.S3_SECRET_KEY}`, `INTERNAL_TOKEN=${values.INTERNAL_TOKEN}`,
  'TEMP_DIR=.local/tmp', 'WORKER_CONCURRENCY=2', 'MAX_PROBE_BYTES=104857600', 'MAX_VIDEO_SECONDS=3600', 'PROBE_TIMEOUT_MS=30000'
].join('\n') + '\n';
await writeFile(new URL('../autoclipper-backend-microservices/.env.media', directory), media, { flag: 'wx', mode: 0o600 });
await writeFile(new URL('../autoclipper-backend-microservices/.env.gateway', directory), 'NODE_ENV=development\nHOST=127.0.0.1\nPORT=3000\nENABLE_DOCS=true\nCORS_ORIGIN=http://localhost:4200\n', { flag: 'wx', mode: 0o600 });
console.log(`Local environment files created; values were not printed. Infrastructure: ${fileURLToPath(directory)}`);
