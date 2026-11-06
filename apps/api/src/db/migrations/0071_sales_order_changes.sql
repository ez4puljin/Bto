-- ADR-0147: an order's change versions; by hand: append-only for the app.
CREATE TABLE "sales_order_changes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_order_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"fields" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"total_before" numeric(14, 2),
	"total_after" numeric(14, 2),
	"actor_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_changes_version" UNIQUE("order_id","version"),
	CONSTRAINT "sales_order_changes_version_positive" CHECK ("sales_order_changes"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "sales_order_changes" ADD CONSTRAINT "sales_order_changes_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_changes" ADD CONSTRAINT "sales_order_changes_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "sales_order_changes" FROM app;
