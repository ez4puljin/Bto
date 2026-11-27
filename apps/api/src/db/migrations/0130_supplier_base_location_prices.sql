-- ADR-0246: additive supplier invoice pricing; no existing rules or prices are backfilled.
CREATE TABLE "base_price_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "base_price_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"valid_from" date DEFAULT CURRENT_DATE NOT NULL,
	"product_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"phase" text,
	"reason" text,
	"old_base_price" numeric(14, 2),
	"new_base_price" numeric(14, 2),
	"printed_unit_price_base" text,
	"overrode_manual" boolean DEFAULT false NOT NULL,
	"receipt_id" bigint,
	"receipt_number" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_price_events_kind" CHECK ("base_price_events"."kind" IN ('RECEIPT', 'MANUAL', 'SKIPPED')),
	CONSTRAINT "base_price_events_shape" CHECK (("base_price_events"."kind" = 'MANUAL' AND "base_price_events"."receipt_id" IS NULL AND "base_price_events"."phase" IS NULL) OR ("base_price_events"."kind" IN ('RECEIPT', 'SKIPPED') AND "base_price_events"."receipt_id" IS NOT NULL AND "base_price_events"."phase" IS NOT NULL AND "base_price_events"."phase" IN ('POST', 'FIRST_PRICED'))),
	CONSTRAINT "base_price_events_money" CHECK (("base_price_events"."old_base_price" IS NULL OR ("base_price_events"."old_base_price" > 0 AND "base_price_events"."old_base_price" < 'Infinity'::numeric AND "base_price_events"."old_base_price" = trunc("base_price_events"."old_base_price"))) AND ("base_price_events"."new_base_price" IS NULL OR ("base_price_events"."new_base_price" > 0 AND "base_price_events"."new_base_price" < 'Infinity'::numeric AND "base_price_events"."new_base_price" = trunc("base_price_events"."new_base_price"))) AND ("base_price_events"."kind" <> 'RECEIPT' OR "base_price_events"."new_base_price" IS NOT NULL) AND ("base_price_events"."kind" <> 'MANUAL' OR "base_price_events"."old_base_price" IS NOT NULL OR "base_price_events"."new_base_price" IS NOT NULL)),
	CONSTRAINT "base_price_events_printed" CHECK ("base_price_events"."printed_unit_price_base" IS NULL OR ("base_price_events"."printed_unit_price_base" ~ '^[0-9]+([.][0-9]+)?$' AND length("base_price_events"."printed_unit_price_base") <= 80))
);
--> statement-breakpoint
CREATE TABLE "base_price_states" (
	"product_id" bigint PRIMARY KEY NOT NULL,
	"last_receipt_id" bigint,
	"last_receipt_posted_at" timestamp with time zone,
	"last_event_id" bigint,
	"source" text NOT NULL,
	"manual_after_receipt" boolean DEFAULT false NOT NULL,
	"receipt_applied" boolean DEFAULT false NOT NULL,
	"posting_price" numeric(14, 2),
	"receipt_rule_version" integer,
	"receipt_markup_pct" numeric(5, 2),
	"receipt_markup_amount" numeric(14, 2),
	"receipt_rounding" text,
	CONSTRAINT "base_price_states_source" CHECK ("base_price_states"."source" IN ('RECEIPT', 'MANUAL', 'LEGACY')),
	CONSTRAINT "base_price_states_receipt" CHECK (("base_price_states"."last_receipt_id" IS NULL) = ("base_price_states"."last_receipt_posted_at" IS NULL)),
	CONSTRAINT "base_price_states_posting_price" CHECK ("base_price_states"."posting_price" IS NULL OR ("base_price_states"."posting_price" > 0 AND "base_price_states"."posting_price" < 'Infinity'::numeric AND "base_price_states"."posting_price" = trunc("base_price_states"."posting_price"))),
	CONSTRAINT "base_price_states_rule" CHECK (("base_price_states"."receipt_rule_version" IS NULL AND "base_price_states"."receipt_markup_pct" IS NULL AND "base_price_states"."receipt_markup_amount" IS NULL AND "base_price_states"."receipt_rounding" IS NULL) OR ("base_price_states"."receipt_rule_version" IS NOT NULL AND "base_price_states"."receipt_rule_version" > 0 AND "base_price_states"."receipt_markup_pct" IS NOT NULL AND "base_price_states"."receipt_markup_pct" >= 0 AND "base_price_states"."receipt_markup_pct" < 'Infinity'::numeric AND "base_price_states"."receipt_markup_amount" IS NOT NULL AND "base_price_states"."receipt_markup_amount" >= 0 AND "base_price_states"."receipt_markup_amount" < 'Infinity'::numeric AND "base_price_states"."receipt_markup_amount" = trunc("base_price_states"."receipt_markup_amount") AND "base_price_states"."receipt_rounding" IS NOT NULL AND "base_price_states"."receipt_rounding" IN ('WHOLE', 'UP_10', 'UP_50', 'UP_100', 'DOWN_10', 'DOWN_50', 'DOWN_100')))
);
--> statement-breakpoint
CREATE TABLE "location_price_rule_versions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "location_price_rule_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"warehouse_id" bigint NOT NULL,
	"enabled" boolean NOT NULL,
	"price_type" text NOT NULL,
	"markup_pct" numeric(5, 2) NOT NULL,
	"markup_amount" numeric(14, 2) NOT NULL,
	"rounding" text NOT NULL,
	"version" integer NOT NULL,
	"valid_from" date NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_price_rule_versions_version" UNIQUE("warehouse_id","version"),
	CONSTRAINT "location_price_rule_versions_values" CHECK ("location_price_rule_versions"."markup_pct" >= 0 AND "location_price_rule_versions"."markup_pct" < 'Infinity'::numeric AND "location_price_rule_versions"."markup_amount" >= 0 AND "location_price_rule_versions"."markup_amount" < 'Infinity'::numeric AND "location_price_rule_versions"."markup_amount" = trunc("location_price_rule_versions"."markup_amount") AND "location_price_rule_versions"."version" > 0),
	CONSTRAINT "location_price_rule_versions_type" CHECK ("location_price_rule_versions"."price_type" IN ('BASE', 'ADDITIONAL') AND ("location_price_rule_versions"."price_type" <> 'BASE' OR ("location_price_rule_versions"."markup_pct" = 0 AND "location_price_rule_versions"."markup_amount" = 0))),
	CONSTRAINT "location_price_rule_versions_rounding" CHECK ("location_price_rule_versions"."rounding" IN ('WHOLE', 'UP_10', 'UP_50', 'UP_100', 'DOWN_10', 'DOWN_50', 'DOWN_100'))
);
--> statement-breakpoint
CREATE TABLE "location_price_rules" (
	"warehouse_id" bigint PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"price_type" text NOT NULL,
	"markup_pct" numeric(5, 2) NOT NULL,
	"markup_amount" numeric(14, 2) NOT NULL,
	"rounding" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_price_rules_values" CHECK ("location_price_rules"."markup_pct" >= 0 AND "location_price_rules"."markup_pct" < 'Infinity'::numeric AND "location_price_rules"."markup_amount" >= 0 AND "location_price_rules"."markup_amount" < 'Infinity'::numeric AND "location_price_rules"."markup_amount" = trunc("location_price_rules"."markup_amount") AND "location_price_rules"."version" > 0),
	CONSTRAINT "location_price_rules_type" CHECK ("location_price_rules"."price_type" IN ('BASE', 'ADDITIONAL') AND ("location_price_rules"."price_type" <> 'BASE' OR ("location_price_rules"."markup_pct" = 0 AND "location_price_rules"."markup_amount" = 0))),
	CONSTRAINT "location_price_rules_rounding" CHECK ("location_price_rules"."rounding" IN ('WHOLE', 'UP_10', 'UP_50', 'UP_100', 'DOWN_10', 'DOWN_50', 'DOWN_100'))
);
--> statement-breakpoint
CREATE TABLE "supplier_price_rules" (
	"supplier_id" bigint PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"markup_pct" numeric(5, 2) NOT NULL,
	"markup_amount" numeric(14, 2) NOT NULL,
	"rounding" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_price_rules_values" CHECK ("supplier_price_rules"."markup_pct" >= 0 AND "supplier_price_rules"."markup_pct" < 'Infinity'::numeric AND "supplier_price_rules"."markup_amount" >= 0 AND "supplier_price_rules"."markup_amount" < 'Infinity'::numeric AND "supplier_price_rules"."markup_amount" = trunc("supplier_price_rules"."markup_amount") AND "supplier_price_rules"."version" > 0),
	CONSTRAINT "supplier_price_rules_rounding" CHECK ("supplier_price_rules"."rounding" IN ('WHOLE', 'UP_10', 'UP_50', 'UP_100', 'DOWN_10', 'DOWN_50', 'DOWN_100'))
);
--> statement-breakpoint
ALTER TABLE "base_price_events" ADD CONSTRAINT "base_price_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_price_events" ADD CONSTRAINT "base_price_events_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_price_events" ADD CONSTRAINT "base_price_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_price_states" ADD CONSTRAINT "base_price_states_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_price_states" ADD CONSTRAINT "base_price_states_last_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("last_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_price_states" ADD CONSTRAINT "base_price_states_last_event_id_base_price_events_id_fk" FOREIGN KEY ("last_event_id") REFERENCES "public"."base_price_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_price_rule_versions" ADD CONSTRAINT "location_price_rule_versions_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_price_rule_versions" ADD CONSTRAINT "location_price_rule_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_price_rules" ADD CONSTRAINT "location_price_rules_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_price_rules" ADD CONSTRAINT "location_price_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_price_rules" ADD CONSTRAINT "supplier_price_rules_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_price_rules" ADD CONSTRAINT "supplier_price_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "base_price_events_product_idx" ON "base_price_events" USING btree ("product_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "base_price_events_receipt_phase_product" ON "base_price_events" USING btree ("receipt_id","phase","product_id") WHERE "base_price_events"."receipt_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "location_price_rule_versions_day" ON "location_price_rule_versions" USING btree ("warehouse_id","valid_from","id");
--> statement-breakpoint
ALTER TABLE goods_receipt_lines ADD COLUMN printed_unit_price numeric(14, 2);
--> statement-breakpoint
ALTER TABLE goods_receipt_lines ADD COLUMN printed_price_factor numeric(18, 6);
--> statement-breakpoint
ALTER TABLE goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_printed_price_basis
  CHECK ((printed_unit_price IS NULL) = (printed_price_factor IS NULL)
    AND (printed_price_factor IS NULL OR (printed_price_factor > 0 AND printed_price_factor < 'Infinity'::numeric)));
--> statement-breakpoint
ALTER TABLE goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_printed_price
  CHECK (printed_unit_price IS NULL OR (printed_unit_price >= 0 AND printed_unit_price < 'Infinity'::numeric));
--> statement-breakpoint
-- Additive sidecar: retain the old notification table, kind constraint, IDs and rows unchanged.
-- Both streams consume the same existing sequence; no setval, reseed or existing-row rewrite.
CREATE TABLE user_price_notifications (
  id bigint PRIMARY KEY DEFAULT nextval('public.user_notifications_id_seq'::regclass),
  user_id bigint NOT NULL CONSTRAINT user_price_notifications_user_id_users_id_fk REFERENCES users(id),
  price_change_key text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT user_price_notifications_key CHECK (length(price_change_key) BETWEEN 1 AND 128),
  CONSTRAINT user_price_notifications_event_user UNIQUE (price_change_key, user_id)
);
--> statement-breakpoint
CREATE INDEX user_price_notifications_user_idx ON user_price_notifications (user_id, id);
--> statement-breakpoint
CREATE INDEX user_price_notifications_unread_idx ON user_price_notifications (user_id) WHERE read_at IS NULL;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON user_price_notifications FROM app;
--> statement-breakpoint
GRANT INSERT (user_id, price_change_key, payload), UPDATE (read_at) ON user_price_notifications TO app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE user_notifications_id_seq TO app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON base_price_events, location_price_rule_versions FROM app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON supplier_price_rules, location_price_rules, base_price_states FROM app;
--> statement-breakpoint
CREATE TRIGGER base_price_events_append_only BEFORE UPDATE OR DELETE ON base_price_events
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER base_price_events_no_truncate BEFORE TRUNCATE ON base_price_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER location_price_rule_versions_append_only BEFORE UPDATE OR DELETE ON location_price_rule_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER location_price_rule_versions_no_truncate BEFORE TRUNCATE ON location_price_rule_versions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE FUNCTION supplier_price_rule_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'a price rule starts at version one' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'a price rule update advances exactly one version' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'supplier_price_rules' THEN
      IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN
        RAISE EXCEPTION 'a supplier price rule keeps its supplier' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id THEN
      RAISE EXCEPTION 'a location price rule keeps its warehouse' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER supplier_price_rules_revision BEFORE INSERT OR UPDATE ON supplier_price_rules
  FOR EACH ROW EXECUTE FUNCTION supplier_price_rule_revision_guard();
--> statement-breakpoint
CREATE TRIGGER location_price_rules_revision BEFORE INSERT OR UPDATE ON location_price_rules
  FOR EACH ROW EXECUTE FUNCTION supplier_price_rule_revision_guard();
--> statement-breakpoint
CREATE FUNCTION base_price_state_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.last_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM base_price_events WHERE id = NEW.last_event_id AND product_id = NEW.product_id
  ) THEN
    RAISE EXCEPTION 'a base-price state references its own product event' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER base_price_states_event BEFORE INSERT OR UPDATE ON base_price_states
  FOR EACH ROW EXECUTE FUNCTION base_price_state_event_guard();
--> statement-breakpoint
CREATE FUNCTION receipt_printed_price_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE header goods_receipts%ROWTYPE;
BEGIN
  SELECT * INTO header FROM goods_receipts WHERE id = OLD.receipt_id;
  IF header.status = 'POSTED' AND ROW(NEW.receipt_id, NEW.product_id) IS DISTINCT FROM ROW(OLD.receipt_id, OLD.product_id) THEN
    RAISE EXCEPTION 'posted printed reference keeps its receipt and product' USING ERRCODE = '23001';
  END IF;
  IF ROW(NEW.printed_unit_price, NEW.printed_price_factor)
     IS NOT DISTINCT FROM ROW(OLD.printed_unit_price, OLD.printed_price_factor) THEN RETURN NEW; END IF;
  IF header.status = 'DRAFT' THEN RETURN NEW; END IF;
  IF header.status = 'POSTED' AND header.costing_version = 0
     AND ((OLD.printed_unit_price IS NULL AND OLD.printed_price_factor IS NULL) OR OLD.free_goods IS NOT TRUE)
     AND NEW.printed_unit_price IS NOT NULL AND NEW.printed_price_factor IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'posted printed receipt price is immutable after first pricing'
    USING ERRCODE = '23001';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER goods_receipt_lines_printed_price_immutable BEFORE UPDATE ON goods_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION receipt_printed_price_guard();

--> statement-breakpoint
ALTER TABLE base_price_events ADD COLUMN printed_price_amount numeric(14, 2);
--> statement-breakpoint
ALTER TABLE base_price_events ADD COLUMN printed_price_qty_base numeric(18, 6);
--> statement-breakpoint
ALTER TABLE base_price_events ADD CONSTRAINT base_price_events_printed_ratio
  CHECK ((printed_price_amount IS NULL) = (printed_price_qty_base IS NULL)
    AND (printed_price_amount IS NULL OR (printed_price_amount >= 0 AND printed_price_amount < 'Infinity'::numeric
      AND printed_price_qty_base > 0 AND printed_price_qty_base < 'Infinity'::numeric)));

--> statement-breakpoint
-- valid_from is declared in CREATE TABLE above; no later shape change is needed.

--> statement-breakpoint
ALTER TABLE base_price_events ADD COLUMN rule_snapshot jsonb;
