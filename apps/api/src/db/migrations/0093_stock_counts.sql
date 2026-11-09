CREATE TABLE "stock_count_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_count_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" bigint NOT NULL,
	"stocktake_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"product_unit_id" bigint NOT NULL,
	"entered_qty" numeric(14, 3) NOT NULL,
	"factor_snapshot" numeric(18, 6) NOT NULL,
	"qty_base" numeric(14, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	CONSTRAINT "stock_count_entries_qty" CHECK ("stock_count_entries"."entered_qty" >= 0 AND "stock_count_entries"."qty_base" >= 0 AND "stock_count_entries"."factor_snapshot" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_count_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_count_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"stocktake_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"listed" boolean DEFAULT true NOT NULL,
	"expected_qty" numeric(14, 3),
	"first_counted_at" timestamp with time zone,
	"ledger_mark" bigint,
	"counted_qty" numeric(14, 3),
	"settle_own" boolean DEFAULT false NOT NULL,
	"account_code" text,
	"party_kind" text,
	"party_id" bigint,
	"party_name" text,
	"charged" boolean DEFAULT false NOT NULL,
	"difference_qty" numeric(14, 3),
	"unit_cost" numeric(14, 4),
	"charge_amount" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_count_lines_key" UNIQUE("stocktake_id","product_id"),
	CONSTRAINT "stock_count_lines_first" CHECK (("stock_count_lines"."expected_qty" IS NULL) = ("stock_count_lines"."first_counted_at" IS NULL)
        AND ("stock_count_lines"."expected_qty" IS NULL) = ("stock_count_lines"."ledger_mark" IS NULL)
        AND ("stock_count_lines"."expected_qty" IS NULL OR "stock_count_lines"."expected_qty" >= 0)
        AND ("stock_count_lines"."counted_qty" IS NULL OR "stock_count_lines"."counted_qty" >= 0)),
	CONSTRAINT "stock_count_lines_party" CHECK (("stock_count_lines"."party_kind" IS NULL OR "stock_count_lines"."party_kind" IN ('USER', 'CUSTOMER', 'SUPPLIER', 'OTHER'))
        AND ("stock_count_lines"."party_kind" IS NULL) = ("stock_count_lines"."party_name" IS NULL)
        AND (NOT "stock_count_lines"."charged" OR "stock_count_lines"."party_kind" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "stock_count_sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_count_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"stocktake_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by" bigint,
	CONSTRAINT "stock_count_sessions_sent" CHECK (("stock_count_sessions"."sent_at" IS NULL) = ("stock_count_sessions"."sent_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "kind" text DEFAULT 'SHELF' NOT NULL;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "scope_mode" text;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "scope_ids" bigint[];--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "scope_label" text;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "show_stock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "surplus_account_code" text;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "surplus_party_kind" text;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "surplus_party_id" bigint;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "surplus_party_name" text;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "shortage_account_code" text;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "shortage_party_kind" text;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "shortage_party_id" bigint;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "shortage_party_name" text;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "shortage_charged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "uncounted" text;--> statement-breakpoint
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_session_id_stock_count_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."stock_count_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_stocktake_id_stocktakes_id_fk" FOREIGN KEY ("stocktake_id") REFERENCES "public"."stocktakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_product_unit_id_product_units_id_fk" FOREIGN KEY ("product_unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_stocktake_id_stocktakes_id_fk" FOREIGN KEY ("stocktake_id") REFERENCES "public"."stocktakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_stocktake_id_stocktakes_id_fk" FOREIGN KEY ("stocktake_id") REFERENCES "public"."stocktakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_count_entries_session_idx" ON "stock_count_entries" USING btree ("session_id","id");--> statement-breakpoint
CREATE INDEX "stock_count_entries_product_idx" ON "stock_count_entries" USING btree ("stocktake_id","product_id","id");--> statement-breakpoint
CREATE INDEX "stock_count_lines_product_idx" ON "stock_count_lines" USING btree ("product_id","stocktake_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_sessions_open_key" ON "stock_count_sessions" USING btree ("stocktake_id","user_id") WHERE "stock_count_sessions"."sent_at" IS NULL;--> statement-breakpoint
CREATE INDEX "stock_count_sessions_stocktake_idx" ON "stock_count_sessions" USING btree ("stocktake_id","id");--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_kind" CHECK ("stocktakes"."kind" IN ('SHELF', 'PRODUCT'));--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_scope" CHECK (("stocktakes"."kind" = 'PRODUCT') = ("stocktakes"."scope_mode" IS NOT NULL)
        AND ("stocktakes"."scope_mode" IS NULL OR "stocktakes"."scope_mode" IN ('ALL', 'SCANNED', 'SEGMENT', 'SUPPLIER', 'CATEGORY'))
        AND ("stocktakes"."uncounted" IS NULL OR "stocktakes"."uncounted" IN ('ZERO', 'LEAVE')));--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_parties" CHECK (("stocktakes"."surplus_party_kind" IS NULL OR "stocktakes"."surplus_party_kind" IN ('USER', 'CUSTOMER', 'SUPPLIER', 'OTHER'))
        AND ("stocktakes"."shortage_party_kind" IS NULL OR "stocktakes"."shortage_party_kind" IN ('USER', 'CUSTOMER', 'SUPPLIER', 'OTHER'))
        AND ("stocktakes"."surplus_party_kind" IS NULL) = ("stocktakes"."surplus_party_name" IS NULL)
        AND ("stocktakes"."shortage_party_kind" IS NULL) = ("stocktakes"."shortage_party_name" IS NULL)
        AND (NOT "stocktakes"."shortage_charged" OR "stocktakes"."shortage_party_kind" IS NOT NULL));--> statement-breakpoint
-- ADR-0176 #3, #5: a typed quantity and a turn at a count are history; an entry is voided, never deleted.
REVOKE DELETE, TRUNCATE ON "stock_count_entries", "stock_count_sessions", "stock_count_lines" FROM app;
