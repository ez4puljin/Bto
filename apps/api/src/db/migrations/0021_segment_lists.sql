-- Hand-picked product segments (ADR-0052): a segment's kind (RULES: ADR-0049's saved conditions;
-- LIST: products put in by hand, no definition) and the members of a LIST segment. Members are
-- inserted and deleted, never updated, and the table is never truncated.
CREATE TABLE "segment_products" (
	"segment_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "segment_products_segment_id_product_id_pk" PRIMARY KEY("segment_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "segments" DROP CONSTRAINT "segments_definition";--> statement-breakpoint
ALTER TABLE "segments" ALTER COLUMN "definition" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "kind" text DEFAULT 'RULES' NOT NULL;--> statement-breakpoint
ALTER TABLE "segment_products" ADD CONSTRAINT "segment_products_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_products" ADD CONSTRAINT "segment_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_kind" CHECK ("segments"."kind" IN ('RULES', 'LIST'));--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_kind_definition" CHECK (("segments"."kind" = 'RULES' AND "segments"."definition" IS NOT NULL AND jsonb_typeof("segments"."definition") = 'object')
        OR ("segments"."kind" = 'LIST' AND "segments"."definition" IS NULL AND "segments"."entity" = 'PRODUCT'));--> statement-breakpoint
REVOKE UPDATE, TRUNCATE ON "segment_products" FROM app;
