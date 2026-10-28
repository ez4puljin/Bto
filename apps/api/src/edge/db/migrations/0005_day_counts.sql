CREATE TABLE "edge_day_counts" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"till_code" text NOT NULL,
	"day" text NOT NULL,
	"cashier_user_id" bigint NOT NULL,
	"cashier_name" text NOT NULL,
	"counts" jsonb NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"counted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "edge_sales" ADD COLUMN "transfer_amount" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "edge_day_counts_till_day_idx" ON "edge_day_counts" USING btree ("till_code","day","counted_at");