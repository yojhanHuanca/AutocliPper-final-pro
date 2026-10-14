import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { loadMediaConfig } from '@autoclipper/configuration';
import { INSPECTION_QUEUE, inspectionEvent } from '@autoclipper/event-contracts';
import { logger } from '@autoclipper/observability';
import { Queue, Worker, UnrecoverableError, type Job } from 'bullmq';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { Redis } from 'ioredis';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, isNull, inArray, gt, asc } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createS3, redisConnection } from '../infrastructure/connections.js';
import { inspectionOutbox, inspectionTasks } from '../infrastructure/schema.js';
import { inspectObject } from '../infrastructure/probe.js';
import { InspectionError } from '../domain/inspection.js';

@Injectable()
export class InspectionRuntime implements OnModuleInit, OnModuleDestroy {
  readonly config = loadMediaConfig();
  readonly pool = new pg.Pool({ connectionString: this.config.DATABASE_URL, max: 5, connectionTimeoutMillis: 2000, statement_timeout: 5000 });
  readonly db = drizzle(this.pool);
  readonly s3 = createS3(this.config);
  readonly redis = new Redis({ ...redisConnection(this.config.REDIS_URL), lazyConnect: true, maxRetriesPerRequest: 1, commandTimeout: 2000, retryStrategy: () => null });
  readonly queue = new Queue(INSPECTION_QUEUE, { connection: { ...redisConnection(this.config.REDIS_URL), maxRetriesPerRequest: 1, enableOfflineQueue: false } });
  private worker: Worker | undefined;
  private timer: NodeJS.Timeout | undefined;
  private dispatching: Promise<void> | undefined;
  private stopping = false;
  private reconciliationCursor: string | undefined;

  async onModuleInit() {
    this.pool.on('error', () => logger.error({ code: 'DATABASE_CONNECTION_FAILED' }));
    this.redis.on('error', () => logger.error({ code: 'REDIS_CONNECTION_FAILED' }));
    this.queue.on('error', () => logger.error({ code: 'QUEUE_CONNECTION_FAILED' }));
    this.worker = new Worker(INSPECTION_QUEUE, job => this.process(job), {
      connection: { ...redisConnection(this.config.REDIS_URL), maxRetriesPerRequest: null },
      concurrency: this.config.WORKER_CONCURRENCY, limiter: { max: 10, duration: 1000 },
      lockDuration: 120000, maxStalledCount: 2
    });
    this.worker.on('error', () => logger.error({ code: 'WORKER_ERROR' }));
    await this.queue.waitUntilReady();
    await this.dispatch();
    this.timer = setInterval(() => {
      if (!this.stopping && !this.dispatching) this.dispatching = this.dispatch().catch(() => { logger.error({ code: 'OUTBOX_DISPATCH_FAILED' }); }).finally(() => { this.dispatching = undefined; });
    }, 1000);
    this.timer.unref();
  }

  private async dispatch() {
    // PostgreSQL is the source of truth. Restore queue entries lost after a Redis
    // outage/restore, even if the outbox was previously acknowledged.
    const active = await this.db.select({ id: inspectionTasks.id }).from(inspectionTasks).where(and(
      inArray(inspectionTasks.status, ['queued', 'running']), this.reconciliationCursor ? gt(inspectionTasks.id, this.reconciliationCursor) : undefined
    )).orderBy(asc(inspectionTasks.id)).limit(100);
    this.reconciliationCursor = active.length === 100 ? active.at(-1)?.id : undefined;
    for (const task of active) {
      const job = await this.queue.getJob(task.id);
      if (!job) await this.db.update(inspectionOutbox).set({ deliveredAt: null }).where(eq(inspectionOutbox.taskId, task.id));
      else if (await job.getState() === 'failed') await this.db.update(inspectionTasks).set({ status: 'failed', errorCode: 'RECOVERY_RETRIES_EXHAUSTED', finishedAt: new Date() }).where(and(eq(inspectionTasks.id, task.id), inArray(inspectionTasks.status, ['queued', 'running'])));
    }
    const events = await this.db.select().from(inspectionOutbox).where(isNull(inspectionOutbox.deliveredAt)).orderBy(asc(inspectionOutbox.createdAt)).limit(50);
    for (const event of events) {
      if (this.stopping) break;
      await this.queue.add('inspect', { version: 1, taskId: event.taskId, correlationId: event.correlationId }, {
        jobId: event.taskId, attempts: 3, backoff: { type: 'exponential', delay: 1000 },
        // Retain IDs for deduplication. Cleanup is an explicit operational action.
        removeOnComplete: false, removeOnFail: false
      });
      await this.db.update(inspectionOutbox).set({ deliveredAt: new Date() }).where(and(eq(inspectionOutbox.taskId, event.taskId), isNull(inspectionOutbox.deliveredAt)));
    }
  }

  private async process(job: Job) {
    const parsed = inspectionEvent.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError('INVALID_EVENT');
    const event = parsed.data;
    const [task] = await this.db.select().from(inspectionTasks).where(eq(inspectionTasks.id, event.taskId));
    if (!task || task.correlationId !== event.correlationId) throw new UnrecoverableError('TASK_NOT_FOUND');
    if (task.status === 'succeeded' || task.status === 'failed') return;
    const claimed = await this.db.update(inspectionTasks).set({ status: 'running', attempts: job.attemptsMade + 1, startedAt: new Date(), errorCode: null }).where(and(eq(inspectionTasks.id, task.id), inArray(inspectionTasks.status, ['queued', 'running']))).returning({ id: inspectionTasks.id });
    if (!claimed.length) return;
    const started = performance.now();
    try {
      const result = await inspectObject(this.s3, this.config, task);
      await this.db.update(inspectionTasks).set({ status: 'succeeded', result, finishedAt: new Date() }).where(and(eq(inspectionTasks.id, task.id), inArray(inspectionTasks.status, ['queued', 'running'])));
      logger.info({ code: 'INSPECTION_COMPLETED', taskId: task.id, correlationId: event.correlationId, durationMs: Math.round(performance.now() - started), bytes: task.expectedBytes });
    } catch (error) {
      const code = error instanceof InspectionError ? error.code : 'STORAGE_OR_NETWORK_ERROR';
      const terminal = (error instanceof InspectionError && !error.retryable) || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.db.update(inspectionTasks).set({ status: terminal ? 'failed' : 'queued', errorCode: code, finishedAt: terminal ? new Date() : null }).where(and(eq(inspectionTasks.id, task.id), inArray(inspectionTasks.status, ['queued', 'running'])));
      logger.warn({ code, taskId: task.id, correlationId: event.correlationId });
      if (terminal) throw new UnrecoverableError(code);
      // BullMQ persists errors: deliberately discard the potentially sensitive cause.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(code);
    }
  }

  async readiness() {
    const checks: Record<string, 'ok' | 'unavailable'> = {};
    const tasks: Record<string, () => Promise<unknown>> = {
      postgres: () => this.pool.query('SELECT 1 FROM inspection_tasks LIMIT 1'),
      redis: async () => { if (this.redis.status === 'wait' || this.redis.status === 'end') await this.redis.connect(); await this.redis.ping(); },
      storage: () => this.s3.send(new HeadBucketCommand({ Bucket: this.config.S3_BUCKET })),
      ffprobe: () => promisify(execFile)(this.config.FFPROBE_PATH, ['-version'], { timeout: 2000, windowsHide: true, maxBuffer: 65536 }),
      ffmpeg: () => promisify(execFile)(this.config.FFMPEG_PATH, ['-version'], { timeout: 2000, windowsHide: true, maxBuffer: 65536 })
    };
    await Promise.all(Object.entries(tasks).map(async ([name, check]) => { try { await check(); checks[name] = 'ok'; } catch { checks[name] = 'unavailable'; } }));
    if (!this.worker?.isRunning() || this.stopping) checks['worker'] = 'unavailable'; else checks['worker'] = 'ok';
    return { status: Object.values(checks).every(v => v === 'ok') ? 'ok' as const : 'unavailable' as const, checks };
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.dispatching;
    await this.worker?.close();
    await this.queue.close();
    this.redis.disconnect();
    this.s3.destroy();
    await this.pool.end();
  }
}
