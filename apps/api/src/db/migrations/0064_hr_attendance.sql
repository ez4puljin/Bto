-- ADR-0131: attendance from the staff app (hr module). Hand-edited after drizzle-kit generate:
-- a punch is never rewritten or deleted (struck out through its deleted_* columns), the sites,
-- the schedule and the employees' terms are never deleted either.
CREATE TABLE "hr_attendance_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_attendance_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"business_date" date NOT NULL,
	"source" text NOT NULL,
	"site_id" bigint,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"accuracy_m" integer,
	"distance_m" integer,
	"note" text,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" bigint,
	"delete_reason" text,
	CONSTRAINT "hr_attendance_events_kind" CHECK ("hr_attendance_events"."kind" IN ('IN', 'OUT')),
	CONSTRAINT "hr_attendance_events_source" CHECK ("hr_attendance_events"."source" IN ('APP', 'OFFICE')),
	CONSTRAINT "hr_attendance_events_gps_pair" CHECK (("hr_attendance_events"."lat" IS NULL) = ("hr_attendance_events"."lng" IS NULL)),
	CONSTRAINT "hr_attendance_events_app_fix" CHECK ("hr_attendance_events"."source" <> 'APP' OR ("hr_attendance_events"."lat" IS NOT NULL AND "hr_attendance_events"."site_id" IS NOT NULL AND "hr_attendance_events"."distance_m" IS NOT NULL)),
	CONSTRAINT "hr_attendance_events_note" CHECK ("hr_attendance_events"."note" IS NULL OR length("hr_attendance_events"."note") BETWEEN 1 AND 200),
	CONSTRAINT "hr_attendance_events_deleted" CHECK (("hr_attendance_events"."deleted_at" IS NULL) = ("hr_attendance_events"."deleted_by" IS NULL) AND ("hr_attendance_events"."deleted_at" IS NULL) = ("hr_attendance_events"."delete_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "hr_employee_sites" (
	"user_id" bigint NOT NULL,
	"site_id" bigint NOT NULL,
	CONSTRAINT "hr_employee_sites_user_id_site_id_pk" PRIMARY KEY("user_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "hr_employees" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"tracked" boolean DEFAULT true NOT NULL,
	"work_start" text,
	"work_end" text,
	"grace_minutes" smallint,
	"workdays" text,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_employees_work_start" CHECK ("hr_employees"."work_start" IS NULL OR "hr_employees"."work_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "hr_employees_work_end" CHECK ("hr_employees"."work_end" IS NULL OR "hr_employees"."work_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "hr_employees_grace" CHECK ("hr_employees"."grace_minutes" IS NULL OR "hr_employees"."grace_minutes" BETWEEN 0 AND 120),
	CONSTRAINT "hr_employees_workdays" CHECK ("hr_employees"."workdays" IS NULL OR "hr_employees"."workdays" ~ '^[01]{7}$')
);
--> statement-breakpoint
CREATE TABLE "hr_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"work_start" text DEFAULT '09:00' NOT NULL,
	"work_end" text DEFAULT '18:00' NOT NULL,
	"grace_minutes" smallint DEFAULT 10 NOT NULL,
	"workdays" text DEFAULT '1111110' NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_settings_single" CHECK ("hr_settings"."id" = 1),
	CONSTRAINT "hr_settings_work_start" CHECK ("hr_settings"."work_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "hr_settings_work_end" CHECK ("hr_settings"."work_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "hr_settings_grace" CHECK ("hr_settings"."grace_minutes" BETWEEN 0 AND 120),
	CONSTRAINT "hr_settings_workdays" CHECK ("hr_settings"."workdays" ~ '^[01]{7}$')
);
--> statement-breakpoint
CREATE TABLE "hr_work_sites" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_work_sites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"lat" numeric(9, 6) NOT NULL,
	"lng" numeric(9, 6) NOT NULL,
	"radius_m" smallint DEFAULT 150 NOT NULL,
	"branch_id" bigint,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_work_sites_name_present" CHECK (length(btrim("hr_work_sites"."name")) BETWEEN 1 AND 60),
	CONSTRAINT "hr_work_sites_radius" CHECK ("hr_work_sites"."radius_m" BETWEEN 30 AND 2000),
	CONSTRAINT "hr_work_sites_in_mongolia" CHECK ("hr_work_sites"."lat" BETWEEN 41.5 AND 52.2 AND "hr_work_sites"."lng" BETWEEN 87.7 AND 120)
);
--> statement-breakpoint
ALTER TABLE "hr_attendance_events" ADD CONSTRAINT "hr_attendance_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance_events" ADD CONSTRAINT "hr_attendance_events_site_id_hr_work_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."hr_work_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance_events" ADD CONSTRAINT "hr_attendance_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_attendance_events" ADD CONSTRAINT "hr_attendance_events_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_sites" ADD CONSTRAINT "hr_employee_sites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employee_sites" ADD CONSTRAINT "hr_employee_sites_site_id_hr_work_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."hr_work_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_settings" ADD CONSTRAINT "hr_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_work_sites" ADD CONSTRAINT "hr_work_sites_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hr_attendance_events_user_date_idx" ON "hr_attendance_events" USING btree ("user_id","business_date","at");--> statement-breakpoint
CREATE INDEX "hr_attendance_events_date_idx" ON "hr_attendance_events" USING btree ("business_date","at");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_work_sites_name_key" ON "hr_work_sites" USING btree (lower("name")) WHERE "hr_work_sites"."archived_at" IS NULL;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "hr_work_sites" FROM app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "hr_settings" FROM app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "hr_employees" FROM app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "hr_attendance_events" FROM app;--> statement-breakpoint
GRANT UPDATE ("deleted_at", "deleted_by", "delete_reason") ON "hr_attendance_events" TO app;
