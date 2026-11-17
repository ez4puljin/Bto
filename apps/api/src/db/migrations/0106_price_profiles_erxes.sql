ALTER TABLE "price_profile_versions" DROP CONSTRAINT "price_profile_versions_rounding";--> statement-breakpoint
ALTER TABLE "price_profile_versions" DROP CONSTRAINT "price_profile_versions_markups";--> statement-breakpoint
ALTER TABLE "price_profile_versions" DROP CONSTRAINT "price_profile_versions_bulk";--> statement-breakpoint
ALTER TABLE "price_profile_versions" ADD COLUMN "retail_markup_amount" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "price_profile_versions" ADD COLUMN "retail_bulk_discount_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "price_profile_versions" ADD COLUMN "retail_rounding" text;--> statement-breakpoint
ALTER TABLE "price_profile_versions" ADD COLUMN "retail_bulk_rounding" text;--> statement-breakpoint
ALTER TABLE "price_profile_versions" ADD CONSTRAINT "price_profile_versions_retail_rounding" CHECK ("price_profile_versions"."retail_rounding" IS NULL OR "price_profile_versions"."retail_rounding" IN ('WHOLE', 'UP_10', 'UP_50', 'UP_100', 'DOWN_10', 'DOWN_50', 'DOWN_100'));--> statement-breakpoint
ALTER TABLE "price_profile_versions" ADD CONSTRAINT "price_profile_versions_bulk_rounding" CHECK ("price_profile_versions"."retail_bulk_rounding" IS NULL OR ("price_profile_versions"."retail_bulk_min_qty" IS NOT NULL
        AND "price_profile_versions"."retail_bulk_rounding" IN ('WHOLE', 'UP_10', 'UP_50', 'UP_100', 'DOWN_10', 'DOWN_50', 'DOWN_100')));--> statement-breakpoint
ALTER TABLE "price_profile_versions" ADD CONSTRAINT "price_profile_versions_rounding" CHECK ("price_profile_versions"."rounding" IN ('WHOLE', 'UP_10', 'UP_50', 'UP_100', 'DOWN_10', 'DOWN_50', 'DOWN_100'));--> statement-breakpoint
ALTER TABLE "price_profile_versions" ADD CONSTRAINT "price_profile_versions_markups" CHECK ("price_profile_versions"."loose_markup_pct" >= 0 AND "price_profile_versions"."retail_markup_pct" >= 0
        AND "price_profile_versions"."retail_markup_amount" >= 0 AND "price_profile_versions"."retail_markup_amount" = trunc("price_profile_versions"."retail_markup_amount"));--> statement-breakpoint
ALTER TABLE "price_profile_versions" ADD CONSTRAINT "price_profile_versions_bulk" CHECK (("price_profile_versions"."retail_bulk_min_qty" IS NULL)
          = ("price_profile_versions"."retail_bulk_markup_pct" IS NULL AND "price_profile_versions"."retail_bulk_discount_pct" IS NULL)
        AND ("price_profile_versions"."retail_bulk_markup_pct" IS NULL OR "price_profile_versions"."retail_bulk_discount_pct" IS NULL)
        AND ("price_profile_versions"."retail_bulk_min_qty" IS NULL OR "price_profile_versions"."retail_bulk_min_qty" > 0)
        AND ("price_profile_versions"."retail_bulk_markup_pct" IS NULL OR ("price_profile_versions"."retail_bulk_markup_pct" >= 0
          AND "price_profile_versions"."retail_bulk_markup_pct" < "price_profile_versions"."retail_markup_pct"))
        AND ("price_profile_versions"."retail_bulk_discount_pct" IS NULL OR ("price_profile_versions"."retail_bulk_discount_pct" > 0
          AND "price_profile_versions"."retail_bulk_discount_pct" < 100)));--> statement-breakpoint

-- Hand-written (ADR-0207): the price views follow the new values. The rounding repeats roundPrice()
-- of @tugeel/shared/pricing — WHOLE half up, UP_n up to a multiple of n, DOWN_n up to a whole tugrik
-- and then down to a multiple of n (the whole tugrik when that leaves nothing) — and
-- ai-views.int-spec.ts checks it against ProductPricesService.
DROP VIEW ai.price_profiles;
--> statement-breakpoint
CREATE VIEW ai.price_profiles AS
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Ulaanbaatar')::date AS d)
SELECT pp.id AS profile_id, pp.name, pp.archived_at IS NOT NULL AS archived, v.id AS version_id,
       v.loose_markup_pct, v.retail_markup_pct, v.retail_markup_amount, v.retail_bulk_min_qty,
       v.retail_bulk_markup_pct, v.retail_bulk_discount_pct, v.rounding,
       coalesce(v.retail_rounding, v.rounding) AS retail_rounding,
       CASE WHEN v.retail_bulk_min_qty IS NOT NULL
            THEN coalesce(v.retail_bulk_rounding, v.retail_rounding, v.rounding) END
         AS retail_bulk_rounding,
       v.valid_from, v.valid_to,
       CASE WHEN v.valid_to IS NOT NULL AND v.valid_to <= today.d THEN 'ENDED'
            WHEN v.valid_from > today.d THEN 'SCHEDULED'
            ELSE 'ACTIVE' END AS status,
       (SELECT count(*) FROM public.product_prices x
         WHERE x.profile_id = pp.id AND x.valid_from <= today.d
           AND (x.valid_to IS NULL OR x.valid_to > today.d))::integer AS products_today
  FROM public.price_profiles pp
  JOIN public.price_profile_versions v ON v.profile_id = pp.id
  CROSS JOIN today
 WHERE pp.deleted_at IS NULL AND (v.valid_to IS NULL OR v.valid_to > v.valid_from);
--> statement-breakpoint
DROP VIEW ai.product_prices_today;
--> statement-breakpoint
CREATE VIEW ai.product_prices_today AS
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Ulaanbaatar')::date AS d)
SELECT p.id AS product_id, p.sku, p.name AS product_name, bm.name AS base_unit,
       t.warehouse_price, pp.id AS profile_id, pp.name AS profile_name,
       wm.name AS whole_unit_name, wu.factor_to_base AS whole_unit_factor,
       round(t.warehouse_price * wu.factor_to_base, 0)::numeric(14, 2) AS whole_unit_price,
       loose.price::numeric(14, 2) AS loose_price,
       retail.price::numeric(14, 2) AS retail_price,
       bulk.price::numeric(14, 2) AS retail_bulk_price,
       v.retail_bulk_min_qty, v.rounding, r.retail AS retail_rounding, t.valid_from, t.valid_to
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
    SELECT coalesce(v.retail_rounding, v.rounding) AS retail,
           coalesce(v.retail_bulk_rounding, v.retail_rounding, v.rounding) AS bulk
  ) r
  CROSS JOIN LATERAL (
    SELECT CASE WHEN v.rounding = 'WHOLE' THEN round(x.raw, 0)
                WHEN v.rounding LIKE 'UP_%' THEN ceil(x.raw / x.step) * x.step
                WHEN floor(ceil(x.raw) / x.step) * x.step > 0 THEN floor(ceil(x.raw) / x.step) * x.step
                ELSE ceil(x.raw) END AS price
      FROM (SELECT t.warehouse_price * (100 + v.loose_markup_pct) / 100 AS raw,
                   substring(v.rounding FROM '[0-9]+')::numeric AS step) x
  ) loose
  CROSS JOIN LATERAL (
    SELECT CASE WHEN r.retail = 'WHOLE' THEN round(x.raw, 0)
                WHEN r.retail LIKE 'UP_%' THEN ceil(x.raw / x.step) * x.step
                WHEN floor(ceil(x.raw) / x.step) * x.step > 0 THEN floor(ceil(x.raw) / x.step) * x.step
                ELSE ceil(x.raw) END AS price
      FROM (SELECT t.warehouse_price * (100 + v.retail_markup_pct) / 100 + v.retail_markup_amount AS raw,
                   substring(r.retail FROM '[0-9]+')::numeric AS step) x
  ) retail
  CROSS JOIN LATERAL (
    SELECT CASE WHEN x.raw IS NULL THEN NULL
                WHEN r.bulk = 'WHOLE' THEN round(x.raw, 0)
                WHEN r.bulk LIKE 'UP_%' THEN ceil(x.raw / x.step) * x.step
                WHEN floor(ceil(x.raw) / x.step) * x.step > 0 THEN floor(ceil(x.raw) / x.step) * x.step
                ELSE ceil(x.raw) END AS price
      FROM (SELECT CASE WHEN v.retail_bulk_min_qty IS NULL THEN NULL
                        WHEN v.retail_bulk_discount_pct IS NOT NULL
                          THEN retail.price * (100 - v.retail_bulk_discount_pct) / 100
                        ELSE t.warehouse_price * (100 + v.retail_bulk_markup_pct) / 100
                             + v.retail_markup_amount END AS raw,
                   substring(r.bulk FROM '[0-9]+')::numeric AS step) x
  ) bulk
 WHERE t.valid_from <= today.d AND (t.valid_to IS NULL OR t.valid_to > today.d);
--> statement-breakpoint
-- app's default privileges cover views too: take them back. migrate.ts grants ai_reader again.
REVOKE ALL ON ai.price_profiles, ai.product_prices_today FROM app;
