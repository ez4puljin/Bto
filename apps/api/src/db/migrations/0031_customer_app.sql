CREATE TABLE "app_notice_customer_reads" (
	"notice_id" bigint NOT NULL,
	"customer_user_id" bigint NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_notice_customer_reads_notice_id_customer_user_id_pk" PRIMARY KEY("notice_id","customer_user_id")
);
--> statement-breakpoint
CREATE TABLE "company_contacts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "company_contacts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"role" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"position" smallint NOT NULL,
	"shown" boolean DEFAULT true NOT NULL,
	"created_by" bigint,
	"updated_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_contacts_role" CHECK (length(btrim("company_contacts"."role")) BETWEEN 1 AND 60),
	CONSTRAINT "company_contacts_name" CHECK (length(btrim("company_contacts"."name")) BETWEEN 1 AND 80),
	CONSTRAINT "company_contacts_phone" CHECK ("company_contacts"."phone" ~ '^[+]976[0-9]{8}$'),
	CONSTRAINT "company_contacts_position_range" CHECK ("company_contacts"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "customer_favourites" (
	"customer_user_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_favourites_customer_user_id_product_id_pk" PRIMARY KEY("customer_user_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "customer_notifications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "customer_notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"customer_user_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"order_id" bigint,
	"invoice_id" bigint,
	"payment_id" bigint,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "customer_notifications_order" UNIQUE("kind","order_id"),
	CONSTRAINT "customer_notifications_invoice" UNIQUE("kind","invoice_id"),
	CONSTRAINT "customer_notifications_payment" UNIQUE("kind","payment_id"),
	CONSTRAINT "customer_notifications_kind" CHECK ("customer_notifications"."kind" IN ('ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_SOLD', 'PAYMENT_RECORDED', 'INVOICE_DUE_SOON', 'INVOICE_OVERDUE')),
	CONSTRAINT "customer_notifications_document" CHECK (CASE
        WHEN "customer_notifications"."kind" IN ('ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_SOLD')
          THEN "customer_notifications"."order_id" IS NOT NULL AND "customer_notifications"."payment_id" IS NULL
        WHEN "customer_notifications"."kind" = 'PAYMENT_RECORDED'
          THEN "customer_notifications"."payment_id" IS NOT NULL AND "customer_notifications"."order_id" IS NULL AND "customer_notifications"."invoice_id" IS NULL
        ELSE "customer_notifications"."invoice_id" IS NOT NULL AND "customer_notifications"."order_id" IS NULL AND "customer_notifications"."payment_id" IS NULL
      END)
);
--> statement-breakpoint
CREATE TABLE "customer_password_codes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "customer_password_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"customer_user_id" bigint NOT NULL,
	"code_hash" text NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "customer_password_codes_attempts" CHECK ("customer_password_codes"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "customer_users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"customer_id" bigint NOT NULL,
	"phone" text NOT NULL,
	"password_hash" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"last_sign_in_at" timestamp with time zone,
	"created_by" bigint,
	"updated_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_users_phone_e164" CHECK ("customer_users"."phone" ~ '^[+]976[0-9]{8}$'),
	CONSTRAINT "customer_users_status" CHECK ("customer_users"."status" IN ('ACTIVE', 'DISABLED')),
	CONSTRAINT "customer_users_failed_login_count" CHECK ("customer_users"."failed_login_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP CONSTRAINT "auth_sessions_revoked_reason";--> statement-breakpoint
ALTER TABLE "auth_sessions" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app_notices" ADD COLUMN "audience" text DEFAULT 'SALES_REPS' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "kind" text DEFAULT 'STAFF' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "customer_user_id" bigint;--> statement-breakpoint
ALTER TABLE "money_accounts" ADD COLUMN "show_to_customers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "customer_user_id" bigint;--> statement-breakpoint
ALTER TABLE "app_notice_customer_reads" ADD CONSTRAINT "app_notice_customer_reads_notice_id_app_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."app_notices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_notice_customer_reads" ADD CONSTRAINT "app_notice_customer_reads_customer_user_id_customer_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_favourites" ADD CONSTRAINT "customer_favourites_customer_user_id_customer_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_favourites" ADD CONSTRAINT "customer_favourites_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_customer_user_id_customer_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_password_codes" ADD CONSTRAINT "customer_password_codes_customer_user_id_customer_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_password_codes" ADD CONSTRAINT "customer_password_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_users" ADD CONSTRAINT "customer_users_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_users" ADD CONSTRAINT "customer_users_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_contacts_position" ON "company_contacts" USING btree ("position");--> statement-breakpoint
CREATE INDEX "customer_notifications_account_idx" ON "customer_notifications" USING btree ("customer_user_id","id");--> statement-breakpoint
CREATE INDEX "customer_notifications_unread_idx" ON "customer_notifications" USING btree ("customer_user_id") WHERE "customer_notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_password_codes_one_live" ON "customer_password_codes" USING btree ("customer_user_id") WHERE "customer_password_codes"."used_at" IS NULL AND "customer_password_codes"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_users_customer_key" ON "customer_users" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_users_phone_key" ON "customer_users" USING btree ("phone");--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_customer_user_id_customer_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_user_id_customer_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_customer_user_id_idx" ON "auth_sessions" USING btree ("customer_user_id");--> statement-breakpoint
ALTER TABLE "app_notices" ADD CONSTRAINT "app_notices_audience" CHECK ("app_notices"."audience" IN ('SALES_REPS', 'CUSTOMERS'));--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_kind" CHECK ("auth_sessions"."kind" IN ('STAFF', 'CUSTOMER'));--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_principal" CHECK (("auth_sessions"."kind" = 'STAFF' AND "auth_sessions"."user_id" IS NOT NULL AND "auth_sessions"."customer_user_id" IS NULL)
        OR ("auth_sessions"."kind" = 'CUSTOMER' AND "auth_sessions"."customer_user_id" IS NOT NULL AND "auth_sessions"."user_id" IS NULL));--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_revoked_reason" CHECK (("auth_sessions"."revoked_at" IS NULL) = ("auth_sessions"."revoked_reason" IS NULL)
        AND ("auth_sessions"."revoked_reason" IS NULL OR "auth_sessions"."revoked_reason" IN
          ('LOGOUT', 'LOGOUT_ALL', 'ADMIN', 'PASSWORD_CHANGED', 'USER_DISABLED', 'TOKEN_REUSE',
           'PHONE_CHANGED', 'ACCOUNT_DISABLED', 'CUSTOMER_INACTIVE')));--> statement-breakpoint
ALTER TABLE "money_accounts" ADD CONSTRAINT "money_accounts_show_to_customers" CHECK (NOT "money_accounts"."show_to_customers" OR "money_accounts"."kind" = 'BANK');--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_app" CHECK (("sales_orders"."channel" = 'CUSTOMER_APP') = ("sales_orders"."customer_user_id" IS NOT NULL));--> statement-breakpoint

-- Hand-written (ADR-0082): identity imports no module, so the account's customer is referenced here,
-- as partners' foreign key, not in identity's Drizzle schema. Customers are never deleted.
ALTER TABLE "customer_users" ADD CONSTRAINT "customer_users_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Hand-written: an app account is closed, never deleted (ADR-0079 #3); its codes and the store's
-- favourites are removed one by one, never truncated.
REVOKE DELETE, TRUNCATE ON "customer_users" FROM app;--> statement-breakpoint
REVOKE TRUNCATE ON "customer_password_codes", "customer_favourites", "company_contacts" FROM app;--> statement-breakpoint
REVOKE UPDATE ON "customer_favourites" FROM app;--> statement-breakpoint

-- Hand-written: a store's notification stays; only the moment it was read is set (as for staff).
REVOKE UPDATE, DELETE, TRUNCATE ON "customer_notifications" FROM app;--> statement-breakpoint
GRANT UPDATE ("read_at") ON "customer_notifications" TO app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "app_notice_customer_reads" FROM app;
