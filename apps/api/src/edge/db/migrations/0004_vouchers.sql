CREATE TABLE "edge_voucher_uses" (
	"code" text PRIMARY KEY NOT NULL,
	"voucher_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"sale_client_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edge_voucher_uses_kind" CHECK ("edge_voucher_uses"."kind" IN ('COUPON', 'PARTNER')),
	CONSTRAINT "edge_voucher_uses_amount" CHECK ("edge_voucher_uses"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "edge_sales" ADD COLUMN "voucher_amount" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "edge_state" ADD COLUMN "vouchers_version" text;--> statement-breakpoint
ALTER TABLE "edge_state" ADD COLUMN "vouchers" jsonb;--> statement-breakpoint
ALTER TABLE "edge_state" ADD COLUMN "vouchers_pulled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "edge_voucher_uses" ADD CONSTRAINT "edge_voucher_uses_sale_client_id_edge_sales_client_id_fk" FOREIGN KEY ("sale_client_id") REFERENCES "public"."edge_sales"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edge_voucher_uses_sale_idx" ON "edge_voucher_uses" USING btree ("sale_client_id");