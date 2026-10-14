import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { MediaConfig } from "@autoclipper/configuration";

export function createS3(config: MediaConfig) {
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
    maxAttempts: 2,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 2000,
      requestTimeout: 5000,
    }),
  });
}
export function redisConnection(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
    connectTimeout: 2000,
  };
}
