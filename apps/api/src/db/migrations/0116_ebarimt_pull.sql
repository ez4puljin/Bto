-- ebarimt-check (ADR-0228): e-Barimt's API connection, and a month's file that came from the API
-- (source API, no stored object). Only adds: a new table, a new column with a default, file_id
-- made nullable, and checks every existing row (all uploads) already meets.
CREATE TABLE "ebarimt_check_connection" (
	"id" smallint PRIMARY KEY NOT NULL,
	"environment" text DEFAULT 'STAGING' NOT NULL,
	"username" text,
	"password_sealed" text,
	"api_key_sealed" text,
	"company_register" text,
	"nightly" boolean DEFAULT false NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_pull_at" timestamp with time zone,
	"last_pull_ok" boolean,
	"last_pull_reason" text,
	"last_pull_message" text,
	"last_pull_receipts" integer,
	"last_pull_masked" integer,
	CONSTRAINT "ebarimt_check_connection_single" CHECK ("ebarimt_check_connection"."id" = 1),
	CONSTRAINT "ebarimt_check_connection_environment" CHECK ("ebarimt_check_connection"."environment" IN ('STAGING', 'PRODUCTION')),
	CONSTRAINT "ebarimt_check_connection_lengths" CHECK (("ebarimt_check_connection"."username" IS NULL OR length("ebarimt_check_connection"."username") BETWEEN 1 AND 100)
        AND ("ebarimt_check_connection"."company_register" IS NULL OR length("ebarimt_check_connection"."company_register") BETWEEN 1 AND 20)
        AND ("ebarimt_check_connection"."last_pull_message" IS NULL OR length("ebarimt_check_connection"."last_pull_message") <= 300)),
	CONSTRAINT "ebarimt_check_connection_pull" CHECK ("ebarimt_check_connection"."last_pull_at" IS NULL OR ("ebarimt_check_connection"."last_pull_ok" IS NOT NULL
        AND ("ebarimt_check_connection"."last_pull_ok" = ("ebarimt_check_connection"."last_pull_reason" IS NULL))))
);
--> statement-breakpoint
ALTER TABLE "ebarimt_check_files" ALTER COLUMN "file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ebarimt_check_files" ADD COLUMN "source" text DEFAULT 'FILE' NOT NULL;--> statement-breakpoint
ALTER TABLE "ebarimt_check_connection" ADD CONSTRAINT "ebarimt_check_connection_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_files" ADD CONSTRAINT "ebarimt_check_files_source" CHECK ("ebarimt_check_files"."source" IN ('FILE', 'API'));--> statement-breakpoint
ALTER TABLE "ebarimt_check_files" ADD CONSTRAINT "ebarimt_check_files_object" CHECK (("ebarimt_check_files"."source" = 'FILE') = ("ebarimt_check_files"."file_id" IS NOT NULL));