CREATE TABLE "rep_collections" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rep_collections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"method" text NOT NULL,
	"note" text,
	"collected_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"payment_id" bigint,
	"payment_number" text,
	"decided_by" bigint,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "rep_collections_amount" CHECK ("rep_collections"."amount" > 0),
	CONSTRAINT "rep_collections_method" CHECK ("rep_collections"."method" IN ('CASH', 'TRANSFER')),
	CONSTRAINT "rep_collections_status" CHECK ("rep_collections"."status" IN ('PENDING', 'RECORDED', 'REJECTED')),
	CONSTRAINT "rep_collections_decided" CHECK (("rep_collections"."status" = 'PENDING') = ("rep_collections"."decided_by" IS NULL)
        AND ("rep_collections"."decided_by" IS NULL) = ("rep_collections"."decided_at" IS NULL)
        AND ("rep_collections"."status" = 'RECORDED') = ("rep_collections"."payment_id" IS NOT NULL)
        AND ("rep_collections"."payment_id" IS NULL) = ("rep_collections"."payment_number" IS NULL)
        AND ("rep_collections"."status" = 'REJECTED') = ("rep_collections"."decision_note" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "rep_visit_plans" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rep_visit_plans_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"weekday" smallint NOT NULL,
	"customer_id" bigint NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rep_visit_plans_key" UNIQUE("user_id","weekday","customer_id"),
	CONSTRAINT "rep_visit_plans_weekday" CHECK ("rep_visit_plans"."weekday" BETWEEN 1 AND 7)
);
--> statement-breakpoint
CREATE TABLE "rep_visits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rep_visits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"visited_on" date NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" text NOT NULL,
	"note" text,
	CONSTRAINT "rep_visits_result" CHECK ("rep_visits"."result" IN ('ORDERED', 'NO_ORDER', 'CLOSED', 'PAYMENT')),
	CONSTRAINT "rep_visits_note" CHECK ("rep_visits"."note" IS NULL OR char_length("rep_visits"."note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "rep_collections" ADD CONSTRAINT "rep_collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_collections" ADD CONSTRAINT "rep_collections_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_collections" ADD CONSTRAINT "rep_collections_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_visit_plans" ADD CONSTRAINT "rep_visit_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_visit_plans" ADD CONSTRAINT "rep_visit_plans_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_visit_plans" ADD CONSTRAINT "rep_visit_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_visits" ADD CONSTRAINT "rep_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_visits" ADD CONSTRAINT "rep_visits_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rep_collections_status_idx" ON "rep_collections" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "rep_collections_user_idx" ON "rep_collections" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "rep_collections_customer_idx" ON "rep_collections" USING btree ("customer_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "rep_collections_payment_key" ON "rep_collections" USING btree ("payment_id") WHERE "rep_collections"."payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "rep_visit_plans_customer_idx" ON "rep_visit_plans" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "rep_visits_user_idx" ON "rep_visits" USING btree ("user_id","visited_on");--> statement-breakpoint
CREATE INDEX "rep_visits_customer_idx" ON "rep_visits" USING btree ("customer_id","visited_on");--> statement-breakpoint
-- ADR-0183: a visit and a report of collected money are history; they are never removed.
REVOKE DELETE, TRUNCATE ON "rep_visits" FROM app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "rep_collections" FROM app;
