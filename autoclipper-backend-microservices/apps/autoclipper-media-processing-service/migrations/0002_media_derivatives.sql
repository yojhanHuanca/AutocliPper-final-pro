CREATE TABLE "processing_outbox" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processing_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"spec" jsonb NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"correlation_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"cleanup_pending" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"error_code" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processing_valid_status" CHECK ("processing_tasks"."status" IN ('queued','running','succeeded','failed','cancelled')),
	CONSTRAINT "processing_terminal_finished" CHECK (("processing_tasks"."status" IN ('succeeded','failed','cancelled')) = ("processing_tasks"."finished_at" IS NOT NULL)),
	CONSTRAINT "processing_success_result" CHECK (("processing_tasks"."status" = 'succeeded') = ("processing_tasks"."result" IS NOT NULL)),
	CONSTRAINT "processing_attempts_nonnegative" CHECK ("processing_tasks"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "processing_outbox" ADD CONSTRAINT "processing_outbox_task_id_processing_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."processing_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_tasks" ADD CONSTRAINT "processing_tasks_inspection_id_inspection_tasks_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspection_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "processing_outbox_pending_idx" ON "processing_outbox" USING btree ("created_at") WHERE "processing_outbox"."delivered_at" IS NULL;--> statement-breakpoint
CREATE INDEX "processing_workspace_created_idx" ON "processing_tasks" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "processing_status_idx" ON "processing_tasks" USING btree ("status");