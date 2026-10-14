-- Price profiles and one warehouse price per product (ADR-0048), replacing ADR-0041's unit prices.
-- Generated in two drizzle-kit steps (new tables, then the unit_prices drop) and merged by hand, so
-- the AI views that read unit_prices go first and come back on the new tables at the end.
DROP VIEW ai.prices_today;
--> statement-breakpoint
DROP VIEW ai.price_history;
--> statement-breakpoint
CREATE TABLE "price_profile_versions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "price_profile_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"profile_id" bigint NOT NULL,
	"loose_markup_pct" numeric(5, 2) NOT NULL,
	"retail_markup_pct" numeric(5, 2) NOT NULL,
	"retail_bulk_min_qty" numeric(14, 3),
	"retail_bulk_markup_pct" numeric(5, 2),
	"rounding" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_profile_versions_rounding" CHECK ("price_profile_versions"."rounding" IN ('WHOLE', 'UP_10', 'UP_50', 'UP_100')),
	CONSTRAINT "price_profile_versions_markups" CHECK ("price_profile_versions"."loose_markup_pct" >= 0 AND "price_profile_versions"."retail_markup_pct" >= 0),
	CONSTRAINT "price_profile_versions_bulk" CHECK (("price_profile_versions"."retail_bulk_min_qty" IS NULL) = ("price_profile_versions"."retail_bulk_markup_pct" IS NULL)
        AND ("price_profile_versions"."retail_bulk_min_qty" IS NULL OR ("price_profile_versions"."retail_bulk_min_qty" > 0
          AND "price_profile_versions"."retail_bulk_markup_pct" >= 0 AND "price_profile_versions"."retail_bulk_markup_pct" < "price_profile_versions"."retail_markup_pct"))),
	CONSTRAINT "price_profile_versions_validity" CHECK ("price_profile_versions"."valid_to" IS NULL OR "price_profile_versions"."valid_to" >= "price_profile_versions"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "price_profiles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "price_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_profiles_name" CHECK (length("price_profiles"."name") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "product_prices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_prices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"product_id" bigint NOT NULL,
	"warehouse_price" numeric(14, 2) NOT NULL,
	"profile_id" bigint NOT NULL,
	"whole_uom_id" bigint,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_prices_price" CHECK ("product_prices"."warehouse_price" > 0 AND "product_prices"."warehouse_price" = trunc("product_prices"."warehouse_price")),
	CONSTRAINT "product_prices_validity" CHECK ("product_prices"."valid_to" IS NULL OR "product_prices"."valid_to" >= "product_prices"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "price_profile_versions" ADD CONSTRAINT "price_profile_versions_profile_id_price_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."price_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_profile_versions" ADD CONSTRAINT "price_profile_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_profiles" ADD CONSTRAINT "price_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_profile_id_price_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."price_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_whole_uom_id_uoms_id_fk" FOREIGN KEY ("whole_uom_id") REFERENCES "public"."uoms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_profile_versions_profile_idx" ON "price_profile_versions" USING btree ("profile_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "price_profiles_live_name" ON "price_profiles" USING btree ("name_key") WHERE "price_profiles"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "product_prices_product_idx" ON "product_prices" USING btree ("product_id","valid_from");--> statement-breakpoint
CREATE INDEX "product_prices_profile_idx" ON "product_prices" USING btree ("profile_id");
--> statement-breakpoint

-- Hand-written: the unit prices of ADR-0041 #1 are gone (ADR-0048; only test prices existed,
-- nothing is deployed, ADR-0026). Their views were dropped at the top; the trigger goes with the
-- table, its function here. No CASCADE: a forgotten dependency must fail loudly.
DROP TABLE "unit_prices";
--> statement-breakpoint
DROP FUNCTION unit_prices_guard();
--> statement-breakpoint

-- Hand-written: a product has one set of price terms, and a profile one version, on any day
-- (ADR-0048 #1, #2). btree_gist (0000) lets the bigint column join the date range; a row closed on
-- its first day has an empty range.
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_no_overlap"
  EXCLUDE USING gist ("product_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);
--> statement-breakpoint
ALTER TABLE "price_profile_versions" ADD CONSTRAINT "price_profile_versions_no_overlap"
  EXCLUDE USING gist ("profile_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);
--> statement-breakpoint

-- Hand-written: the history of prices and profile values is never rewritten. Only valid_to moves,
-- and only earlier (closing a row, or voiding one that has not started); created_by may still be
-- cleared when a user is deleted. One function for both dated tables.
CREATE FUNCTION pricing_dated_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'valid_to' - 'created_by') IS DISTINCT FROM (to_jsonb(OLD) - 'valid_to' - 'created_by')
     OR (OLD.valid_to IS NOT NULL AND (NEW.valid_to IS NULL OR NEW.valid_to > OLD.valid_to)) THEN
    RAISE EXCEPTION '% %: only valid_to may change, and only to an earlier date', TG_TABLE_NAME, OLD.id
      USING ERRCODE = 'restrict_violation';  -- 23001
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "product_prices_guard" BEFORE UPDATE ON "product_prices"
  FOR EACH ROW EXECUTE FUNCTION pricing_dated_row_guard();
--> statement-breakpoint
CREATE TRIGGER "price_profile_versions_guard" BEFORE UPDATE ON "price_profile_versions"
  FOR EACH ROW EXECUTE FUNCTION pricing_dated_row_guard();
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "price_profiles", "price_profile_versions", "product_prices" FROM app;
--> statement-breakpoint

-- Hand-written: a complete product has no price terms until the clerk enters them, so it waits
-- again (ADR-0048 #6). One audited RETURN per product, the old completion kept in "before".
INSERT INTO "audit_log" ("actor_kind", "actor_label", "action", "entity", "entity_id", "before", "after")
SELECT 'SYSTEM', 'migration-0019', 'RETURN', 'products', p."id"::text,
       jsonb_build_object('saleReadyAt', p."sale_ready_at"),
       jsonb_build_object('saleReadyAt', NULL, 'reason', 'PRICE_MODEL_ADR_0048')
  FROM "products" p
 WHERE p."sale_ready_at" IS NOT NULL;
--> statement-breakpoint
UPDATE "products" SET "sale_ready_at" = NULL, "updated_at" = now() WHERE "sale_ready_at" IS NOT NULL;
--> statement-breakpoint

-- Hand-written: the price views follow the new tables (ADR-0045 rules, see 0017_ai). The rounding
-- repeats roundPrice() of @tugeel/shared/pricing — WHOLE half up (round() of a positive numeric),
-- UP_n up to a multiple of n — and ai-views.int-spec.ts checks it against ProductPricesService.

-- Every version of every profile that applied or is planned, with its status today and how many
-- products use the profile today.
CREATE VIEW ai.price_profiles AS
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Ulaanbaatar')::date AS d)
SELECT pp.id AS profile_id, pp.name, pp.archived_at IS NOT NULL AS archived, v.id AS version_id,
       v.loose_markup_pct, v.retail_markup_pct, v.retail_bulk_min_qty, v.retail_bulk_markup_pct,
       v.rounding, v.valid_from, v.valid_to,
       CASE WHEN v.valid_to IS NOT NULL AND v.valid_to <= today.d THEN 'ENDED'
            WHEN v.valid_from > today.d THEN 'SCHEDULED'
            ELSE 'ACTIVE' END AS status,
       (SELECT count(*) FROM public.product_prices x
         WHERE x.profile_id = pp.id AND x.valid_from <= today.d
           AND (x.valid_to IS NULL OR x.valid_to > today.d))::integer AS products_today
  FROM public.price_profiles pp
  JOIN public.price_profile_versions v ON v.profile_id = pp.id
  CROSS JOIN today
 WHERE v.valid_to IS NULL OR v.valid_to > v.valid_from;
--> statement-breakpoint

-- Today's prices of every product that has price terms and a profile version in force today: the
-- warehouse price per base unit, the whole pack's price, and the loose, supermarket and
-- supermarket bulk prices per base unit as the profile derives them.
CREATE VIEW ai.product_prices_today AS
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Ulaanbaatar')::date AS d)
SELECT p.id AS product_id, p.sku, p.name AS product_name, bm.name AS base_unit,
       t.warehouse_price, pp.id AS profile_id, pp.name AS profile_name,
       wm.name AS whole_unit_name, wu.factor_to_base AS whole_unit_factor,
       round(t.warehouse_price * wu.factor_to_base, 0)::numeric(14, 2) AS whole_unit_price,
       (CASE WHEN s.step IS NULL THEN round(raw.loose, 0)
             ELSE ceil(raw.loose / s.step) * s.step END)::numeric(14, 2) AS loose_price,
       (CASE WHEN s.step IS NULL THEN round(raw.retail, 0)
             ELSE ceil(raw.retail / s.step) * s.step END)::numeric(14, 2) AS retail_price,
       (CASE WHEN raw.bulk IS NULL THEN NULL
             WHEN s.step IS NULL THEN round(raw.bulk, 0)
             ELSE ceil(raw.bulk / s.step) * s.step END)::numeric(14, 2) AS retail_bulk_price,
       v.retail_bulk_min_qty, v.rounding, t.valid_from, t.valid_to
  FROM public.product_prices t
  CROSS JOIN today
  JOIN public.products p ON p.id = t.product_id
  JOIN public.product_units bu ON bu.product_id = p.id AND bu.is_base
  JOIN public.uoms bm ON bm.id = bu.uom_id
  JOIN public.price_profiles pp ON pp.id = t.profile_id
  JOIN public.price_profile_versions v
    ON v.profile_id = t.profile_id AND v.valid_from <= today.d
   AND (v.valid_to IS NULL OR v.valid_to > today.d)
  LEFT JOIN public.product_units wu
    ON wu.product_id = p.id AND wu.uom_id = t.whole_uom_id AND wu.superseded_at IS NULL
   AND NOT wu.is_base
  LEFT JOIN public.uoms wm ON wm.id = wu.uom_id
  CROSS JOIN LATERAL (
    SELECT CASE v.rounding WHEN 'UP_10' THEN 10 WHEN 'UP_50' THEN 50 WHEN 'UP_100' THEN 100 END AS step
  ) s
  CROSS JOIN LATERAL (
    SELECT t.warehouse_price * (100 + v.loose_markup_pct) / 100 AS loose,
           t.warehouse_price * (100 + v.retail_markup_pct) / 100 AS retail,
           t.warehouse_price * (100 + v.retail_bulk_markup_pct) / 100 AS bulk
  ) raw
 WHERE t.valid_from <= today.d AND (t.valid_to IS NULL OR t.valid_to > today.d);
--> statement-breakpoint

-- Every price-terms period of every product that applied (a row closed on its first day never did).
CREATE VIEW ai.product_price_history AS
SELECT x.id, x.product_id, p.sku, p.name AS product_name, x.warehouse_price, x.profile_id,
       pp.name AS profile_name, wm.name AS whole_unit_name, x.valid_from, x.valid_to, x.created_at,
       cu.full_name AS created_by_name
  FROM public.product_prices x
  JOIN public.products p ON p.id = x.product_id
  JOIN public.price_profiles pp ON pp.id = x.profile_id
  LEFT JOIN public.uoms wm ON wm.id = x.whole_uom_id
  LEFT JOIN public.users cu ON cu.id = x.created_by
 WHERE x.valid_to IS NULL OR x.valid_to > x.valid_from;
--> statement-breakpoint

-- app's default privileges (0000_foundation) cover views too: take them back. migrate.ts repeats
-- this after every run and grants ai_reader.
REVOKE ALL ON ALL TABLES IN SCHEMA ai FROM app;
