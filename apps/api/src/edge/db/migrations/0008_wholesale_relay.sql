CREATE TABLE "edge_relay_ops" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "edge_relay_ops_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"receipt_id" bigint NOT NULL,
	"attempt" integer NOT NULL,
	"op" text NOT NULL,
	"doc_number" text NOT NULL,
	"request" jsonb NOT NULL,
	"status" text DEFAULT 'CLAIMED' NOT NULL,
	"outcome" text,
	"error_code" text,
	"ddtd" text,
	"posapi_date" text,
	"merchant_tin" text,
	"merchant_name" text,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"called_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"reported_at" timestamp with time zone,
	CONSTRAINT "edge_relay_ops_attempt" UNIQUE("receipt_id","op","attempt"),
	CONSTRAINT "edge_relay_ops_op" CHECK ("edge_relay_ops"."op" IN ('ISSUE', 'CANCEL')),
	CONSTRAINT "edge_relay_ops_status" CHECK ("edge_relay_ops"."status" IN ('CLAIMED', 'CALLING', 'DONE')),
	CONSTRAINT "edge_relay_ops_outcome" CHECK (("edge_relay_ops"."status" = 'DONE') = ("edge_relay_ops"."outcome" IS NOT NULL) AND ("edge_relay_ops"."outcome" IS NULL OR "edge_relay_ops"."outcome" IN ('ISSUED', 'CANCELLED', 'REFUSED', 'NOT_SENT', 'INDETERMINATE'))),
	CONSTRAINT "edge_relay_ops_reported" CHECK ("edge_relay_ops"."reported_at" IS NULL OR "edge_relay_ops"."status" = 'DONE')
);
--> statement-breakpoint
CREATE INDEX "edge_relay_ops_open_idx" ON "edge_relay_ops" USING btree ("status","id");