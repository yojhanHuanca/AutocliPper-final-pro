import { sql } from 'drizzle-orm';
import { pgTable, pgEnum, uuid, text, integer, timestamp, jsonb, index, check } from 'drizzle-orm/pg-core';
import type { MediaMetadata } from '../domain/inspection.js';

export const taskStatus = pgEnum('inspection_status', ['queued', 'running', 'succeeded', 'failed']);
export const inspectionTasks = pgTable('inspection_tasks', {
  id: uuid().primaryKey(), workspaceId: uuid('workspace_id').notNull(),
  objectKey: text('object_key').notNull(), expectedBytes: integer('expected_bytes').notNull(), expectedEtag: text('expected_etag').notNull(),
  status: taskStatus().notNull().default('queued'), correlationId: uuid('correlation_id').notNull(),
  attempts: integer().notNull().default(0), result: jsonb().$type<MediaMetadata>(), errorCode: text('error_code'),
  startedAt: timestamp('started_at', { withTimezone: true }), finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  index('inspection_workspace_created_idx').on(t.workspaceId, t.createdAt), index('inspection_status_idx').on(t.status),
  check('positive_bytes', sql`${t.expectedBytes} > 0`), check('nonnegative_attempts', sql`${t.attempts} >= 0`),
  check('terminal_has_finished', sql`(${t.status} IN ('succeeded', 'failed')) = (${t.finishedAt} IS NOT NULL)`),
  check('success_has_result', sql`(${t.status} = 'succeeded') = (${t.result} IS NOT NULL)`)
]);
export const inspectionOutbox = pgTable('inspection_outbox', {
  taskId: uuid('task_id').primaryKey().references(() => inspectionTasks.id, { onDelete: 'cascade' }),
  correlationId: uuid('correlation_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true })
}, t => [index('inspection_outbox_pending_idx').on(t.createdAt).where(sql`${t.deliveredAt} IS NULL`)]);
