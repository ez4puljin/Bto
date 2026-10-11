CREATE TABLE "import_documents" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_documents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" bigint NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"adjustment_id" bigint NOT NULL,
	"reversal_adjustment_id" bigint,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_documents_reversal" CHECK ("import_documents"."active" = ("import_documents"."reversal_adjustment_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"file_id" bigint NOT NULL,
	"file_name" text NOT NULL,
	"status" text DEFAULT 'UPLOADED' NOT NULL,
	"phase" text,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"warning_rows" integer DEFAULT 0 NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"summary" jsonb,
	"last_error" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"committed_by" bigint,
	"reverted_at" timestamp with time zone,
	"reverted_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_jobs_kind" CHECK ("import_jobs"."kind" IN ('PRODUCTS', 'CUSTOMERS', 'SUPPLIERS', 'OPENING_STOCK')),
	CONSTRAINT "import_jobs_status" CHECK ("import_jobs"."status" IN ('UPLOADED', 'VALIDATING', 'VALIDATED', 'INVALID', 'COMMITTING', 'COMMITTED', 'FAILED', 'REVERTING', 'REVERTED')),
	CONSTRAINT "import_jobs_counts" CHECK ("import_jobs"."total_rows" >= 0 AND "import_jobs"."processed_rows" >= 0 AND "import_jobs"."error_rows" >= 0 AND "import_jobs"."warning_rows" >= 0),
	CONSTRAINT "import_jobs_file_name" CHECK (length("import_jobs"."file_name") BETWEEN 1 AND 255),
	CONSTRAINT "import_jobs_committed" CHECK (("import_jobs"."status" IN ('COMMITTED', 'REVERTING', 'REVERTED')) = ("import_jobs"."committed_at" IS NOT NULL)),
	CONSTRAINT "import_jobs_reverted" CHECK (("import_jobs"."status" = 'REVERTED') = ("import_jobs"."reverted_at" IS NOT NULL)),
	CONSTRAINT "import_jobs_last_error" CHECK ("import_jobs"."last_error" IS NULL OR length("import_jobs"."last_error") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_rows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" bigint NOT NULL,
	"row_no" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"cell_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"normalized" jsonb,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_count" smallint DEFAULT 0 NOT NULL,
	"warning_count" smallint DEFAULT 0 NOT NULL,
	"action" text,
	"changes" jsonb,
	"target_id" bigint,
	CONSTRAINT "import_rows_job_row_key" UNIQUE("job_id","row_no"),
	CONSTRAINT "import_rows_row_no" CHECK ("import_rows"."row_no" > 0),
	CONSTRAINT "import_rows_action" CHECK ("import_rows"."action" IS NULL OR "import_rows"."action" IN ('CREATE', 'UPDATE', 'UNCHANGED')),
	CONSTRAINT "import_rows_counts" CHECK ("import_rows"."error_count" >= 0 AND "import_rows"."warning_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "import_documents" ADD CONSTRAINT "import_documents_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_documents" ADD CONSTRAINT "import_documents_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_documents" ADD CONSTRAINT "import_documents_adjustment_id_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."adjustments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_documents" ADD CONSTRAINT "import_documents_reversal_adjustment_id_adjustments_id_fk" FOREIGN KEY ("reversal_adjustment_id") REFERENCES "public"."adjustments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_reverted_by_users_id_fk" FOREIGN KEY ("reverted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_documents_active_warehouse" ON "import_documents" USING btree ("warehouse_id") WHERE "import_documents"."active";--> statement-breakpoint
CREATE INDEX "import_documents_job_idx" ON "import_documents" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "import_jobs_status_idx" ON "import_jobs" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "import_rows_errors_idx" ON "import_rows" USING btree ("job_id","row_no") WHERE "import_rows"."error_count" > 0;--> statement-breakpoint
CREATE INDEX "import_rows_warnings_idx" ON "import_rows" USING btree ("job_id","row_no") WHERE "import_rows"."warning_count" > 0;--> statement-breakpoint

-- Hand-written (ADR-0036): import jobs and their opening-stock documents are kept for the history and
-- the revert; the rows of a job are replaced when its sheet is read again (a retried validation).
REVOKE DELETE, TRUNCATE ON "import_jobs", "import_documents" FROM app;
