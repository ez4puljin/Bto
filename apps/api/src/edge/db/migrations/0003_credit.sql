ALTER TABLE "edge_sales" ADD COLUMN "credit_amount" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "edge_sales" ADD COLUMN "customer_id" bigint;--> statement-breakpoint
ALTER TABLE "edge_state" ADD COLUMN "customers_version" text;--> statement-breakpoint
ALTER TABLE "edge_state" ADD COLUMN "customers" jsonb;--> statement-breakpoint
ALTER TABLE "edge_state" ADD COLUMN "customers_pulled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "edge_sales_customer_idx" ON "edge_sales" USING btree ("customer_id");--> statement-breakpoint
ALTER TABLE "edge_sales" ADD CONSTRAINT "edge_sales_credit" CHECK ("edge_sales"."credit_amount" >= 0 AND ("edge_sales"."credit_amount" = 0 OR "edge_sales"."customer_id" IS NOT NULL));