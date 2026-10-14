CREATE TYPE "public"."inspection_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "inspection_outbox" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inspection_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"expected_bytes" integer NOT NULL,
	"expected_etag" text NOT NULL,
	"status" "inspection_status" DEFAULT 'queued' NOT NULL,
	"correlation_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error_code" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positive_bytes" CHECK ("inspection_tasks"."expected_bytes" > 0),
	CONSTRAINT "nonnegative_attempts" CHECK ("inspection_tasks"."attempts" >= 0),
	CONSTRAINT "terminal_has_finished" CHECK (("inspection_tasks"."status" IN ('succeeded', 'failed')) = ("inspection_tasks"."finished_at" IS NOT NULL)),
	CONSTRAINT "success_has_result" CHECK (("inspection_tasks"."status" = 'succeeded') = ("inspection_tasks"."result" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "inspection_outbox" ADD CONSTRAINT "inspection_outbox_task_id_inspection_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."inspection_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspection_outbox_pending_idx" ON "inspection_outbox" USING btree ("created_at") WHERE "inspection_outbox"."delivered_at" IS NULL;--> statement-breakpoint
CREATE INDEX "inspection_workspace_created_idx" ON "inspection_tasks" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "inspection_status_idx" ON "inspection_tasks" USING btree ("status");