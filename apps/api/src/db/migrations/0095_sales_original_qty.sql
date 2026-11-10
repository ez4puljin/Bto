ALTER TABLE "sales_order_excluded_lines" ADD COLUMN "original_qty" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "original_qty" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "sales_order_excluded_lines" ADD CONSTRAINT "sales_order_excluded_lines_original" CHECK ("sales_order_excluded_lines"."original_qty" IS NULL OR "sales_order_excluded_lines"."original_qty" > 0);--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_original" CHECK ("sales_order_lines"."original_qty" IS NULL OR "sales_order_lines"."original_qty" > 0);--> statement-breakpoint
-- ADR-0178 #3: existing lines take their first ordered quantity from the order's change versions
-- (ADR-0147), which name a line by product, unit and warehouse: the earliest version saved after
-- the draft that names it gives the quantity before it (a line it added has none); a line no such
-- version names, or one of two lines of the same unit and warehouse, keeps its quantity.
WITH "entries" AS (
  SELECT DISTINCT ON (c."order_id", e->>'productName', e->>'unitName', e->>'warehouseId')
    c."order_id",
    e->>'productName' AS "product_name",
    e->>'unitName' AS "unit_name",
    (e->>'warehouseId')::bigint AS "warehouse_id",
    e->>'kind' AS "kind",
    e->>'qtyBefore' AS "qty_before"
  FROM "sales_order_changes" c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c."lines") = 'array' THEN c."lines" ELSE '[]'::jsonb END
  ) e
  WHERE c."status" <> 'DRAFT'
  ORDER BY c."order_id", e->>'productName', e->>'unitName', e->>'warehouseId', c."version"
), "named" AS (
  SELECT l."id", l."order_id", p."name" AS "product_name", u."name" AS "unit_name", l."warehouse_id",
    count(*) OVER (PARTITION BY l."order_id", l."product_unit_id", l."warehouse_id") AS "same"
  FROM "sales_order_lines" l
  JOIN "products" p ON p."id" = l."product_id"
  JOIN "product_units" pu ON pu."id" = l."product_unit_id"
  JOIN "uoms" u ON u."id" = pu."uom_id"
), "firsts" AS (
  SELECT n."id", n."same", e."kind", e."qty_before"
  FROM "named" n
  LEFT JOIN "entries" e ON e."order_id" = n."order_id" AND e."product_name" = n."product_name"
    AND e."unit_name" = n."unit_name" AND e."warehouse_id" = n."warehouse_id"
)
UPDATE "sales_order_lines" l SET "original_qty" = CASE
    WHEN f."kind" IS NULL OR f."same" > 1 THEN l."qty"
    WHEN f."kind" = 'ADDED' OR f."qty_before" IS NULL THEN NULL
    ELSE f."qty_before"::numeric(14, 3)
  END
FROM "firsts" f
WHERE f."id" = l."id";
--> statement-breakpoint
WITH "entries" AS (
  SELECT DISTINCT ON (c."order_id", e->>'productName', e->>'unitName', e->>'warehouseId')
    c."order_id",
    e->>'productName' AS "product_name",
    e->>'unitName' AS "unit_name",
    (e->>'warehouseId')::bigint AS "warehouse_id",
    e->>'kind' AS "kind",
    e->>'qtyBefore' AS "qty_before"
  FROM "sales_order_changes" c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c."lines") = 'array' THEN c."lines" ELSE '[]'::jsonb END
  ) e
  WHERE c."status" <> 'DRAFT'
  ORDER BY c."order_id", e->>'productName', e->>'unitName', e->>'warehouseId', c."version"
), "firsts" AS (
  SELECT x."id", e."kind", e."qty_before"
  FROM "sales_order_excluded_lines" x
  JOIN "products" p ON p."id" = x."product_id"
  JOIN "product_units" pu ON pu."id" = x."product_unit_id"
  JOIN "uoms" u ON u."id" = pu."uom_id"
  LEFT JOIN "entries" e ON e."order_id" = x."order_id" AND e."product_name" = p."name"
    AND e."unit_name" = u."name" AND e."warehouse_id" = x."warehouse_id"
)
UPDATE "sales_order_excluded_lines" x SET "original_qty" = CASE
    WHEN f."kind" IS NULL THEN x."qty"
    WHEN f."kind" = 'ADDED' OR f."qty_before" IS NULL THEN NULL
    ELSE f."qty_before"::numeric(14, 3)
  END
FROM "firsts" f
WHERE f."id" = x."id";
