import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { MediaConfig } from "@autoclipper/configuration";
import {
  InspectionError,
  validateMetadata,
  validateObjectKey,
} from "../domain/inspection.js";

const execute = promisify(execFile);
export async function probeLocal(
  path: string,
  config: Pick<
    MediaConfig,
    "FFPROBE_PATH" | "PROBE_TIMEOUT_MS" | "MAX_VIDEO_SECONDS"
  >,
  signal?:AbortSignal,
) {
  let stdout: string;
  try {
    const result = await execute(
      config.FFPROBE_PATH,
      [
        "-v",
        "error",
        "-max_alloc",
        "67108864",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        "mov,matroska,webm",
        "-show_entries",
        "format=duration,format_name:stream=codec_type,codec_name,width,height",
        "-of",
        "json",
        path,
      ],
      {
        shell: false,
        timeout: config.PROBE_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: 1048576,
        windowsHide: true,
        ...(signal?{signal}:{}),
      },
    );
    stdout = result.stdout;
  } catch {
    if(signal?.aborted)throw new InspectionError("CANCELLED",false);
    throw new InspectionError("PROBE_FAILED", false);
  }
  try {
    return validateMetadata(
      JSON.parse(stdout) as unknown,
      config.MAX_VIDEO_SECONDS,
    );
  } catch (error) {
    if (error instanceof InspectionError) throw error;
    throw new InspectionError("INVALID_MEDIA", false);
  }
}

export async function withInspectedSource<T>(
  s3: S3Client,
  config: MediaConfig,
  task: {
    objectKey: string;
    workspaceId: string;
    expectedBytes: number;
    expectedEtag: string;
    expectedSha256?: string | null;
  },
  work: (path: string, directory: string, metadata: Awaited<ReturnType<typeof probeLocal>>) => Promise<T>,
  signal?: AbortSignal,
) {
  validateObjectKey(task.objectKey, task.workspaceId);
  if (task.expectedBytes > config.MAX_PROBE_BYTES)
    throw new InspectionError("MEDIA_LIMIT_EXCEEDED", false);
  const abort = new AbortController();
  const combined = signal ? AbortSignal.any([abort.signal, signal]) : abort.signal;
  const timer = setTimeout(() => abort.abort(), config.PROBE_TIMEOUT_MS);
  let directory: string | undefined;
  try {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: task.objectKey }),
      { abortSignal: combined },
    );
    if (
      head.ContentLength !== task.expectedBytes ||
      head.ETag !== task.expectedEtag
    )
      throw new InspectionError("OBJECT_CHANGED", false);
    await mkdir(config.TEMP_DIR, { recursive: true });
    directory = await mkdtemp(join(config.TEMP_DIR, "probe-"));
    await chmod(directory, 0o700);
    const path = join(directory, "source.media");
    const object = await s3.send(
      new GetObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: task.objectKey,
        IfMatch: task.expectedEtag,
      }),
      { abortSignal: combined },
    );
    if (!object.Body) throw new InspectionError("EMPTY_OBJECT", false);
    let bytes = 0;
    const hash = createHash("sha256");
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        hash.update(chunk);
        callback(
          bytes > task.expectedBytes
            ? new InspectionError("MEDIA_LIMIT_EXCEEDED", false)
            : null,
          chunk,
        );
      },
    });
    await pipeline(
      object.Body as Readable,
      limit,
      createWriteStream(path, { flags: "wx", mode: 0o600 }),
      { signal: combined },
    );
    if (bytes !== task.expectedBytes)
      throw new InspectionError("OBJECT_CHANGED", false);
    if (task.expectedSha256 && hash.digest("hex") !== task.expectedSha256)
      throw new InspectionError("CHECKSUM_MISMATCH", false);
    clearTimeout(timer);
    const metadata = await probeLocal(path, config,combined);
    return await work(path, directory, metadata);
  } finally {
    clearTimeout(timer);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export async function inspectObject(s3: S3Client, config: MediaConfig, task: Parameters<typeof withInspectedSource>[2]) {
  return withInspectedSource(s3, config, task, async (_path, _directory, metadata) => metadata);
}
