-- ADR-0143: the wholesale documents' templates (pick list, delivery note), their published versions and
-- each pipeline's choice; by hand: the REVOKEs (the versions are append-only). The first default
-- templates are seeded at boot.
CREATE TABLE "sales_document_template_versions" (
	"template_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"layout" jsonb NOT NULL,
	"published_by" bigint,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_document_template_versions_template_id_version_pk" PRIMARY KEY("template_id","version")
);
--> statement-breakpoint
CREATE TABLE "sales_document_templates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_document_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
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
	CONSTRAINT "sales_document_templates_kind" CHECK ("sales_document_templates"."kind" IN ('PICK_LIST', 'DELIVERY_NOTE')),
	CONSTRAINT "sales_document_templates_name" CHECK (length("sales_document_templates"."name") BETWEEN 1 AND 80),
	CONSTRAINT "sales_document_templates_version" CHECK ("sales_document_templates"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "sales_pipelines" ADD COLUMN "pick_list_template_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_pipelines" ADD COLUMN "delivery_note_template_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_document_template_versions" ADD CONSTRAINT "sales_document_template_versions_template_id_sales_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."sales_document_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_document_template_versions" ADD CONSTRAINT "sales_document_template_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_document_templates" ADD CONSTRAINT "sales_document_templates_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_document_templates" ADD CONSTRAINT "sales_document_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_document_templates_one_default" ON "sales_document_templates" USING btree ("kind") WHERE "sales_document_templates"."is_default";--> statement-breakpoint
ALTER TABLE "sales_pipelines" ADD CONSTRAINT "sales_pipelines_pick_list_template_id_sales_document_templates_id_fk" FOREIGN KEY ("pick_list_template_id") REFERENCES "public"."sales_document_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_pipelines" ADD CONSTRAINT "sales_pipelines_delivery_note_template_id_sales_document_templates_id_fk" FOREIGN KEY ("delivery_note_template_id") REFERENCES "public"."sales_document_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
REVOKE TRUNCATE ON "sales_document_templates" FROM app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "sales_document_template_versions" FROM app;
