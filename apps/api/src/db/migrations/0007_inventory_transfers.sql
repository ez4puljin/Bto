CREATE TABLE "transfer_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transfer_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"transfer_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"request_unit_id" bigint NOT NULL,
	"request_factor" numeric(18, 6) NOT NULL,
	"requested_qty" numeric(14, 3) NOT NULL,
	"shipped_qty_base" numeric(14, 3),
	"from_bin_id" bigint,
	"received_qty_base" numeric(14, 3),
	"to_bin_id" bigint,
	"lot_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_lines_product_key" UNIQUE NULLS NOT DISTINCT("transfer_id","product_id","lot_id"),
	CONSTRAINT "transfer_lines_qty" CHECK ("transfer_lines"."request_factor" > 0 AND "transfer_lines"."requested_qty" > 0
        AND ("transfer_lines"."shipped_qty_base" IS NULL OR "transfer_lines"."shipped_qty_base" >= 0)
        AND ("transfer_lines"."received_qty_base" IS NULL OR ("transfer_lines"."shipped_qty_base" IS NOT NULL AND "transfer_lines"."received_qty_base" >= 0)))
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transfers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" text,
	"origin" text NOT NULL,
	"source_warehouse_id" bigint NOT NULL,
	"dest_warehouse_id" bigint NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"note" text,
	"requested_at" timestamp with time zone,
	"requested_by" bigint,
	"shipped_at" timestamp with time zone,
	"shipped_by" bigint,
	"ship_date" date,
	"received_at" timestamp with time zone,
	"received_by" bigint,
	"receive_date" date,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" bigint,
	"cancel_reason" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_number_key" UNIQUE("number"),
	CONSTRAINT "transfers_origin" CHECK ("transfers"."origin" IN ('REQUEST', 'PUSH')),
	CONSTRAINT "transfers_status" CHECK ("transfers"."status" IN ('DRAFT', 'REQUESTED', 'SHIPPED', 'RECEIVED', 'CANCELLED')),
	CONSTRAINT "transfers_warehouses" CHECK ("transfers"."source_warehouse_id" <> "transfers"."dest_warehouse_id"),
	CONSTRAINT "transfers_number" CHECK (("transfers"."status" <> 'DRAFT' OR "transfers"."number" IS NULL)
        AND ("transfers"."status" NOT IN ('REQUESTED', 'SHIPPED', 'RECEIVED') OR "transfers"."number" IS NOT NULL)),
	CONSTRAINT "transfers_requested" CHECK (("transfers"."status" <> 'REQUESTED' OR "transfers"."requested_at" IS NOT NULL)
        AND ("transfers"."origin" = 'REQUEST' OR "transfers"."requested_at" IS NULL)),
	CONSTRAINT "transfers_shipped" CHECK (("transfers"."status" IN ('SHIPPED', 'RECEIVED'))
        = ("transfers"."shipped_at" IS NOT NULL AND "transfers"."ship_date" IS NOT NULL)),
	CONSTRAINT "transfers_received" CHECK (("transfers"."status" = 'RECEIVED') = ("transfers"."received_at" IS NOT NULL AND "transfers"."receive_date" IS NOT NULL)),
	CONSTRAINT "transfers_cancelled" CHECK (("transfers"."status" = 'CANCELLED') = ("transfers"."cancelled_at" IS NOT NULL)),
	CONSTRAINT "transfers_note" CHECK ("transfers"."note" IS NULL OR length("transfers"."note") BETWEEN 1 AND 500),
	CONSTRAINT "transfers_cancel_reason" CHECK ("transfers"."cancel_reason" IS NULL OR length("transfers"."cancel_reason") BETWEEN 1 AND 300)
);
--> statement-breakpoint
ALTER TABLE "adjustments" DROP CONSTRAINT "adjustments_reason";--> statement-breakpoint
ALTER TABLE "adjustments" ADD COLUMN "reverses_adjustment_id" bigint;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_request_unit_id_product_units_id_fk" FOREIGN KEY ("request_unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_from_bin_id_bins_id_fk" FOREIGN KEY ("from_bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_to_bin_id_bins_id_fk" FOREIGN KEY ("to_bin_id") REFERENCES "public"."bins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_source_warehouse_id_warehouses_id_fk" FOREIGN KEY ("source_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_dest_warehouse_id_warehouses_id_fk" FOREIGN KEY ("dest_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_shipped_by_users_id_fk" FOREIGN KEY ("shipped_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_lines_transfer_idx" ON "transfer_lines" USING btree ("transfer_id","id");--> statement-breakpoint
CREATE INDEX "transfers_source_idx" ON "transfers" USING btree ("source_warehouse_id","status","id");--> statement-breakpoint
CREATE INDEX "transfers_dest_idx" ON "transfers" USING btree ("dest_warehouse_id","status","id");--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_reverses_adjustment_id_adjustments_id_fk" FOREIGN KEY ("reverses_adjustment_id") REFERENCES "public"."adjustments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_reverses_key" UNIQUE("reverses_adjustment_id");--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_reason" CHECK ("adjustments"."reason" IN ('DAMAGED', 'EXPIRED', 'SHORTAGE', 'SURPLUS', 'OPENING', 'OPENING_REVERSAL'));--> statement-breakpoint

-- Hand-written (ADR-0035): a transfer's receive posts the transit leg 3 and the destination leg 4; a
-- difference posts leg 6 back at the sender (shortfall) or legs 5 and 6 from the sender to the
-- destination (surplus).
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_leg";
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_leg" CHECK (CASE
    WHEN "movement_type" = 'TRANSFER_OUT' THEN "leg" IN (1, 3, 5)
    WHEN "movement_type" = 'TRANSFER_IN' THEN "leg" IN (2, 4, 6)
    WHEN "movement_type" IN ('PUTAWAY_IN', 'BIN_MOVE_IN', 'PICK_IN', 'DISPATCH_IN') THEN "leg" = 2
    ELSE "leg" = 1 END);
--> statement-breakpoint

-- Transfers are cancelled, never deleted; lines of a draft or a request may be deleted (the service
-- checks the state).
REVOKE DELETE, TRUNCATE ON "transfers" FROM app;
