import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  check,
  boolean,
} from "drizzle-orm/pg-core";
import type { MediaMetadata } from "../domain/inspection.js";

export const taskStatus = pgEnum("inspection_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export const inspectionTasks = pgTable(
  "inspection_tasks",
  {
    id: uuid().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    objectKey: text("object_key").notNull(),
    expectedBytes: integer("expected_bytes").notNull(),
    expectedEtag: text("expected_etag").notNull(),
    expectedSha256: text("expected_sha256"),
    status: taskStatus().notNull().default("queued"),
    correlationId: uuid("correlation_id").notNull(),
    attempts: integer().notNull().default(0),
    result: jsonb().$type<MediaMetadata>(),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("inspection_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("inspection_status_idx").on(t.status),
    check("positive_bytes", sql`${t.expectedBytes} > 0`),
    check("nonnegative_attempts", sql`${t.attempts} >= 0`),
    check(
      "terminal_has_finished",
      sql`(${t.status} IN ('succeeded', 'failed')) = (${t.finishedAt} IS NOT NULL)`,
    ),
    check(
      "success_has_result",
      sql`(${t.status} = 'succeeded') = (${t.result} IS NOT NULL)`,
    ),
  ],
);

export const processingTasks = pgTable("processing_tasks", {
  id: uuid().primaryKey(), workspaceId: uuid("workspace_id").notNull(),
  inspectionId: uuid("inspection_id").notNull().references(()=>inspectionTasks.id),
  secondaryInspectionId:uuid("secondary_inspection_id").references(()=>inspectionTasks.id),
  spec: jsonb().notNull(), requestHash: text("request_hash").notNull(),
  status: text().notNull().default("queued"), correlationId: uuid("correlation_id").notNull(),
  attempts: integer().notNull().default(0), cancelRequested: boolean("cancel_requested").notNull().default(false),
  cleanupPending: boolean("cleanup_pending").notNull().default(false), result: jsonb(), errorCode:text("error_code"),
  startedAt:timestamp("started_at",{withTimezone:true}), finishedAt:timestamp("finished_at",{withTimezone:true}),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  index("processing_workspace_created_idx").on(t.workspaceId,t.createdAt),index("processing_status_idx").on(t.status),
  check("processing_valid_status",sql`${t.status} IN ('queued','running','succeeded','failed','cancelled')`),
  check("processing_terminal_finished",sql`(${t.status} IN ('succeeded','failed','cancelled')) = (${t.finishedAt} IS NOT NULL)`),
  check("processing_success_result",sql`(${t.status} = 'succeeded') = (${t.result} IS NOT NULL)`),
  check("processing_attempts_nonnegative",sql`${t.attempts} >= 0`),
  check("secondary_inspection_matches_spec",sql`${t.secondaryInspectionId} IS NOT DISTINCT FROM (${t.spec}->'splitScreen'->>'secondaryUploadId')::uuid`),
]);
export const processingOutbox = pgTable("processing_outbox", {
  taskId:uuid("task_id").primaryKey().references(()=>processingTasks.id,{onDelete:"cascade"}),
  createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(), deliveredAt:timestamp("delivered_at",{withTimezone:true}),
},t=>[index("processing_outbox_pending_idx").on(t.createdAt).where(sql`${t.deliveredAt} IS NULL`)]);
export const inspectionOutbox = pgTable(
  "inspection_outbox",
  {
    taskId: uuid("task_id")
      .primaryKey()
      .references(() => inspectionTasks.id, { onDelete: "cascade" }),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    index("inspection_outbox_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.deliveredAt} IS NULL`),
  ],
);
