ALTER TABLE "hr_events" ADD COLUMN "done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hr_events" ADD COLUMN "done_by" bigint;--> statement-breakpoint
ALTER TABLE "hr_events" ADD CONSTRAINT "hr_events_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_events" ADD CONSTRAINT "hr_events_done" CHECK (("hr_events"."done_at" IS NULL) = ("hr_events"."done_by" IS NULL));