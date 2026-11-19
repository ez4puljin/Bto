CREATE TABLE "erxes_deals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "erxes_deals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"erxes_id" text NOT NULL,
	"pipeline_erxes_id" text NOT NULL,
	"name" text,
	"number" text,
	"erxes_created_at" timestamp with time zone,
	"creator_erxes_id" text,
	"creator_name" text,
	"creator_user_id" bigint,
	"status" text DEFAULT 'WAITING' NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"choices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"matched_units" jsonb,
	"raw" jsonb NOT NULL,
	"products" jsonb,
	"field_labels" jsonb,
	"order_id" bigint,
	"customer_id" bigint,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_tried_at" timestamp with time zone,
	"copied_at" timestamp with time zone,
	"copied_by" bigint,
	"dismissed_at" timestamp with time zone,
	"dismissed_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erxes_deals_status" CHECK ("erxes_deals"."status" IN ('WAITING', 'COPIED', 'DISMISSED')),
	CONSTRAINT "erxes_deals_copied" CHECK (("erxes_deals"."status" = 'COPIED') = ("erxes_deals"."order_id" IS NOT NULL) AND ("erxes_deals"."order_id" IS NULL) = ("erxes_deals"."copied_at" IS NULL)),
	CONSTRAINT "erxes_deals_dismissed" CHECK (("erxes_deals"."status" = 'DISMISSED') = ("erxes_deals"."dismissed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "erxes_pipelines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "erxes_pipelines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"erxes_id" text NOT NULL,
	"name" text NOT NULL,
	"board_erxes_id" text,
	"board_name" text,
	"blocked" boolean DEFAULT false NOT NULL,
	"gone" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"enabled_at" timestamp with time zone,
	"enabled_by" bigint,
	"bto_pipeline_id" bigint,
	"bto_stage_id" bigint,
	"last_seen_created_at" timestamp with time zone,
	"last_pull_at" timestamp with time zone,
	"first_pull" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erxes_pipelines_enabled" CHECK (NOT "erxes_pipelines"."enabled" OR "erxes_pipelines"."enabled_at" IS NOT NULL),
	CONSTRAINT "erxes_pipelines_blocked" CHECK (NOT ("erxes_pipelines"."enabled" AND "erxes_pipelines"."blocked")),
	CONSTRAINT "erxes_pipelines_place" CHECK (("erxes_pipelines"."bto_pipeline_id" IS NULL) = ("erxes_pipelines"."bto_stage_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "erxes_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"base_url" text,
	"email" text,
	"password_sealed" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_pull_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_failure" text,
	"last_failure_detail" text,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erxes_settings_single" CHECK ("erxes_settings"."id" = 1),
	CONSTRAINT "erxes_settings_url" CHECK ("erxes_settings"."base_url" IS NULL OR "erxes_settings"."base_url" ~ '^https://[^/]+$'),
	CONSTRAINT "erxes_settings_failure" CHECK ("erxes_settings"."last_failure" IS NULL OR "erxes_settings"."last_failure" IN ('NOT_CONFIGURED', 'KEY_UNREADABLE', 'LOGIN_FAILED', 'UNREACHABLE', 'TIMEOUT', 'UNEXPECTED_ANSWER', 'INTERNAL'))
);
--> statement-breakpoint
CREATE TABLE "erxes_users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "erxes_users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"erxes_id" text NOT NULL,
	"email" text,
	"username" text,
	"full_name" text,
	"phone" text,
	"bto_user_id" bigint,
	"mapped_by" bigint,
	"mapped_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "erxes_deals" ADD CONSTRAINT "erxes_deals_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erxes_deals" ADD CONSTRAINT "erxes_deals_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erxes_deals" ADD CONSTRAINT "erxes_deals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erxes_deals" ADD CONSTRAINT "erxes_deals_copied_by_users_id_fk" FOREIGN KEY ("copied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erxes_deals" ADD CONSTRAINT "erxes_deals_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erxes_pipelines" ADD CONSTRAINT "erxes_pipelines_enabled_by_users_id_fk" FOREIGN KEY ("enabled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erxes_settings" ADD CONSTRAINT "erxes_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erxes_users" ADD CONSTRAINT "erxes_users_bto_user_id_users_id_fk" FOREIGN KEY ("bto_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erxes_users" ADD CONSTRAINT "erxes_users_mapped_by_users_id_fk" FOREIGN KEY ("mapped_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "erxes_deals_erxes_id" ON "erxes_deals" USING btree ("erxes_id");--> statement-breakpoint
CREATE UNIQUE INDEX "erxes_deals_order" ON "erxes_deals" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "erxes_deals_status_idx" ON "erxes_deals" USING btree ("status","id");--> statement-breakpoint
CREATE UNIQUE INDEX "erxes_pipelines_erxes_id" ON "erxes_pipelines" USING btree ("erxes_id");--> statement-breakpoint
CREATE UNIQUE INDEX "erxes_users_erxes_id" ON "erxes_users" USING btree ("erxes_id");