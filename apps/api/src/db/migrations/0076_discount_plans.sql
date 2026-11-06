-- ADR-0159: the discount programs take Erxes' pricing plans' conditions.
CREATE TABLE "discount_program_links" (
	"program_id" bigint NOT NULL,
	"role" text NOT NULL,
	"ref_id" bigint NOT NULL,
	CONSTRAINT "discount_program_links_program_id_role_ref_id_pk" PRIMARY KEY("program_id","role","ref_id"),
	CONSTRAINT "discount_program_links_role" CHECK ("discount_program_links"."role" IN ('TARGET', 'EXCLUDE_TARGET', 'EXCLUDE_PRODUCT', 'PIPELINE', 'TILL'))
);
--> statement-breakpoint
ALTER TABLE "discount_programs" DROP CONSTRAINT "discount_programs_list";--> statement-breakpoint
ALTER TABLE "discount_programs" DROP CONSTRAINT "discount_programs_effect";--> statement-breakpoint
ALTER TABLE "discount_programs" DROP CONSTRAINT "discount_programs_shape";--> statement-breakpoint
ALTER TABLE "discount_programs" ADD COLUMN "state" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_programs" ADD COLUMN "priority" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_programs" ADD COLUMN "target_kind" text;--> statement-breakpoint
ALTER TABLE "discount_programs" ADD COLUMN "adjust_kind" text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_programs" ADD COLUMN "adjust_factor" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_programs" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discount_programs" ADD COLUMN "deleted_by" bigint;--> statement-breakpoint
ALTER TABLE "discount_steps" ADD COLUMN "rule" text DEFAULT 'MINIMUM' NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_program_links" ADD CONSTRAINT "discount_program_links_program_id_discount_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."discount_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_programs" ADD CONSTRAINT "discount_programs_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_programs" ADD CONSTRAINT "discount_programs_state" CHECK ("discount_programs"."state" IN ('DRAFT', 'ACTIVE', 'ARCHIVED'));--> statement-breakpoint
ALTER TABLE "discount_programs" ADD CONSTRAINT "discount_programs_target_kind" CHECK ("discount_programs"."target_kind" IS NULL OR "discount_programs"."target_kind" IN ('PRODUCT', 'CATEGORY', 'SUPPLIER', 'SEGMENT'));--> statement-breakpoint
ALTER TABLE "discount_programs" ADD CONSTRAINT "discount_programs_adjust_kind" CHECK ("discount_programs"."adjust_kind" IN ('NONE', 'ROUND', 'FLOOR', 'CEIL', 'ENDS_9'));--> statement-breakpoint
ALTER TABLE "discount_programs" ADD CONSTRAINT "discount_programs_adjust" CHECK ("discount_programs"."adjust_factor" >= 1
        AND ("discount_programs"."adjust_kind" = 'NONE' OR ("discount_programs"."scope" = 'PRODUCT' AND "discount_programs"."effect" <> 'BONUS')));--> statement-breakpoint
ALTER TABLE "discount_programs" ADD CONSTRAINT "discount_programs_list" CHECK ("discount_programs"."list" IN ('WHOLESALE', 'RETAIL', 'ALL'));--> statement-breakpoint
ALTER TABLE "discount_programs" ADD CONSTRAINT "discount_programs_effect" CHECK ("discount_programs"."effect" IN ('PRICE', 'PERCENT', 'AMOUNT', 'BONUS'));--> statement-breakpoint
ALTER TABLE "discount_programs" ADD CONSTRAINT "discount_programs_shape" CHECK (("discount_programs"."scope" = 'PRODUCT' AND ("discount_programs"."product_id" IS NOT NULL) <> ("discount_programs"."target_kind" IS NOT NULL)
          AND "discount_programs"."category_id" IS NULL AND "discount_programs"."count_uom_id" IS NULL
          AND ("discount_programs"."target_kind" IS NULL
            OR ("discount_programs"."product_unit_id" IS NULL AND "discount_programs"."threshold_unit_id" IS NULL))
          AND ("discount_programs"."effect" IN ('PERCENT', 'BONUS') OR "discount_programs"."target_kind" IS NOT NULL
            OR "discount_programs"."product_unit_id" IS NOT NULL)
          AND ("discount_programs"."effect" <> 'BONUS' OR ("discount_programs"."measure" = 'QTY' AND "discount_programs"."product_unit_id" IS NULL)))
        OR ("discount_programs"."scope" = 'CATEGORY' AND ("discount_programs"."category_id" IS NOT NULL) <> ("discount_programs"."target_kind" IS NOT NULL)
          AND "discount_programs"."product_id" IS NULL AND "discount_programs"."product_unit_id" IS NULL AND "discount_programs"."threshold_unit_id" IS NULL
          AND "discount_programs"."effect" IN ('PERCENT', 'AMOUNT') AND NOT "discount_programs"."priority"
          AND ("discount_programs"."measure" = 'QTY') = ("discount_programs"."count_uom_id" IS NOT NULL))
        OR ("discount_programs"."scope" = 'ORDER' AND "discount_programs"."target_kind" IS NULL AND "discount_programs"."product_id" IS NULL
          AND "discount_programs"."product_unit_id" IS NULL AND "discount_programs"."threshold_unit_id" IS NULL AND "discount_programs"."category_id" IS NULL
          AND "discount_programs"."count_uom_id" IS NULL AND "discount_programs"."measure" = 'AMOUNT' AND NOT "discount_programs"."priority"
          AND "discount_programs"."effect" IN ('PERCENT', 'AMOUNT')));--> statement-breakpoint
ALTER TABLE "discount_steps" ADD CONSTRAINT "discount_steps_rule" CHECK ("discount_steps"."rule" IN ('MINIMUM', 'EXACT', 'EVERY'));--> statement-breakpoint

-- Hand-written: one new price per unit and channel on a day, among the programs that can apply.
ALTER TABLE "discount_programs" DROP CONSTRAINT "discount_programs_one_price";
--> statement-breakpoint
ALTER TABLE "discount_programs" ADD CONSTRAINT "discount_programs_one_price"
  EXCLUDE USING gist ("list" WITH =, "product_unit_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&)
  WHERE ("effect" = 'PRICE' AND "state" = 'ACTIVE' AND "deleted_at" IS NULL);
--> statement-breakpoint

-- The assistant reads plans as the screens do: no deleted ones, status with the state.
DROP VIEW ai.discount_programs;
--> statement-breakpoint
CREATE VIEW ai.discount_programs AS
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Ulaanbaatar')::date AS d)
SELECT dp.id, dp.name, dp.list, dp.scope, dp.measure, dp.effect, dp.product_id,
       p.name AS product_name, pm.name AS unit_name, tm.name AS threshold_unit_name,
       dp.category_id, c.path AS category_path, cm.name AS count_unit_name, dp.valid_from,
       dp.valid_to,
       CASE WHEN dp.state IN ('DRAFT', 'ARCHIVED') THEN dp.state
            WHEN dp.valid_to IS NOT NULL AND (dp.valid_to <= today.d OR dp.valid_to <= dp.valid_from)
            THEN 'ENDED'
            WHEN dp.valid_from > today.d THEN 'SCHEDULED'
            ELSE 'ACTIVE' END AS status,
       (SELECT string_agg(s.threshold::text || ' => ' || s.value::text, '; ' ORDER BY s.threshold)
          FROM public.discount_steps s WHERE s.program_id = dp.id) AS steps,
       dp.priority, dp.target_kind,
       dp.created_at, u.full_name AS created_by_name
  FROM public.discount_programs dp
  CROSS JOIN today
  LEFT JOIN public.products p ON p.id = dp.product_id
  LEFT JOIN public.product_units pu ON pu.id = dp.product_unit_id
  LEFT JOIN public.uoms pm ON pm.id = pu.uom_id
  LEFT JOIN public.product_units tu ON tu.id = dp.threshold_unit_id
  LEFT JOIN public.uoms tm ON tm.id = tu.uom_id
  LEFT JOIN ai.categories c ON c.id = dp.category_id
  LEFT JOIN public.uoms cm ON cm.id = dp.count_uom_id
  LEFT JOIN public.users u ON u.id = dp.created_by
 WHERE dp.deleted_at IS NULL;
