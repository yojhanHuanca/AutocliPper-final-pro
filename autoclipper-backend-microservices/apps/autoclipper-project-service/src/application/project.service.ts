import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  HttpException,
  type OnModuleInit,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { z } from "zod";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import {
  authenticatedUser,
  loadServiceConfig,
  requireCsrf,
  body,
  digest,
  uuid,
  workspaceAccess,
  internalJson,
} from "@autoclipper/http-security";
import { logger } from "@autoclipper/observability";
import { DerivativesManager } from "./derivatives.manager.js";

import { AnalysisManager } from "./analysis.manager.js";

import { EditorManager } from "./editor.manager.js";
import { CollaborationManager } from "./collaboration.manager.js";
import { PipelineManager } from "./pipeline.manager.js";

type Project = {
  id: string;
  workspace_id: string;
  name: string;
  version: number;
  deleted_at: Date | null;
  request_hash: string;
};
type Upload = {
  id: string;
  workspace_id: string;
  project_id: string;
  object_key: string;
  expected_bytes: number;
  sha256: string;
  content_type: string;
  mode: "put" | "multipart";
  upload_id: string | null;
  state: "pending" | "confirmed" | "aborted";
  etag: string | null;
  expires_at: Date;
  signed_until: Date;
  request_hash: string;
};
const PART_BYTES = 8 * 1024 * 1024;
const createProject = z
  .object({ workspaceId: z.uuid(), name: z.string().trim().min(1).max(150) })
  .strict();
const uploadSchema = z
  .object({
    bytes: z.number().int().min(1).max(104857600),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    contentType: z.enum([
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-matroska",
    ]),
    mode: z.enum(["put", "multipart"]).default("put"),
  })
  .strict();
@Injectable()
export class ProjectService implements OnModuleInit, OnModuleDestroy {
  readonly config = loadServiceConfig();
  readonly pool = new pg.Pool({
    connectionString: this.config.DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
  });
  readonly bucket = process.env["S3_BUCKET"] ?? "";
  readonly mediaUrl = process.env["MEDIA_URL"] ?? "http://127.0.0.1:3001";
  readonly s3: S3Client;
  readonly signer: S3Client;
  readonly derivatives: DerivativesManager;
  readonly analyses: AnalysisManager;
  readonly editor: EditorManager;
  readonly collaboration: CollaborationManager;
  readonly pipelines: PipelineManager;
  private timer: NodeJS.Timeout | undefined;
  private working: Promise<void> | undefined;
  constructor() {
    const endpoint = process.env["S3_ENDPOINT"];
    const publicEndpoint = process.env["S3_PUBLIC_ENDPOINT"];
    const access = process.env["S3_ACCESS_KEY"],
      secret = process.env["S3_SECRET_KEY"];
    if (!endpoint || !publicEndpoint || !access || !secret || !this.bucket)
      throw new Error("S3 configuration required");
    const options = {
      region: process.env["S3_REGION"] ?? "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: access, secretAccessKey: secret },
      maxAttempts: 2,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 2000,
        requestTimeout: 5000,
      }),
    };
    this.s3 = new S3Client({ ...options, endpoint });
    this.signer = new S3Client({ ...options, endpoint: publicEndpoint });
    this.derivatives = new DerivativesManager(this.pool,this.config,this.mediaUrl,this.bucket,this.s3,this.signer,(req,id,minimum)=>this.upload(req,id,minimum));
    this.analyses=new AnalysisManager(this.pool,this.config,process.env["ANALYSIS_URL"]??"http://127.0.0.1:3006",this.derivatives,(req,id,minimum)=>this.upload(req,id,minimum));
    this.editor=new EditorManager(this.pool,this.config,this.derivatives,this.analyses,(req,id,minimum)=>this.upload(req,id,minimum));
    this.collaboration=new CollaborationManager(this.pool,this.config,this.derivatives,(req,id,minimum)=>this.upload(req,id,minimum));
    this.pipelines=new PipelineManager(this.pool,this.config,process.env["ANALYSIS_URL"]??"http://127.0.0.1:3006",this.derivatives);
  }
  async onModuleInit() {
    this.pool.on("error", () =>
      logger.error({ code: "PROJECT_DATABASE_ERROR" }),
    );
    this.timer = setInterval(() => {
      if (!this.working)
        this.working = this.dispatch()
          .catch(() => logger.warn({ code: "INSPECTION_REQUEST_RETRY" }))
          .finally(() => {
            this.working = undefined;
          });
    }, 1000);
    this.timer.unref();
  }
  private async tx<T>(work: (c: pg.PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const result = await work(c);
      await c.query("COMMIT");
      return result;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  private async project(
    req: Request,
    id: string,
    minimum: "reader" | "editor" | "admin" = "reader",
  ) {
    const user = await authenticatedUser(req, this.config);
    const row = (
      await this.pool.query<Project>(
        "SELECT * FROM projects WHERE id=$1 AND deleted_at IS NULL",
        [id],
      )
    ).rows[0];
    if (!row) throw new NotFoundException();
    await workspaceAccess(this.config, user.id, row.workspace_id, minimum);
    return { user, project: row };
  }
  private async upload(
    req: Request,
    id: string,
    minimum: "reader" | "editor" | "admin" = "reader",
  ) {
    const row = (
      await this.pool.query<Upload>("SELECT * FROM uploads WHERE id=$1", [id])
    ).rows[0];
    if (!row) throw new NotFoundException();
    await this.project(req, row.project_id, minimum);
    return row;
  }
  async create(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const user = await authenticatedUser(req, this.config);
    const data = body(createProject, input);
    await workspaceAccess(this.config, user.id, data.workspaceId, "editor");
    const key = uuid(String(req.headers["idempotency-key"] ?? ""));
    const hash = digest(JSON.stringify(data));
    return this.tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${user.id}:${key}`,
      ]);
      const prior = (
        await c.query<Project>(
          "SELECT * FROM projects WHERE creator_id=$1 AND idempotency_key=$2",
          [user.id, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== hash || prior.deleted_at)
          throw new ConflictException();
        return { id: prior.id, version: prior.version };
      }
      const id = randomUUID();
      await c.query(
        "INSERT INTO projects(id,workspace_id,creator_id,name,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [id, data.workspaceId, user.id, data.name, key, hash],
      );
      return { id, version: 1 };
    });
  }
  async list(
    req: Request,
    workspaceId: string,
    limit: string | undefined,
    search: string | undefined,
  ) {
    const user = await authenticatedUser(req, this.config);
    await workspaceAccess(this.config, user.id, workspaceId);
    const count = body(
      z.coerce.number().int().min(1).max(100).default(20),
      limit,
    );
    const query = body(z.string().max(150).default(""), search);
    const result = await this.pool.query(
      "SELECT id,workspace_id,name,version,created_at FROM projects WHERE workspace_id=$1 AND deleted_at IS NULL AND name ILIKE $2 ORDER BY created_at DESC,id DESC LIMIT $3",
      [workspaceId, `%${query}%`, count],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        name: row.name,
        version: row.version,
        createdAt: row.created_at,
      })),
    };
  }
  async get(req: Request, id: string) {
    const { project } = await this.project(req, id);
    return {
      id: project.id,
      workspaceId: project.workspace_id,
      name: project.name,
      version: project.version,
    };
  }
  async storage(req:Request,workspaceId:string){const user=await authenticatedUser(req,this.config);await workspaceAccess(this.config,user.id,workspaceId);const row=(await this.pool.query<{used_bytes:string;reserved_bytes:string}>('SELECT used_bytes,reserved_bytes FROM workspace_storage WHERE workspace_id=$1',[workspaceId])).rows[0];return {workspaceId,usedBytes:Number(row?.used_bytes??0),reservedBytes:Number(row?.reserved_bytes??0),limitBytes:Number(process.env['WORKSPACE_STORAGE_LIMIT_BYTES']??1073741824)};}
  async update(req: Request, id: string, input: unknown) {
    requireCsrf(req, this.config);
    await this.project(req, id, "editor");
    const data = body(
      z
        .object({
          name: z.string().trim().min(1).max(150),
          version: z.number().int().positive(),
        })
        .strict(),
      input,
    );
    const result = await this.pool.query<{ version: number }>(
      "UPDATE projects SET name=$1,version=version+1 WHERE id=$2 AND version=$3 AND deleted_at IS NULL RETURNING version",
      [data.name, id, data.version],
    );
    if (!result.rows[0]) throw new ConflictException();
    return { id, version: result.rows[0].version };
  }
  async trash(req: Request, id: string) {
    requireCsrf(req, this.config);
    await this.project(req, id, "editor");
    await this.pool.query(
      "UPDATE projects SET deleted_at=now(),version=version+1 WHERE id=$1 AND deleted_at IS NULL",
      [id],
    );
    return { trashed: true };
  }
  async beginUpload(req: Request, projectId: string, input: unknown) {
    requireCsrf(req, this.config);
    const { user, project } = await this.project(req, projectId, "editor");
    const data = body(uploadSchema, input);
    const key = uuid(String(req.headers["idempotency-key"] ?? ""));
    const hash = digest(JSON.stringify({ projectId, ...data }));
    let upload = await this.tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${user.id}:${key}`,
      ]);
      const prior = (
        await c.query<Upload>(
          "SELECT * FROM uploads WHERE creator_id=$1 AND idempotency_key=$2",
          [user.id, key],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.request_hash !== hash ||
          prior.state !== "pending" ||
          prior.expires_at <= new Date()
        )
          throw new ConflictException();
        return prior;
      }
      await c.query(
        "INSERT INTO workspace_storage(workspace_id) VALUES($1) ON CONFLICT DO NOTHING",
        [project.workspace_id],
      );
      const quota = await c.query(
        "UPDATE workspace_storage SET reserved_bytes=reserved_bytes+$1 WHERE workspace_id=$2 AND used_bytes+reserved_bytes+$1<=$3 RETURNING workspace_id",
        [
          data.bytes,
          project.workspace_id,
          Number(process.env["WORKSPACE_STORAGE_LIMIT_BYTES"] ?? 1073741824),
        ],
      );
      if (!quota.rows.length) throw new HttpException("Quota exceeded", 409);
      const id = randomUUID();
      const objectKey = `workspaces/${project.workspace_id}/media/${id}/source.media`;
      return (
        await c.query<Upload>(
          "INSERT INTO uploads(id,workspace_id,project_id,creator_id,idempotency_key,request_hash,object_key,expected_bytes,sha256,content_type,mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
          [
            id,
            project.workspace_id,
            projectId,
            user.id,
            key,
            hash,
            objectKey,
            data.bytes,
            data.sha256,
            data.contentType,
            data.mode,
          ],
        )
      ).rows[0]!;
    });
    if (upload.mode === "multipart" && !upload.upload_id) {
      const response = await this.s3.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: upload.object_key,
          ContentType: upload.content_type,
          ChecksumAlgorithm: "SHA256",
        }),
      );
      if (!response.UploadId)
        throw new Error("MULTIPART_INITIALIZATION_FAILED");
      const stored = await this.pool.query<Upload>(
        "UPDATE uploads SET upload_id=$1 WHERE id=$2 AND upload_id IS NULL AND state='pending' RETURNING *",
        [response.UploadId, upload.id],
      );
      if (stored.rows[0]) upload = stored.rows[0];
      else {
        await this.s3.send(
          new AbortMultipartUploadCommand({
            Bucket: this.bucket,
            Key: upload.object_key,
            UploadId: response.UploadId,
          }),
        );
        upload = (
          await this.pool.query<Upload>("SELECT * FROM uploads WHERE id=$1", [
            upload.id,
          ])
        ).rows[0]!;
      }
    }
    if (upload.mode === "multipart")
      return {
        id: upload.id,
        mode: upload.mode,
        partBytes: PART_BYTES,
        parts: Math.ceil(upload.expected_bytes / PART_BYTES),
        expiresAt: upload.expires_at.toISOString(),
      };
    const checksum = Buffer.from(upload.sha256, "hex").toString("base64");
    const signingDate = await this.signatureTime(upload);
    const url = await getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: upload.object_key,
        ContentType: upload.content_type,
        ContentLength: upload.expected_bytes,
        ChecksumSHA256: checksum,
      }),
      {
        expiresIn: 300,
        signingDate,
        signableHeaders: new Set([
          "content-length",
          "content-type",
          "x-amz-checksum-sha256",
        ]),
      },
    );
    return {
      id: upload.id,
      mode: "put",
      url,
      // The SDK signs the checksum in the URL query. Do not duplicate that
      // x-amz field in a header: S3-compatible servers reject the ambiguity.
      headers: { "content-type": upload.content_type },
      expiresInSeconds: 300,
    };
  }
  async part(req: Request, id: string, input: unknown) {
    requireCsrf(req, this.config);
    const upload = await this.upload(req, id, "editor");
    const data = body(
      z
        .object({
          partNumber: z.number().int().positive().max(10000),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
      input,
    );
    if (
      upload.state !== "pending" ||
      upload.mode !== "multipart" ||
      !upload.upload_id ||
      upload.expires_at <= new Date() ||
      data.partNumber > Math.ceil(upload.expected_bytes / PART_BYTES)
    )
      throw new ConflictException();
    const bytes = Math.min(
      PART_BYTES,
      upload.expected_bytes - (data.partNumber - 1) * PART_BYTES,
    );
    const checksum = Buffer.from(data.sha256, "hex").toString("base64");
    const signingDate = await this.signatureTime(upload);
    await this.pool.query(
      "INSERT INTO upload_parts(upload_id,part_number,expected_bytes,sha256) VALUES($1,$2,$3,$4) ON CONFLICT(upload_id,part_number) DO UPDATE SET expected_bytes=EXCLUDED.expected_bytes,sha256=EXCLUDED.sha256",
      [upload.id, data.partNumber, bytes, data.sha256],
    );
    const url = await getSignedUrl(
      this.signer,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: upload.object_key,
        UploadId: upload.upload_id,
        PartNumber: data.partNumber,
        ContentLength: bytes,
        ChecksumSHA256: checksum,
      }),
      {
        expiresIn: 300,
        signingDate,
        signableHeaders: new Set(["content-length"]),
      },
    );
    return {
      url,
      bytes,
      headers: {},
      expiresInSeconds: 300,
    };
  }
  async parts(req: Request, id: string) {
    const upload = await this.upload(req, id);
    if (
      upload.state !== "pending" ||
      upload.mode !== "multipart" ||
      !upload.upload_id
    )
      throw new ConflictException();
    const response = await this.s3.send(
      new ListPartsCommand({
        Bucket: this.bucket,
        Key: upload.object_key,
        UploadId: upload.upload_id,
        MaxParts: 100,
      }),
    );
    return {
      items: (response.Parts ?? []).map((p) => ({
        partNumber: p.PartNumber,
        bytes: p.Size,
        etag: p.ETag,
        checksum: p.ChecksumSHA256,
      })),
    };
  }
  async confirm(req: Request, id: string, correlationId: string) {
    requireCsrf(req, this.config);
    await this.upload(req, id, "editor");
    return this.tx(async (c) => {
      const upload = (
        await c.query<Upload>("SELECT * FROM uploads WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0]!;
      if (upload.state === "confirmed") return { id, state: "confirmed" };
      if (upload.state !== "pending" || upload.expires_at <= new Date())
        throw new ConflictException();
      if (upload.mode === "multipart") {
        let exists = false;
        try {
          const head = await this.s3.send(
            new HeadObjectCommand({
              Bucket: this.bucket,
              Key: upload.object_key,
            }),
          );
          exists = Boolean(head.ETag);
        } catch (error) {
          if (
            (error as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode !== 404
          )
            throw error;
        }
        if (!exists) {
          if (!upload.upload_id) throw new ConflictException();
          const list = await this.s3.send(
            new ListPartsCommand({
              Bucket: this.bucket,
              Key: upload.object_key,
              UploadId: upload.upload_id,
              MaxParts: 100,
            }),
          );
          const parts = list.Parts ?? [];
          const signedParts = (
            await c.query<{ part_number: number; sha256: string }>(
              "SELECT part_number,sha256 FROM upload_parts WHERE upload_id=$1",
              [id],
            )
          ).rows;
          const manifest = new Map(
            signedParts.map((p) => [
              p.part_number,
              Buffer.from(p.sha256, "hex").toString("base64"),
            ]),
          );
          if (
            parts.length !== Math.ceil(upload.expected_bytes / PART_BYTES) ||
            parts.some(
              (p, i) =>
                p.PartNumber !== i + 1 ||
                p.Size !==
                  Math.min(
                    PART_BYTES,
                    upload.expected_bytes - i * PART_BYTES,
                  ) ||
                !p.ETag ||
                !manifest.has(p.PartNumber ?? 0) ||
                Boolean(
                  p.ChecksumSHA256 &&
                  p.ChecksumSHA256 !== manifest.get(p.PartNumber ?? 0),
                ),
            )
          )
            throw new BadRequestException();
          await this.s3.send(
            new CompleteMultipartUploadCommand({
              Bucket: this.bucket,
              Key: upload.object_key,
              UploadId: upload.upload_id,
              MultipartUpload: {
                Parts: parts.map((p) => ({
                  ETag: p.ETag!,
                  PartNumber: p.PartNumber!,
                  ChecksumSHA256:
                    p.ChecksumSHA256 ?? manifest.get(p.PartNumber!)!,
                })),
              },
            }),
          );
        }
      }
      const head = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: upload.object_key,
          ChecksumMode: "ENABLED",
        }),
      );
      if (head.ContentLength !== upload.expected_bytes || !head.ETag)
        throw new BadRequestException();
      if (
        upload.mode === "put" &&
        head.ChecksumSHA256 &&
        head.ChecksumSHA256 !==
          Buffer.from(upload.sha256, "hex").toString("base64")
      )
        throw new BadRequestException();
      {
        const changed = await c.query(
          "UPDATE uploads SET state='confirmed',etag=$1 WHERE id=$2 AND state='pending' RETURNING id",
          [head.ETag, id],
        );
        if (!changed.rows.length) {
          const state = (
            await c.query<{ state: string }>(
              "SELECT state FROM uploads WHERE id=$1",
              [id],
            )
          ).rows[0]?.state;
          if (state !== "confirmed") throw new ConflictException();
          return { id, state: "confirmed" };
        }
        await c.query(
          "UPDATE workspace_storage SET reserved_bytes=reserved_bytes-$1,used_bytes=used_bytes+$1 WHERE workspace_id=$2",
          [upload.expected_bytes, upload.workspace_id],
        );
        await c.query(
          "INSERT INTO inspection_requests(upload_id,correlation_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [id, correlationId],
        );
      }
      return { id, state: "confirmed" };
    });
  }
  async status(req: Request, id: string) {
    const upload = await this.upload(req, id);
    const result = {
      id,
      projectId: upload.project_id,
      state: upload.state,
      bytes: upload.expected_bytes,
      expiresAt: upload.expires_at.toISOString(),
    };
    if (upload.state !== "confirmed") return result;
    const delivered = (
      await this.pool.query<{ delivered_at: Date | null }>(
        "SELECT delivered_at FROM inspection_requests WHERE upload_id=$1",
        [id],
      )
    ).rows[0]?.delivered_at;
    if (!delivered) return { ...result, inspection: { status: "queued" } };
    const inspection = await internalJson(
      this.mediaUrl,
      "/v1/internal/inspection-status",
      this.config,
      { id, workspaceId: upload.workspace_id },
    );
    return { ...result, inspection };
  }
  async abort(req: Request, id: string) {
    requireCsrf(req, this.config);
    await this.upload(req, id, "editor");
    return this.tx(async (c) => {
      const upload = (
        await c.query<Upload>("SELECT * FROM uploads WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0]!;
      if (upload.state === "confirmed") throw new ConflictException();
      await c.query(
        "UPDATE uploads SET state='aborted',expires_at=GREATEST(now(),signed_until)+interval '30 seconds' WHERE id=$1 AND state='pending'",
        [id],
      );
      if (upload.upload_id)
        try {
          await this.s3.send(
            new AbortMultipartUploadCommand({
              Bucket: this.bucket,
              Key: upload.object_key,
              UploadId: upload.upload_id,
            }),
          );
        } catch {
          logger.warn({ code: "MULTIPART_ABORT_RETRY", uploadId: id });
        }
      return { aborted: true, quotaRelease: "after_signed_urls_expire" };
    });
  }
  private async dispatch() {
    await this.derivatives.dispatch();
    await this.analyses.dispatch();
    await this.pipelines.dispatch();
    const rows = await this.pool.query<Upload & { correlation_id: string }>(
      "SELECT u.*,r.correlation_id FROM inspection_requests r JOIN uploads u ON u.id=r.upload_id WHERE r.delivered_at IS NULL ORDER BY r.created_at LIMIT 25",
    );
    for (const upload of rows.rows) {
      try {
        await internalJson(
          this.mediaUrl,
          "/v1/internal/inspections",
          this.config,
          {
            id: upload.id,
            workspaceId: upload.workspace_id,
            objectKey: upload.object_key,
            expectedBytes: upload.expected_bytes,
            expectedEtag: upload.etag,
            expectedSha256: upload.sha256,
            correlationId: upload.correlation_id,
          },
        );
        await this.pool.query(
          "UPDATE inspection_requests SET delivered_at=now() WHERE upload_id=$1",
          [upload.id],
        );
      } catch {
        logger.warn({
          code: "INSPECTION_ADMISSION_RETRY",
          uploadId: upload.id,
        });
      }
    }
    const expired = await this.pool.query<Upload>(
      "SELECT * FROM uploads WHERE cleaned_at IS NULL AND (state='aborted' OR state='pending') AND expires_at<now() LIMIT 25",
    );
    for (const upload of expired.rows) {
      await this.tx(async (c) => {
        const active = (
          await c.query<Upload>(
            "SELECT * FROM uploads WHERE id=$1 AND state<>'confirmed' AND cleaned_at IS NULL AND expires_at<now() FOR UPDATE",
            [upload.id],
          )
        ).rows[0];
        if (!active) return;
        if (active.upload_id)
          try {
            await this.s3.send(
              new AbortMultipartUploadCommand({
                Bucket: this.bucket,
                Key: upload.object_key,
                UploadId: active.upload_id,
              }),
            );
          } catch (error) {
            if (
              (error as { $metadata?: { httpStatusCode?: number } }).$metadata
                ?.httpStatusCode !== 404
            )
              throw error;
          }
        await this.s3.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: upload.object_key,
          }),
        );
        const changed = await c.query(
          "UPDATE uploads SET state='aborted',cleaned_at=now() WHERE id=$1 AND state<>'confirmed' AND cleaned_at IS NULL RETURNING id",
          [upload.id],
        );
        if (changed.rows.length)
          await c.query(
            "UPDATE workspace_storage SET reserved_bytes=reserved_bytes-$1 WHERE workspace_id=$2",
            [upload.expected_bytes, upload.workspace_id],
          );
      });
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.working;
    this.s3.destroy();
    this.signer.destroy();
    await this.pool.end();
  }
  private async signatureTime(upload: Upload) {
    const signingDate = new Date();
    const expires = new Date(signingDate.getTime() + 300000);
    const update = await this.pool.query(
      "UPDATE uploads SET signed_until=GREATEST(signed_until,$2),expires_at=GREATEST(expires_at,$2) WHERE id=$1 AND state='pending' AND expires_at>now() RETURNING id",
      [upload.id, expires],
    );
    if (!update.rows.length) throw new ConflictException();
    return signingDate;
  }
}
