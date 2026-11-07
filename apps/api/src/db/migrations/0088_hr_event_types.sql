-- The calendar's types become HR's own list (ADR-0171). The three kinds that were fixed in code stay as
-- its first rows, keeping their colours; `kind` on a type is what an installed staff app draws.
CREATE TABLE "hr_event_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_event_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"color" text NOT NULL,
	"kind" text DEFAULT 'EVENT' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_event_types_name" CHECK (length(btrim("hr_event_types"."name")) BETWEEN 1 AND 40),
	CONSTRAINT "hr_event_types_color" CHECK ("hr_event_types"."color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "hr_event_types_kind" CHECK ("hr_event_types"."kind" IN ('EVENT', 'MEETING', 'HOLIDAY'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "hr_event_types_name_key" ON "hr_event_types" USING btree (lower("name"));--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "hr_event_types" FROM app;--> statement-breakpoint
INSERT INTO "hr_event_types" ("name", "color", "kind") VALUES
	('Үйл явдал', '#0071e3', 'EVENT'),
	('Хурал', '#7c3aed', 'MEETING'),
	('Амралтын өдөр', '#c2255c', 'HOLIDAY');--> statement-breakpoint
ALTER TABLE "hr_events" ADD COLUMN "type_id" bigint;--> statement-breakpoint
UPDATE "hr_events" SET "type_id" = "hr_event_types"."id"
	FROM "hr_event_types" WHERE "hr_event_types"."kind" = "hr_events"."kind";--> statement-breakpoint
ALTER TABLE "hr_events" ALTER COLUMN "type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_events" ADD CONSTRAINT "hr_events_type_id_hr_event_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."hr_event_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hr_events_type_idx" ON "hr_events" USING btree ("type_id");--> statement-breakpoint
ALTER TABLE "hr_events" DROP CONSTRAINT "hr_events_kind";--> statement-breakpoint
ALTER TABLE "hr_events" DROP COLUMN "kind";
