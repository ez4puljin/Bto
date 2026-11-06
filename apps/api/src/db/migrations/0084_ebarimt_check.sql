CREATE TABLE "ebarimt_check_accounts" (
	"account_code" text PRIMARY KEY NOT NULL,
	"added_by" bigint,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ebarimt_check_assignments" (
	"period" integer NOT NULL,
	"supplier_id" bigint NOT NULL,
	"user_id" bigint,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebarimt_check_assignments_period_supplier_id_pk" PRIMARY KEY("period","supplier_id"),
	CONSTRAINT "ebarimt_check_assignments_period" CHECK ("ebarimt_check_assignments"."period" BETWEEN 200001 AND 210012 AND "ebarimt_check_assignments"."period" % 100 BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "ebarimt_check_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ebarimt_check_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ebarimt_file_id" bigint NOT NULL,
	"row_no" integer NOT NULL,
	"receipt_key" text NOT NULL,
	"ddtd" text,
	"delivery_note_no" text,
	"doc_date" date NOT NULL,
	"partner_name" text,
	"ttd" text NOT NULL,
	"vat_amount" numeric(14, 2) NOT NULL,
	"net_amount" numeric(14, 2) NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"kind" text
);
--> statement-breakpoint
CREATE TABLE "ebarimt_check_files" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ebarimt_check_files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"period" integer NOT NULL,
	"file_id" bigint NOT NULL,
	"file_name" text NOT NULL,
	"row_count" integer NOT NULL,
	"vat_amount" numeric(14, 2) NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"uploaded_by" bigint,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" bigint,
	"closed_at" timestamp with time zone,
	CONSTRAINT "ebarimt_check_files_period" CHECK ("ebarimt_check_files"."period" BETWEEN 200001 AND 210012 AND "ebarimt_check_files"."period" % 100 BETWEEN 1 AND 12),
	CONSTRAINT "ebarimt_check_files_name" CHECK (length("ebarimt_check_files"."file_name") BETWEEN 1 AND 300),
	CONSTRAINT "ebarimt_check_files_rows" CHECK ("ebarimt_check_files"."row_count" >= 0),
	CONSTRAINT "ebarimt_check_files_status" CHECK ("ebarimt_check_files"."status" IN ('ACTIVE', 'REPLACED', 'REMOVED')),
	CONSTRAINT "ebarimt_check_files_closed" CHECK (("ebarimt_check_files"."status" = 'ACTIVE') = ("ebarimt_check_files"."closed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ebarimt_check_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ebarimt_check_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"period" integer NOT NULL,
	"supplier_id" bigint NOT NULL,
	"field" text NOT NULL,
	"user_id" bigint,
	"amount" numeric(14, 2),
	"kind" text NOT NULL,
	"source" text,
	"changed_by" bigint,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebarimt_check_history_period" CHECK ("ebarimt_check_history"."period" BETWEEN 200001 AND 210012 AND "ebarimt_check_history"."period" % 100 BETWEEN 1 AND 12),
	CONSTRAINT "ebarimt_check_history_field" CHECK ("ebarimt_check_history"."field" IN ('EMPLOYEE', 'EBARIMT', 'EXEMPT')),
	CONSTRAINT "ebarimt_check_history_kind" CHECK ("ebarimt_check_history"."kind" IN ('INIT', 'FILE', 'MANUAL', 'REVERT', 'LINK', 'UNLINK', 'EDIT'))
);
--> statement-breakpoint
CREATE TABLE "ebarimt_check_month_values" (
	"period" integer NOT NULL,
	"supplier_id" bigint NOT NULL,
	"exempt_amount" numeric(14, 2) NOT NULL,
	"note" text,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebarimt_check_month_values_period_supplier_id_pk" PRIMARY KEY("period","supplier_id"),
	CONSTRAINT "ebarimt_check_month_values_period" CHECK ("ebarimt_check_month_values"."period" BETWEEN 200001 AND 210012 AND "ebarimt_check_month_values"."period" % 100 BETWEEN 1 AND 12),
	CONSTRAINT "ebarimt_check_month_values_note" CHECK ("ebarimt_check_month_values"."note" IS NULL OR length("ebarimt_check_month_values"."note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "ebarimt_check_receipt_links" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ebarimt_check_receipt_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"period" integer NOT NULL,
	"receipt_key" text NOT NULL,
	"supplier_id" bigint NOT NULL,
	"ttd" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_by" bigint,
	"removed_at" timestamp with time zone,
	CONSTRAINT "ebarimt_check_receipt_links_period" CHECK ("ebarimt_check_receipt_links"."period" BETWEEN 200001 AND 210012 AND "ebarimt_check_receipt_links"."period" % 100 BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "ebarimt_check_supplier_profiles" (
	"supplier_id" bigint PRIMARY KEY NOT NULL,
	"registers" text,
	"phone" text,
	"remark" text,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebarimt_check_supplier_profiles_lengths" CHECK (("ebarimt_check_supplier_profiles"."registers" IS NULL OR length("ebarimt_check_supplier_profiles"."registers") <= 200)
        AND ("ebarimt_check_supplier_profiles"."phone" IS NULL OR length("ebarimt_check_supplier_profiles"."phone") <= 60)
        AND ("ebarimt_check_supplier_profiles"."remark" IS NULL OR length("ebarimt_check_supplier_profiles"."remark") <= 300))
);
--> statement-breakpoint
ALTER TABLE "ebarimt_check_accounts" ADD CONSTRAINT "ebarimt_check_accounts_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_assignments" ADD CONSTRAINT "ebarimt_check_assignments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_assignments" ADD CONSTRAINT "ebarimt_check_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_assignments" ADD CONSTRAINT "ebarimt_check_assignments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_entries" ADD CONSTRAINT "ebarimt_check_entries_ebarimt_file_id_ebarimt_check_files_id_fk" FOREIGN KEY ("ebarimt_file_id") REFERENCES "public"."ebarimt_check_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_files" ADD CONSTRAINT "ebarimt_check_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_files" ADD CONSTRAINT "ebarimt_check_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_files" ADD CONSTRAINT "ebarimt_check_files_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_history" ADD CONSTRAINT "ebarimt_check_history_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_history" ADD CONSTRAINT "ebarimt_check_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_history" ADD CONSTRAINT "ebarimt_check_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_month_values" ADD CONSTRAINT "ebarimt_check_month_values_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_month_values" ADD CONSTRAINT "ebarimt_check_month_values_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_receipt_links" ADD CONSTRAINT "ebarimt_check_receipt_links_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_receipt_links" ADD CONSTRAINT "ebarimt_check_receipt_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_receipt_links" ADD CONSTRAINT "ebarimt_check_receipt_links_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_supplier_profiles" ADD CONSTRAINT "ebarimt_check_supplier_profiles_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_check_supplier_profiles" ADD CONSTRAINT "ebarimt_check_supplier_profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ebarimt_check_assignments_supplier_idx" ON "ebarimt_check_assignments" USING btree ("supplier_id","period");--> statement-breakpoint
CREATE INDEX "ebarimt_check_entries_file_idx" ON "ebarimt_check_entries" USING btree ("ebarimt_file_id","row_no");--> statement-breakpoint
CREATE INDEX "ebarimt_check_entries_ttd_idx" ON "ebarimt_check_entries" USING btree ("ebarimt_file_id","ttd");--> statement-breakpoint
CREATE INDEX "ebarimt_check_entries_key_idx" ON "ebarimt_check_entries" USING btree ("ebarimt_file_id","receipt_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ebarimt_check_files_active_key" ON "ebarimt_check_files" USING btree ("period") WHERE "ebarimt_check_files"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "ebarimt_check_files_period_idx" ON "ebarimt_check_files" USING btree ("period","id");--> statement-breakpoint
CREATE INDEX "ebarimt_check_history_period_idx" ON "ebarimt_check_history" USING btree ("period","supplier_id","field","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebarimt_check_receipt_links_live_key" ON "ebarimt_check_receipt_links" USING btree ("period","receipt_key") WHERE "ebarimt_check_receipt_links"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ebarimt_check_receipt_links_period_idx" ON "ebarimt_check_receipt_links" USING btree ("period","id");