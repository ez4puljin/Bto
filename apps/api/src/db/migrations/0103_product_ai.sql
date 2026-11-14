CREATE TABLE "ai_picture_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"api_key_sealed" text,
	"api_key_hint" text,
	"stamp_file_id" bigint,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_picture_settings_single" CHECK ("ai_picture_settings"."id" = 1),
	CONSTRAINT "ai_picture_settings_key" CHECK (("ai_picture_settings"."api_key_sealed" IS NULL) = ("ai_picture_settings"."api_key_hint" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "ai_usage" DROP CONSTRAINT "ai_usage_purpose";--> statement-breakpoint
ALTER TABLE "ai_picture_settings" ADD CONSTRAINT "ai_picture_settings_stamp_file_id_files_id_fk" FOREIGN KEY ("stamp_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_picture_settings" ADD CONSTRAINT "ai_picture_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_purpose" CHECK ("ai_usage"."purpose" IN ('ASK', 'INVOICE_CHECK', 'PRODUCT_READ'));--> statement-breakpoint
-- Hand-written (ADR-0198): the row of product-picture settings is never deleted, like ai_settings.
REVOKE DELETE, TRUNCATE ON "ai_picture_settings" FROM app;
