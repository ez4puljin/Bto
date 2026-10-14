-- Segments (ADR-0049): saved AND/OR conditions over products, customers and suppliers, evaluated by
-- the data owners. A segment is archived, never deleted: discounts and messages will refer to it.
CREATE TABLE "segments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "segments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"definition_version" smallint DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" bigint,
	"updated_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "segments_entity" CHECK ("segments"."entity" IN ('PRODUCT', 'CUSTOMER', 'SUPPLIER')),
	CONSTRAINT "segments_name" CHECK (length("segments"."name") BETWEEN 1 AND 80),
	CONSTRAINT "segments_description" CHECK ("segments"."description" IS NULL OR length("segments"."description") BETWEEN 1 AND 500),
	CONSTRAINT "segments_definition" CHECK (jsonb_typeof("segments"."definition") = 'object')
);
--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "segments_live_name" ON "segments" USING btree ("entity","name_key") WHERE "segments"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "segments_entity_idx" ON "segments" USING btree ("entity","id");--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "segments" FROM app;