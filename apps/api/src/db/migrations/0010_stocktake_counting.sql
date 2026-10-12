ALTER TABLE "stocktake_bins" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stocktake_bins" ADD COLUMN "finished_by" bigint;--> statement-breakpoint
ALTER TABLE "stocktake_lines" ADD COLUMN "counted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stocktake_bins" ADD CONSTRAINT "stocktake_bins_finished_by_users_id_fk" FOREIGN KEY ("finished_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_bins" ADD CONSTRAINT "stocktake_bins_finished" CHECK (("stocktake_bins"."finished_at" IS NULL) = ("stocktake_bins"."finished_by" IS NULL));--> statement-breakpoint
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_counted" CHECK ("stocktake_lines"."counted_at" IS NULL OR "stocktake_lines"."counted_qty" IS NOT NULL);