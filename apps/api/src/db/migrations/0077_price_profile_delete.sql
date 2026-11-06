-- ADR-0160: a price profile can be deleted out of every list; its row stays.
ALTER TABLE "price_profiles" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "price_profiles" ADD COLUMN "deleted_by" bigint;--> statement-breakpoint
ALTER TABLE "price_profiles" ADD CONSTRAINT "price_profiles_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- The assistant reads profiles as the screens do: no deleted ones (ADR-0160).
DROP VIEW ai.price_profiles;
--> statement-breakpoint
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
 WHERE pp.deleted_at IS NULL AND (v.valid_to IS NULL OR v.valid_to > v.valid_from);
