CREATE TABLE "statement_row_links" (
	"account_id" bigint PRIMARY KEY NOT NULL,
	"row_code" text NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statement_row_links_row" CHECK (length("statement_row_links"."row_code") BETWEEN 1 AND 16)
);
--> statement-breakpoint
ALTER TABLE "statement_row_links" ADD CONSTRAINT "statement_row_links_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;