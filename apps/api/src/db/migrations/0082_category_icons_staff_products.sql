CREATE TABLE "staff_app_assortment_segments" (
	"assortment_id" bigint NOT NULL,
	"segment_id" bigint NOT NULL,
	CONSTRAINT "staff_app_assortment_segments_assortment_id_segment_id_pk" PRIMARY KEY("assortment_id","segment_id")
);
--> statement-breakpoint
CREATE TABLE "staff_app_assortment_users" (
	"assortment_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	CONSTRAINT "staff_app_assortment_users_assortment_id_user_id_pk" PRIMARY KEY("assortment_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "staff_app_assortments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "staff_app_assortments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "staff_app_assortments_title" CHECK (length("staff_app_assortments"."title") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "icon_key" text;--> statement-breakpoint
ALTER TABLE "staff_app_assortment_segments" ADD CONSTRAINT "staff_app_assortment_segments_assortment_id_staff_app_assortments_id_fk" FOREIGN KEY ("assortment_id") REFERENCES "public"."staff_app_assortments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_app_assortment_users" ADD CONSTRAINT "staff_app_assortment_users_assortment_id_staff_app_assortments_id_fk" FOREIGN KEY ("assortment_id") REFERENCES "public"."staff_app_assortments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_app_assortment_users" ADD CONSTRAINT "staff_app_assortment_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_app_assortments" ADD CONSTRAINT "staff_app_assortments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_app_assortments" ADD CONSTRAINT "staff_app_assortments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_app_assortment_users_user_idx" ON "staff_app_assortment_users" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_icon_key" CHECK ("categories"."icon_key" IS NULL OR length("categories"."icon_key") BETWEEN 1 AND 40);