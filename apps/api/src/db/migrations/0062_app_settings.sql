CREATE TABLE "app_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"assortment_segment_id" bigint,
	"home_promotions" boolean DEFAULT true NOT NULL,
	"home_discounts" boolean DEFAULT true NOT NULL,
	"home_new" boolean DEFAULT true NOT NULL,
	"min_order_amount" numeric(14, 2),
	"app_name" text,
	"app_color" text,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_single" CHECK ("app_settings"."id" = 1),
	CONSTRAINT "app_settings_min_order" CHECK ("app_settings"."min_order_amount" IS NULL OR "app_settings"."min_order_amount" >= 0),
	CONSTRAINT "app_settings_name" CHECK ("app_settings"."app_name" IS NULL OR length("app_settings"."app_name") BETWEEN 1 AND 40),
	CONSTRAINT "app_settings_color" CHECK ("app_settings"."app_color" IS NULL OR "app_settings"."app_color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ADR-0127: the settings row is rewritten in place, never deleted.
REVOKE DELETE, TRUNCATE ON "app_settings" FROM app;
