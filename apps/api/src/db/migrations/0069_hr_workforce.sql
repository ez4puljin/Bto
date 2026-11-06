-- ADR-0144: HR beyond the punch — divisions, schedules per weekday, the employee card, time request
-- types and requests, the REQUEST punch source; by hand: the REVOKEs (nothing here is deleted). The
-- first request types are seeded at boot.
CREATE TABLE "hr_divisions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_divisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_divisions_name" CHECK (length(btrim("hr_divisions"."name")) BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "hr_request_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_request_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"group" text NOT NULL,
	"color" text NOT NULL,
	"whole_days" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_request_types_name" CHECK (length(btrim("hr_request_types"."name")) BETWEEN 1 AND 60),
	CONSTRAINT "hr_request_types_group" CHECK ("hr_request_types"."group" IN ('NOT_WORKED', 'WORKED', 'OVERTIME', 'OVERTIME_LEAVE', 'PUNCH_CHOSEN', 'PUNCH_SENT', 'OTHER')),
	CONSTRAINT "hr_request_types_color" CHECK ("hr_request_types"."color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "hr_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"type_id" bigint NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"punch_kind" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"accuracy_m" integer,
	"note" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"decided_by" bigint,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"event_id" bigint,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_requests_dates" CHECK ("hr_requests"."to_date" >= "hr_requests"."from_date"),
	CONSTRAINT "hr_requests_hours" CHECK (("hr_requests"."starts_at" IS NULL AND "hr_requests"."ends_at" IS NULL) OR ("hr_requests"."starts_at" IS NOT NULL AND ("hr_requests"."ends_at" IS NULL OR "hr_requests"."ends_at" > "hr_requests"."starts_at"))),
	CONSTRAINT "hr_requests_status" CHECK ("hr_requests"."status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
	CONSTRAINT "hr_requests_punch_kind" CHECK ("hr_requests"."punch_kind" IS NULL OR "hr_requests"."punch_kind" IN ('IN', 'OUT')),
	CONSTRAINT "hr_requests_gps_pair" CHECK (("hr_requests"."lat" IS NULL) = ("hr_requests"."lng" IS NULL)),
	CONSTRAINT "hr_requests_note" CHECK ("hr_requests"."note" IS NULL OR length("hr_requests"."note") BETWEEN 1 AND 300),
	CONSTRAINT "hr_requests_decided" CHECK (("hr_requests"."decided_at" IS NULL) = ("hr_requests"."decided_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "hr_schedules" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_schedules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"color" text DEFAULT '#f59e0b' NOT NULL,
	"days" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"updated_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_schedules_name" CHECK (length(btrim("hr_schedules"."name")) BETWEEN 1 AND 60),
	CONSTRAINT "hr_schedules_kind" CHECK ("hr_schedules"."kind" IN ('FIXED', 'FLEXIBLE')),
	CONSTRAINT "hr_schedules_color" CHECK ("hr_schedules"."color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
ALTER TABLE "hr_attendance_events" DROP CONSTRAINT "hr_attendance_events_source";--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "position" text;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "division_id" bigint;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "employment_type" text DEFAULT 'PERMANENT' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "employed_on" date;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "left_on" date;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "left_reason" text;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "photo_file_id" bigint;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "schedule_id" bigint;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_type_id_hr_request_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."hr_request_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_event_id_hr_attendance_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."hr_attendance_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_schedules" ADD CONSTRAINT "hr_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_divisions_name_key" ON "hr_divisions" USING btree (lower("name")) WHERE "hr_divisions"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_request_types_name_key" ON "hr_request_types" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "hr_requests_user_idx" ON "hr_requests" USING btree ("user_id","from_date");--> statement-breakpoint
CREATE INDEX "hr_requests_status_idx" ON "hr_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "hr_requests_dates_idx" ON "hr_requests" USING btree ("from_date","to_date");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_schedules_name_key" ON "hr_schedules" USING btree (lower("name")) WHERE "hr_schedules"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_division_id_hr_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."hr_divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_photo_file_id_files_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_schedule_id_hr_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."hr_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_employees_external_ref_key" ON "hr_employees" USING btree ("external_ref") WHERE "hr_employees"."external_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "hr_employees_division_idx" ON "hr_employees" USING btree ("division_id");--> statement-breakpoint
ALTER TABLE "hr_attendance_events" ADD CONSTRAINT "hr_attendance_events_source" CHECK ("hr_attendance_events"."source" IN ('APP', 'OFFICE', 'REQUEST'));--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_employment_type" CHECK ("hr_employees"."employment_type" IN ('PERMANENT', 'PROBATION', 'CONTRACT', 'PART_TIME', 'INTERN'));--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_gender" CHECK ("hr_employees"."gender" IS NULL OR "hr_employees"."gender" IN ('MALE', 'FEMALE'));--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_names" CHECK (("hr_employees"."first_name" IS NULL OR length(btrim("hr_employees"."first_name")) BETWEEN 1 AND 60) AND ("hr_employees"."last_name" IS NULL OR length(btrim("hr_employees"."last_name")) BETWEEN 1 AND 60));--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_position" CHECK ("hr_employees"."position" IS NULL OR length(btrim("hr_employees"."position")) BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_left" CHECK (("hr_employees"."left_on" IS NOT NULL) OR ("hr_employees"."left_reason" IS NULL));--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "hr_divisions", "hr_schedules", "hr_request_types", "hr_requests" FROM app;
