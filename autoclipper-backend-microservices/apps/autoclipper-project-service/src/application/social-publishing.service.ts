import { ConflictException, HttpException, Inject, Injectable, NotFoundException, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { authenticatedUser, body, cookie, digest, requireCsrf, seal, setCookie, unseal, uuid, workspaceAccess } from '@autoclipper/http-security';
import { logger } from '@autoclipper/observability';
import { ProjectService } from './project.service.js';
import { SocialProviders, SocialProviderError, type SocialProvider, type SocialTokens } from './social-providers.js';

const providerSchema = z.enum(['youtube', 'tiktok']);
export const publicationInput = z.object({ provider: providerSchema, title: z.string().trim().min(1).max(100), description: z.string().max(5000).default(''), privacy: z.enum(['private', 'unlisted', 'public']).default('private'), madeForKids: z.boolean(), consent: z.literal(true) }).strict();
type Job = { id: string; user_id: string; upload_id: string; processing_id: string; workspace_id: string; provider: SocialProvider; spec: z.infer<typeof publicationInput>; state: string; remote_id: string | null; remote_url: string | null; error_code: string | null; created_at: Date };
type Artifact = { objectKey: string; bytes: number; sha256: string; contentType: string; kind: string };

@Injectable()
export class SocialPublishingService implements OnModuleInit, OnModuleDestroy {
  readonly providers = new SocialProviders();
  private readonly key = process.env['AUTH_ENCRYPTION_KEY'] ?? '';
  private timer?: NodeJS.Timeout;
  private working: Promise<void> | undefined;
  private readonly abort = new AbortController();
  constructor(@Inject(ProjectService) private readonly project: ProjectService) {}
  private get config() { return this.project.config; }
  private get pool() { return this.project.pool; }
  private configured(provider: SocialProvider) { return /^[a-f0-9]{64}$/u.test(this.key) && this.providers.settings(provider).configured; }
  async connections(req: Request) {
    const user = await authenticatedUser(req, this.config);
    const rows = (await this.pool.query<{ provider: SocialProvider; expires_at: Date }>('SELECT provider,expires_at FROM social_connections WHERE user_id=$1', [user.id])).rows;
    return { providers: (['youtube', 'tiktok'] as const).map(provider => ({ provider, configured: this.configured(provider), linked: rows.some(row => row.provider === provider), mode: provider === 'tiktok' ? 'inbox' : 'publish' })) };
  }
  async connect(req: Request, res: Response, rawProvider: string) {
    requireCsrf(req, this.config);
    const provider = body(providerSchema, rawProvider), user = await authenticatedUser(req, this.config);
    if (!this.configured(provider)) throw new HttpException({ code: 'SOCIAL_OAUTH_NOT_CONFIGURED' }, 503);
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
    await this.pool.query("DELETE FROM social_oauth_states WHERE expires_at<now() OR (user_id=$1 AND provider=$2)", [user.id, provider]);
    await this.pool.query('INSERT INTO social_oauth_states(state_hash,user_id,provider,verifier_cipher) VALUES($1,$2,$3,$4)', [digest(state), user.id, provider, seal(verifier, this.key, `social-state:${digest(state)}`)]);
    setCookie(res, `social_${provider}_state`, state, 600_000);
    return { authorizationUrl: this.providers.authorizationUrl(provider, state, verifier) };
  }
  async callback(req: Request, res: Response, rawProvider: string) {
    const provider = body(providerSchema, rawProvider);
    const state = typeof req.query['state'] === 'string' ? req.query['state'] : '';
    if (!/^[\w-]{43}$/u.test(state) || cookie(req, `social_${provider}_state`) !== state) throw new HttpException({ code: 'SOCIAL_OAUTH_STATE_INVALID' }, 400);
    setCookie(res, `social_${provider}_state`, '', 0);
    const user = await authenticatedUser(req, this.config);
    const entry = (await this.pool.query<{ verifier_cipher: string }>('DELETE FROM social_oauth_states WHERE state_hash=$1 AND provider=$2 AND user_id=$3 AND expires_at>now() RETURNING verifier_cipher', [digest(state), provider, user.id])).rows[0];
    if (!entry) throw new HttpException({ code: 'SOCIAL_OAUTH_STATE_INVALID' }, 400);
    if (req.query['error']) return res.redirect(303, new URL(`/app/settings?social=${provider}&status=denied`, this.config.CORS_ORIGIN).toString());
    const code = body(z.string().min(1).max(4096), req.query['code']);
    try {
      const token = await this.providers.exchange(provider, code, unseal(entry.verifier_cipher, this.key, `social-state:${digest(state)}`));
      await this.pool.query('INSERT INTO social_connections(user_id,provider,token_cipher,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,provider) DO UPDATE SET token_cipher=EXCLUDED.token_cipher,expires_at=EXCLUDED.expires_at,updated_at=now()', [user.id, provider, seal(JSON.stringify(token), this.key, `social:${provider}:${user.id}`), new Date(token.expiresAt)]);
    } catch (error) { throw new HttpException({ code: error instanceof SocialProviderError ? error.code : 'SOCIAL_CONNECTION_FAILED' }, 502); }
    return res.redirect(303, new URL(`/app/settings?social=${provider}&status=linked`, this.config.CORS_ORIGIN).toString());
  }
  async disconnect(req: Request, rawProvider: string) {
    requireCsrf(req, this.config);
    const user = await authenticatedUser(req, this.config), provider = body(providerSchema, rawProvider);
    await this.pool.query('DELETE FROM social_connections WHERE user_id=$1 AND provider=$2', [user.id, provider]);
    await this.pool.query("UPDATE social_publications SET state='failed',error_code='SOCIAL_RECONNECT_REQUIRED',updated_at=now() WHERE user_id=$1 AND provider=$2 AND state='queued'", [user.id, provider]);
    return { disconnected: true };
  }
  async begin(req: Request, processingId: string, input: unknown) {
    requireCsrf(req, this.config);
    const user = await authenticatedUser(req, this.config), spec = body(publicationInput, input), idempotencyKey = uuid(String(req.headers['idempotency-key'] ?? ''));
    const row = (await this.pool.query<{ upload_id: string; workspace_id: string; status: string; spec: { kind: string } }>('SELECT upload_id,workspace_id,status,spec FROM processing_requests WHERE id=$1', [processingId])).rows[0];
    if (!row) throw new NotFoundException();
    await this.project.derivatives.authorizeUpload(req, row.upload_id, 'editor');
    if (row.status !== 'succeeded' || row.spec.kind !== 'clip') throw new ConflictException({ code: 'SOCIAL_CLIP_NOT_READY' });
    const hash = digest(JSON.stringify({ processingId, spec }));
    const existing = (await this.pool.query<Job & { request_hash: string }>('SELECT * FROM social_publications WHERE user_id=$1 AND idempotency_key=$2', [user.id, idempotencyKey])).rows[0];
    if (existing) { if (existing.request_hash !== hash) throw new ConflictException(); return this.present(existing); }
    if (!this.configured(spec.provider)) throw new HttpException({ code: 'SOCIAL_OAUTH_NOT_CONFIGURED' }, 503);
    const connection = (await this.pool.query('SELECT user_id FROM social_connections WHERE user_id=$1 AND provider=$2', [user.id, spec.provider])).rows[0];
    if (!connection) throw new ConflictException({ code: 'SOCIAL_RECONNECT_REQUIRED' });
    const job = (await this.pool.query<Job>("INSERT INTO social_publications(id,user_id,provider,processing_id,upload_id,workspace_id,idempotency_key,request_hash,spec) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *", [randomUUID(), user.id, spec.provider, processingId, row.upload_id, row.workspace_id, idempotencyKey, hash, spec])).rows[0]!;
    if ((job as Job & { request_hash: string }).request_hash !== hash) throw new ConflictException();
    return this.present(job);
  }
  private present(job: Job) { return { id: job.id, provider: job.provider, state: job.state, remoteId: job.remote_id, remoteUrl: job.remote_url, errorCode: job.error_code, createdAt: job.created_at.toISOString(), needsTikTokConfirmation: job.provider === 'tiktok' && job.state === 'inbox' }; }
  async status(req: Request, id: string) {
    const user = await authenticatedUser(req, this.config);
    const job = (await this.pool.query<Job>('SELECT * FROM social_publications WHERE id=$1 AND user_id=$2', [id, user.id])).rows[0];
    if (!job) throw new NotFoundException();
    await this.project.derivatives.authorizeUpload(req, job.upload_id, 'reader');
    return this.present(job);
  }
  private async accessToken(userId: string, provider: SocialProvider) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query<{ token_cipher: string }>('SELECT token_cipher FROM social_connections WHERE user_id=$1 AND provider=$2 FOR UPDATE', [userId, provider])).rows[0];
      if (!row) throw new SocialProviderError('SOCIAL_RECONNECT_REQUIRED');
      let token = JSON.parse(unseal(row.token_cipher, this.key, `social:${provider}:${userId}`)) as SocialTokens;
      if (token.expiresAt < Date.now() + 120_000) {
        if (!token.refreshToken) throw new SocialProviderError('SOCIAL_RECONNECT_REQUIRED');
        token = await this.providers.refresh(provider, token);
        await client.query('UPDATE social_connections SET token_cipher=$1,expires_at=$2,updated_at=now() WHERE user_id=$3 AND provider=$4', [seal(JSON.stringify(token), this.key, `social:${provider}:${userId}`), new Date(token.expiresAt), userId, provider]);
      }
      await client.query('COMMIT'); return token.accessToken;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  private async upload(job: Job) {
    let externalStarted = false;
    try {
      await workspaceAccess(this.config, job.user_id, job.workspace_id, 'editor');
      const source = (await this.pool.query<{ result: { artifacts: Artifact[] } }>("SELECT r.result FROM processing_requests r JOIN uploads u ON u.id=r.upload_id JOIN projects p ON p.id=u.project_id WHERE r.id=$1 AND r.status='succeeded' AND u.state='confirmed' AND p.deleted_at IS NULL", [job.processing_id])).rows[0];
      const artifact = source?.result.artifacts.find(item => item.kind === 'video' && item.contentType === 'video/mp4');
      if (!artifact) throw new SocialProviderError('SOCIAL_CLIP_NOT_READY');
      const token = await this.accessToken(job.user_id, job.provider);
      externalStarted = true;
      if (job.provider === 'youtube') {
        const url = await this.providers.youtubeInit(token, { ...job.spec, bytes: artifact.bytes });
        const object = await this.project.s3.send(new GetObjectCommand({ Bucket: this.project.bucket, Key: artifact.objectKey }));
        if (!object.Body || object.ContentLength !== artifact.bytes) throw new SocialProviderError('SOCIAL_CLIP_NOT_READY');
        const response = await this.providers.request(url, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'video/mp4', 'content-length': String(artifact.bytes) }, body: Readable.toWeb(object.Body as Readable) as ReadableStream, duplex: 'half', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(180_000)]) } as RequestInit, true);
        const result = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{11}$/u) }).safeParse(response);
        if (!result.success) throw new SocialProviderError('SOCIAL_INVALID_RESPONSE', true);
        await this.pool.query("UPDATE social_publications SET state='published',remote_id=$2,remote_url=$3,updated_at=now() WHERE id=$1", [job.id, result.data.id, `https://www.youtube.com/watch?v=${result.data.id}`]);
      } else {
        const target = await this.providers.tiktokInit(token, artifact.bytes);
        await this.pool.query('UPDATE social_publications SET remote_id=$2,updated_at=now() WHERE id=$1', [job.id, target.remoteId]);
        for (let index = 0; index < target.totalChunks; index++) {
          const start = index * target.chunkSize, end = index === target.totalChunks - 1 ? artifact.bytes - 1 : start + target.chunkSize - 1;
          const object = await this.project.s3.send(new GetObjectCommand({ Bucket: this.project.bucket, Key: artifact.objectKey, Range: `bytes=${start}-${end}` }));
          if (!object.Body) throw new SocialProviderError('SOCIAL_CLIP_NOT_READY');
          let response: globalThis.Response;
          try { response = await this.providers.transport(target.uploadUrl, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${artifact.bytes}` }, body: Readable.toWeb(object.Body as Readable) as ReadableStream, duplex: 'half', redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(120_000)]) } as RequestInit); }
          catch { throw new SocialProviderError('SOCIAL_UPLOAD_OUTCOME_UNKNOWN', true); }
          await response.body?.cancel();
          if (!response.ok) throw new SocialProviderError('SOCIAL_UPLOAD_REJECTED', response.status >= 500);
        }
        await this.pool.query("UPDATE social_publications SET state='processing',updated_at=now() WHERE id=$1", [job.id]);
      }
    } catch (error) {
      const code = error instanceof SocialProviderError ? error.code : 'SOCIAL_PUBLICATION_FAILED';
      const uncertain = error instanceof SocialProviderError ? error.uncertain : externalStarted;
      await this.pool.query('UPDATE social_publications SET state=$2,error_code=$3,updated_at=now() WHERE id=$1', [job.id, uncertain ? 'unknown' : 'failed', code]);
    }
  }
  async dispatch() {
    // A lost process may have already uploaded externally. Never automatically repeat the POST.
    await this.pool.query("UPDATE social_publications SET state=CASE WHEN provider='tiktok' AND remote_id IS NOT NULL THEN 'processing' ELSE 'unknown' END,error_code='SOCIAL_UPLOAD_OUTCOME_UNKNOWN',updated_at=now() WHERE state='uploading' AND updated_at<now()-interval '10 minutes'");
    const next = (await this.pool.query<Job>("UPDATE social_publications SET state='uploading',updated_at=now() WHERE id=(SELECT id FROM social_publications WHERE state='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *")).rows[0];
    if (next) await this.upload(next);
    const pending = (await this.pool.query<Job>("SELECT * FROM social_publications WHERE state='processing' AND provider='tiktok' AND updated_at<now()-interval '5 seconds' ORDER BY updated_at LIMIT 5")).rows;
    for (const job of pending) {
      try {
        const status = await this.providers.tiktokStatus(await this.accessToken(job.user_id, job.provider), job.remote_id!);
        const state = status === 'SEND_TO_USER_INBOX' ? 'inbox' : status === 'PUBLISH_COMPLETE' ? 'published' : status === 'FAILED' ? 'failed' : 'processing';
        await this.pool.query('UPDATE social_publications SET state=$2,error_code=$3,updated_at=now() WHERE id=$1', [job.id, state, state === 'failed' ? 'TIKTOK_PROCESSING_FAILED' : null]);
      } catch (error) {
        if (error instanceof SocialProviderError && error.code === 'SOCIAL_RECONNECT_REQUIRED') await this.pool.query("UPDATE social_publications SET state='unknown',error_code=$2,updated_at=now() WHERE id=$1", [job.id, error.code]);
        else await this.pool.query('UPDATE social_publications SET updated_at=now() WHERE id=$1', [job.id]);
      }
    }
  }
  onModuleInit() {
    this.timer = setInterval(() => { if (!this.working) this.working = this.dispatch().catch(() => logger.warn({ code: 'SOCIAL_PUBLICATION_RETRY' })).finally(() => { this.working = undefined; }); }, 2000);
    this.timer.unref();
  }
  async onModuleDestroy() { clearInterval(this.timer); this.abort.abort(); await this.working; }
}
