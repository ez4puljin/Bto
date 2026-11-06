-- ADR-0146: the staff's own side and the dashboard's details: an employee's birth date, education,
-- marital status, district, job level and left reason, their children; notices and news, votes and
-- surveys, the day's mood, feedback, thanks, a sent location and HR's calendar events. By hand: the
-- REVOKEs (an answer changes only when its poll allows it, children and moods are the person's own).
CREATE TABLE "hr_employee_children" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_employee_children_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"name" text,
	"gender" text,
	"birth_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text DEFAULT 'EVENT' NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_events_kind" CHECK ("hr_events"."kind" IN ('EVENT', 'MEETING', 'HOLIDAY')),
	CONSTRAINT "hr_events_dates" CHECK ("hr_events"."to_date" >= "hr_events"."from_date")
);
--> statement-breakpoint
CREATE TABLE "hr_feedback" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_feedback_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"reply" text,
	"replied_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_feedback_category" CHECK ("hr_feedback"."category" IN ('SUGGESTION', 'COMPLAINT', 'QUESTION', 'OTHER')),
	CONSTRAINT "hr_feedback_status" CHECK ("hr_feedback"."status" IN ('NEW', 'SEEN', 'DONE'))
);
--> statement-breakpoint
CREATE TABLE "hr_location_shares" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_location_shares_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"lat" numeric(9, 6) NOT NULL,
	"lng" numeric(9, 6) NOT NULL,
	"accuracy_m" integer,
	"note" text,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_message_reads" (
	"message_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_message_reads_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "hr_message_recipients" (
	"message_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	CONSTRAINT "hr_message_recipients_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "hr_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" text,
	"image_file_id" bigint,
	"popup" boolean DEFAULT false NOT NULL,
	"publish_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_messages_kind" CHECK ("hr_messages"."kind" IN ('NOTICE', 'NEWS'))
);
--> statement-breakpoint
CREATE TABLE "hr_moods" (
	"user_id" bigint NOT NULL,
	"day" date NOT NULL,
	"score" smallint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_moods_user_id_day_pk" PRIMARY KEY("user_id","day"),
	CONSTRAINT "hr_moods_score" CHECK ("hr_moods"."score" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "hr_poll_answers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_poll_answers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"poll_id" bigint NOT NULL,
	"question_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"option_id" bigint,
	"text" text,
	"value" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_poll_answers_value" CHECK ("hr_poll_answers"."value" IS NULL OR "hr_poll_answers"."value" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "hr_poll_options" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_poll_options_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"question_id" bigint NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_poll_questions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_poll_questions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"poll_id" bigint NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"kind" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	CONSTRAINT "hr_poll_questions_kind" CHECK ("hr_poll_questions"."kind" IN ('SINGLE', 'MULTI', 'TEXT', 'SCALE'))
);
--> statement-breakpoint
CREATE TABLE "hr_poll_recipients" (
	"poll_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	CONSTRAINT "hr_poll_recipients_poll_id_user_id_pk" PRIMARY KEY("poll_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "hr_polls" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_polls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"image_file_id" bigint,
	"show_results" boolean DEFAULT false NOT NULL,
	"allow_change" boolean DEFAULT false NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_polls_kind" CHECK ("hr_polls"."kind" IN ('VOTE', 'SURVEY')),
	CONSTRAINT "hr_polls_dates" CHECK ("hr_polls"."ends_at" IS NULL OR "hr_polls"."ends_at" > "hr_polls"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "hr_thanks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_thanks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"from_user_id" bigint NOT NULL,
	"to_user_id" bigint NOT NULL,
	"note" text NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_thanks_not_self" CHECK ("hr_thanks"."from_user_id" <> "hr_thanks"."to_user_id")
);
--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "education" text;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "marital_status" text;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "district" text;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "job_level" text;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "left_reason_kind" text;--> statement-breakpoint
ALTER TABLE "hr_employee_children" ADD CONSTRAINT "hr_employee_children_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_events" ADD CONSTRAINT "hr_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_feedback" ADD CONSTRAINT "hr_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_feedback" ADD CONSTRAINT "hr_feedback_replied_by_users_id_fk" FOREIGN KEY ("replied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_location_shares" ADD CONSTRAINT "hr_location_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_message_reads" ADD CONSTRAINT "hr_message_reads_message_id_hr_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."hr_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_message_reads" ADD CONSTRAINT "hr_message_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_message_recipients" ADD CONSTRAINT "hr_message_recipients_message_id_hr_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."hr_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_message_recipients" ADD CONSTRAINT "hr_message_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_messages" ADD CONSTRAINT "hr_messages_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_messages" ADD CONSTRAINT "hr_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_moods" ADD CONSTRAINT "hr_moods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_poll_answers" ADD CONSTRAINT "hr_poll_answers_poll_id_hr_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."hr_polls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_poll_answers" ADD CONSTRAINT "hr_poll_answers_question_id_hr_poll_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."hr_poll_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_poll_answers" ADD CONSTRAINT "hr_poll_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_poll_answers" ADD CONSTRAINT "hr_poll_answers_option_id_hr_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."hr_poll_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_poll_options" ADD CONSTRAINT "hr_poll_options_question_id_hr_poll_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."hr_poll_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_poll_questions" ADD CONSTRAINT "hr_poll_questions_poll_id_hr_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."hr_polls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_poll_recipients" ADD CONSTRAINT "hr_poll_recipients_poll_id_hr_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."hr_polls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_poll_recipients" ADD CONSTRAINT "hr_poll_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_polls" ADD CONSTRAINT "hr_polls_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_polls" ADD CONSTRAINT "hr_polls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_thanks" ADD CONSTRAINT "hr_thanks_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_thanks" ADD CONSTRAINT "hr_thanks_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hr_employee_children_user_idx" ON "hr_employee_children" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hr_events_dates_idx" ON "hr_events" USING btree ("from_date","to_date");--> statement-breakpoint
CREATE INDEX "hr_feedback_created_idx" ON "hr_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "hr_feedback_user_idx" ON "hr_feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hr_location_shares_day_idx" ON "hr_location_shares" USING btree ("day");--> statement-breakpoint
CREATE INDEX "hr_location_shares_user_idx" ON "hr_location_shares" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "hr_message_recipients_user_idx" ON "hr_message_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hr_messages_publish_idx" ON "hr_messages" USING btree ("kind","publish_at");--> statement-breakpoint
CREATE INDEX "hr_moods_day_idx" ON "hr_moods" USING btree ("day");--> statement-breakpoint
CREATE INDEX "hr_poll_answers_poll_idx" ON "hr_poll_answers" USING btree ("poll_id","user_id");--> statement-breakpoint
CREATE INDEX "hr_poll_answers_question_idx" ON "hr_poll_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "hr_poll_options_question_idx" ON "hr_poll_options" USING btree ("question_id","sort");--> statement-breakpoint
CREATE INDEX "hr_poll_questions_poll_idx" ON "hr_poll_questions" USING btree ("poll_id","sort");--> statement-breakpoint
CREATE INDEX "hr_poll_recipients_user_idx" ON "hr_poll_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hr_polls_starts_idx" ON "hr_polls" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "hr_thanks_day_idx" ON "hr_thanks" USING btree ("day");--> statement-breakpoint
CREATE INDEX "hr_thanks_to_idx" ON "hr_thanks" USING btree ("to_user_id","day");
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "hr_events", "hr_feedback", "hr_location_shares", "hr_message_recipients", "hr_messages", "hr_poll_options", "hr_poll_questions", "hr_poll_recipients", "hr_polls", "hr_thanks" FROM app;
--> statement-breakpoint
REVOKE TRUNCATE ON "hr_poll_answers", "hr_message_reads", "hr_employee_children", "hr_moods" FROM app;
