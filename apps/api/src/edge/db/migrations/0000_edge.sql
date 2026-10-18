CREATE TABLE "edge_devices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "edge_devices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"till_code" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "edge_devices_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "edge_outbox" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "edge_outbox_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"client_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"code" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "edge_outbox_kind_client_key" UNIQUE("kind","client_id")
);
--> statement-breakpoint
CREATE TABLE "edge_pin_attempts" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "edge_sales" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"shift_client_id" uuid NOT NULL,
	"till_code" text NOT NULL,
	"cashier_user_id" bigint NOT NULL,
	"number" text NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"cash_amount" numeric(14, 2) NOT NULL,
	"card_amount" numeric(14, 2) NOT NULL,
	"vat_total" numeric(14, 2) NOT NULL,
	"doc" jsonb NOT NULL,
	"receipt" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edge_sales_number_key" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "edge_sequences" (
	"key" text NOT NULL,
	"day" text NOT NULL,
	"last" integer NOT NULL,
	CONSTRAINT "edge_sequences_key_day_pk" PRIMARY KEY("key","day")
);
--> statement-breakpoint
CREATE TABLE "edge_shifts" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"till_code" text NOT NULL,
	"cashier_user_id" bigint NOT NULL,
	"cashier_name" text NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"opening_float" numeric(14, 2) NOT NULL,
	"closed_at" timestamp with time zone,
	"counted_cash" numeric(14, 2),
	"float_kept" numeric(14, 2),
	"note" text,
	CONSTRAINT "edge_shifts_number_key" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "edge_state" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"snapshot_version" text,
	"snapshot" jsonb,
	"pulled_at" timestamp with time zone,
	"last_push_at" timestamp with time zone,
	"last_contact_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edge_state_single_row" CHECK ("edge_state"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "edge_sales" ADD CONSTRAINT "edge_sales_shift_client_id_edge_shifts_client_id_fk" FOREIGN KEY ("shift_client_id") REFERENCES "public"."edge_shifts"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edge_outbox_pending_idx" ON "edge_outbox" USING btree ("status","seq");--> statement-breakpoint
CREATE INDEX "edge_sales_shift_idx" ON "edge_sales" USING btree ("shift_client_id","sold_at");--> statement-breakpoint
CREATE UNIQUE INDEX "edge_shifts_one_open_per_till" ON "edge_shifts" USING btree ("till_code") WHERE status = 'OPEN';