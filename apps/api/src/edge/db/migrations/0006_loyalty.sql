CREATE TABLE "edge_member_pin_attempts" (
	"member_id" bigint PRIMARY KEY NOT NULL,
	"pin_version" integer NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "edge_sales" ADD COLUMN "member_id" bigint;--> statement-breakpoint
ALTER TABLE "edge_sales" ADD COLUMN "points_amount" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "edge_sales" ADD COLUMN "points_delta" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "edge_sales" ADD COLUMN "spend_delta" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "edge_state" ADD COLUMN "loyalty_version" text;--> statement-breakpoint
ALTER TABLE "edge_state" ADD COLUMN "loyalty" jsonb;--> statement-breakpoint
ALTER TABLE "edge_state" ADD COLUMN "loyalty_pulled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "edge_sales_member_idx" ON "edge_sales" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "edge_sales" ADD CONSTRAINT "edge_sales_points" CHECK ("edge_sales"."points_amount" >= 0 AND ("edge_sales"."member_id" IS NOT NULL OR ("edge_sales"."points_amount" = 0 AND "edge_sales"."points_delta" = 0 AND "edge_sales"."spend_delta" = 0)));