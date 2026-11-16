CREATE TABLE "erkhet_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"base_url" text,
	"company_id" text,
	"username" text,
	"password_sealed" text,
	"nightly" boolean DEFAULT true NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erkhet_settings_single" CHECK ("erkhet_settings"."id" = 1),
	CONSTRAINT "erkhet_settings_url" CHECK ("erkhet_settings"."base_url" IS NULL OR "erkhet_settings"."base_url" ~ '^https://[^/]+$'),
	CONSTRAINT "erkhet_settings_company" CHECK ("erkhet_settings"."company_id" IS NULL OR "erkhet_settings"."company_id" ~ '^[0-9]{4,20}$')
);
--> statement-breakpoint
CREATE TABLE "erkhet_sync_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "erkhet_sync_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"issue" text NOT NULL,
	"erkhet_code" text,
	"erkhet_name" text,
	"erkhet_group" text,
	"erkhet_barcodes" text,
	"erkhet_price" numeric(14, 2),
	"bto_id" bigint,
	"bto_code" text,
	"bto_name" text,
	"bto_price" numeric(14, 2),
	"plan" jsonb,
	"resolution" text,
	"resolved_by" bigint,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "erkhet_sync_items_kind" CHECK ("erkhet_sync_items"."kind" IN ('CUSTOMER', 'PRODUCT')),
	CONSTRAINT "erkhet_sync_items_issue" CHECK ("erkhet_sync_items"."issue" IN ('MISSING_IN_BTO', 'GROUP_NOT_TAKEN', 'NAME_DIFFERS', 'PRICE_DIFFERS', 'NO_BTO_PRICE', 'INACTIVE_IN_BTO', 'AMBIGUOUS', 'NO_BARCODE', 'MISSING_IN_ERKHET')),
	CONSTRAINT "erkhet_sync_items_resolution" CHECK (("erkhet_sync_items"."resolution" IS NULL) = ("erkhet_sync_items"."resolved_at" IS NULL) AND ("erkhet_sync_items"."resolution" IS NULL OR "erkhet_sync_items"."resolution" IN ('APPLIED', 'STALE', 'REFUSED'))),
	CONSTRAINT "erkhet_sync_items_side" CHECK ("erkhet_sync_items"."erkhet_code" IS NOT NULL OR "erkhet_sync_items"."bto_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "erkhet_sync_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "erkhet_sync_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"trigger" text NOT NULL,
	"business_day" date NOT NULL,
	"active_slot" smallint,
	"started_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"failure" text,
	"summary" jsonb,
	"item_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "erkhet_sync_runs_status" CHECK ("erkhet_sync_runs"."status" IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
	CONSTRAINT "erkhet_sync_runs_trigger" CHECK ("erkhet_sync_runs"."trigger" IN ('MANUAL', 'NIGHTLY')),
	CONSTRAINT "erkhet_sync_runs_failure" CHECK (("erkhet_sync_runs"."failure" IS NOT NULL) = ("erkhet_sync_runs"."status" = 'FAILED') AND ("erkhet_sync_runs"."failure" IS NULL OR "erkhet_sync_runs"."failure" IN ('NOT_CONFIGURED', 'KEY_UNREADABLE', 'LOGIN_FAILED', 'COMPANY_UNREACHABLE', 'UNREACHABLE', 'TIMEOUT', 'UNEXPECTED_ANSWER', 'UNEXPECTED_FILE', 'INTERRUPTED', 'INTERNAL'))),
	CONSTRAINT "erkhet_sync_runs_slot" CHECK (("erkhet_sync_runs"."active_slot" IS NOT NULL) = ("erkhet_sync_runs"."status" IN ('QUEUED', 'RUNNING')) AND coalesce("erkhet_sync_runs"."active_slot", 1) = 1),
	CONSTRAINT "erkhet_sync_runs_done" CHECK ("erkhet_sync_runs"."status" <> 'DONE' OR ("erkhet_sync_runs"."summary" IS NOT NULL AND "erkhet_sync_runs"."finished_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "erkhet_settings" ADD CONSTRAINT "erkhet_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erkhet_sync_items" ADD CONSTRAINT "erkhet_sync_items_run_id_erkhet_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."erkhet_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erkhet_sync_items" ADD CONSTRAINT "erkhet_sync_items_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erkhet_sync_runs" ADD CONSTRAINT "erkhet_sync_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "erkhet_sync_items_list" ON "erkhet_sync_items" USING btree ("run_id","kind","issue","id");--> statement-breakpoint
CREATE UNIQUE INDEX "erkhet_sync_runs_one_active" ON "erkhet_sync_runs" USING btree ("active_slot");--> statement-breakpoint
CREATE UNIQUE INDEX "erkhet_sync_runs_nightly_day" ON "erkhet_sync_runs" USING btree ("business_day") WHERE "erkhet_sync_runs"."trigger" = 'NIGHTLY';