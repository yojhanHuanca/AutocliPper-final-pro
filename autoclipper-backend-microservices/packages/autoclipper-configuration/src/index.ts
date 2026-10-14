import { z } from 'zod';

const boolean = z.enum(['true', 'false']).transform(v => v === 'true');
const url = z.url();
const base = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: url.default('http://localhost:4200'),
  ENABLE_DOCS: boolean.default('false'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info')
});

const media = base.extend({
  DATABASE_URL: url.refine(v => ['postgres:', 'postgresql:'].includes(new URL(v).protocol)),
  REDIS_URL: url.refine(v => ['redis:', 'rediss:'].includes(new URL(v).protocol)),
  S3_ENDPOINT: url,
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(16),
  S3_SECRET_KEY: z.string().min(32),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  S3_FORCE_PATH_STYLE: boolean.default('true'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  MAX_PROBE_BYTES: z.coerce.number().int().positive().max(1073741824).default(104857600),
  MAX_VIDEO_SECONDS: z.coerce.number().positive().max(14400).default(3600),
  PROBE_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(30000),
  FFPROBE_PATH: z.string().min(1).default('ffprobe'),
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  TEMP_DIR: z.string().min(1).default('.local/tmp'),
  INTERNAL_TOKEN: z.string().min(32)
});

function parse<T>(schema: z.ZodType<T>, env: Record<string, string | undefined>): T {
  const result = schema.safeParse(env);
  // Never include Zod input values: configuration may contain credentials.
  if (!result.success) throw new Error(`Invalid configuration: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);
  return result.data;
}

export const loadGatewayConfig = (env = process.env) => parse(base, env);
export const loadMediaConfig = (env = process.env) => parse(media, env);
export type GatewayConfig = ReturnType<typeof loadGatewayConfig>;
export type MediaConfig = ReturnType<typeof loadMediaConfig>;
