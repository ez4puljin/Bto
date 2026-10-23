-- ADR-0104: returns at the till (a sale row's kind and the sale it refunds), the void log and the
-- parked baskets of each till.
CREATE TABLE "edge_parked" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"till_code" text NOT NULL,
	"cashier_user_id" bigint NOT NULL,
	"cashier_name" text NOT NULL,
	"parked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lines" jsonb NOT NULL,
	"item_count" integer NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"preview" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edge_voids" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"till_code" text NOT NULL,
	"cashier_user_id" bigint NOT NULL,
	"approved_by_user_id" bigint,
	"reason" text NOT NULL,
	"voided_at" timestamp with time zone NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"doc" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "edge_sales" ADD COLUMN "kind" text DEFAULT 'SALE' NOT NULL;--> statement-breakpoint
ALTER TABLE "edge_sales" ADD COLUMN "refunds_client_id" uuid;--> statement-breakpoint
CREATE INDEX "edge_parked_till_idx" ON "edge_parked" USING btree ("till_code","parked_at");--> statement-breakpoint
CREATE INDEX "edge_voids_till_idx" ON "edge_voids" USING btree ("till_code","voided_at");--> statement-breakpoint
CREATE INDEX "edge_sales_refunds_idx" ON "edge_sales" USING btree ("refunds_client_id");--> statement-breakpoint
ALTER TABLE "edge_sales" ADD CONSTRAINT "edge_sales_kind" CHECK ("edge_sales"."kind" IN ('SALE', 'RETURN'));