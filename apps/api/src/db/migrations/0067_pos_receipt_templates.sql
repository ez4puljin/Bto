-- ADR-0141: the receipt templates, their published versions and each POS's choice; by hand: the
-- REVOKEs (the versions are append-only). The first default templates are seeded at boot.
CREATE TABLE "pos_receipt_template_versions" (
	"template_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"layout" jsonb NOT NULL,
	"published_by" bigint,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_receipt_template_versions_template_id_version_pk" PRIMARY KEY("template_id","version")
);
--> statement-breakpoint
CREATE TABLE "pos_receipt_templates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pos_receipt_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"layout" jsonb NOT NULL,
	"draft" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"published_by" bigint,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_receipt_templates_kind" CHECK ("pos_receipt_templates"."kind" IN ('SALE', 'RETURN')),
	CONSTRAINT "pos_receipt_templates_name" CHECK (length("pos_receipt_templates"."name") BETWEEN 1 AND 80),
	CONSTRAINT "pos_receipt_templates_version" CHECK ("pos_receipt_templates"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "pos_tills" ADD COLUMN "sale_template_id" bigint;--> statement-breakpoint
ALTER TABLE "pos_tills" ADD COLUMN "return_template_id" bigint;--> statement-breakpoint
ALTER TABLE "pos_receipt_template_versions" ADD CONSTRAINT "pos_receipt_template_versions_template_id_pos_receipt_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."pos_receipt_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_receipt_template_versions" ADD CONSTRAINT "pos_receipt_template_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_receipt_templates" ADD CONSTRAINT "pos_receipt_templates_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_receipt_templates" ADD CONSTRAINT "pos_receipt_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_receipt_templates_one_default" ON "pos_receipt_templates" USING btree ("kind") WHERE "pos_receipt_templates"."is_default";--> statement-breakpoint
ALTER TABLE "pos_tills" ADD CONSTRAINT "pos_tills_sale_template_id_pos_receipt_templates_id_fk" FOREIGN KEY ("sale_template_id") REFERENCES "public"."pos_receipt_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tills" ADD CONSTRAINT "pos_tills_return_template_id_pos_receipt_templates_id_fk" FOREIGN KEY ("return_template_id") REFERENCES "public"."pos_receipt_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
REVOKE TRUNCATE ON "pos_receipt_templates" FROM app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "pos_receipt_template_versions" FROM app;
