CREATE TABLE "app_banners" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app_banners_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"image_file_id" bigint NOT NULL,
	"title" text NOT NULL,
	"link_kind" text DEFAULT 'NONE' NOT NULL,
	"link_id" bigint,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"position" smallint NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" bigint,
	"updated_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_banners_image_file_key" UNIQUE("image_file_id"),
	CONSTRAINT "app_banners_position" UNIQUE("position") DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "app_banners_title" CHECK (length(btrim("app_banners"."title")) BETWEEN 1 AND 80),
	CONSTRAINT "app_banners_link_kind" CHECK ("app_banners"."link_kind" IN ('NONE', 'SEGMENT', 'CATEGORY', 'PRODUCT')),
	CONSTRAINT "app_banners_link" CHECK (("app_banners"."link_kind" = 'NONE') = ("app_banners"."link_id" IS NULL)),
	CONSTRAINT "app_banners_period" CHECK ("app_banners"."valid_to" IS NULL OR "app_banners"."valid_to" > "app_banners"."valid_from"),
	CONSTRAINT "app_banners_position_range" CHECK ("app_banners"."position" >= 1)
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "image_file_id" bigint;--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "app_position" smallint;--> statement-breakpoint
ALTER TABLE "app_banners" ADD CONSTRAINT "app_banners_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_banners" ADD CONSTRAINT "app_banners_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_banners" ADD CONSTRAINT "app_banners_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_image_file_key" UNIQUE("image_file_id");--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_app_position" UNIQUE("app_position") DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_image_top_level" CHECK ("categories"."image_file_id" IS NULL OR "categories"."parent_id" IS NULL);--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_app_position_live_product" CHECK ("segments"."app_position" IS NULL OR ("segments"."app_position" >= 1 AND "segments"."entity" = 'PRODUCT' AND "segments"."archived_at" IS NULL));--> statement-breakpoint
-- By hand (ADR-0092, ADR-0093): banners are archived, never deleted; the two position constraints
-- above are DEFERRABLE INITIALLY IMMEDIATE so a swap of two places is one UPDATE (checked at the
-- end of the statement, never as late as the commit).
REVOKE DELETE, TRUNCATE ON "app_banners" FROM app;
