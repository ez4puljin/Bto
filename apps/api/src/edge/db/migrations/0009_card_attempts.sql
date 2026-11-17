CREATE TABLE "edge_card_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'SALE' NOT NULL,
	"provider" text NOT NULL,
	"till_code" text NOT NULL,
	"shift_client_id" uuid,
	"cashier_user_id" bigint NOT NULL,
	"cashier_name" text NOT NULL,
	"sale_client_id" uuid,
	"payment_type_id" bigint,
	"ref_no" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"terminal_id" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"source" text,
	"response" jsonb,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"resolved_by_user_id" bigint,
	CONSTRAINT "edge_card_attempts_ref_no_key" UNIQUE("ref_no"),
	CONSTRAINT "edge_card_attempts_kind" CHECK ("edge_card_attempts"."kind" IN ('SALE', 'SETTLEMENT')),
	CONSTRAINT "edge_card_attempts_provider" CHECK ("edge_card_attempts"."provider" IN ('KHAN')),
	CONSTRAINT "edge_card_attempts_status" CHECK ("edge_card_attempts"."status" IN ('PENDING', 'APPROVED', 'DECLINED', 'FAILED', 'VOIDED')),
	CONSTRAINT "edge_card_attempts_source" CHECK (("edge_card_attempts"."status" = 'PENDING') = ("edge_card_attempts"."source" IS NULL) AND ("edge_card_attempts"."source" IS NULL OR "edge_card_attempts"."source" IN ('TERMINAL', 'CASHIER'))),
	CONSTRAINT "edge_card_attempts_amount" CHECK (("edge_card_attempts"."kind" = 'SALE' AND "edge_card_attempts"."amount" > 0) OR ("edge_card_attempts"."kind" = 'SETTLEMENT' AND "edge_card_attempts"."amount" = 0)),
	CONSTRAINT "edge_card_attempts_used" CHECK ("edge_card_attempts"."used_at" IS NULL OR ("edge_card_attempts"."kind" = 'SALE' AND "edge_card_attempts"."status" = 'APPROVED' AND "edge_card_attempts"."sale_client_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "edge_card_attempts" ADD CONSTRAINT "edge_card_attempts_shift_client_id_edge_shifts_client_id_fk" FOREIGN KEY ("shift_client_id") REFERENCES "public"."edge_shifts"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "edge_card_attempts_one_pending_per_till" ON "edge_card_attempts" USING btree ("till_code") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "edge_card_attempts_till_idx" ON "edge_card_attempts" USING btree ("till_code","created_at");--> statement-breakpoint
CREATE INDEX "edge_card_attempts_sale_idx" ON "edge_card_attempts" USING btree ("sale_client_id");