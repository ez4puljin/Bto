-- ADR-0148: the chart's groups as Erkhet's tree: the group above each and its place there.
ALTER TABLE "fin"."account_groups" ADD COLUMN "parent_id" bigint;--> statement-breakpoint
ALTER TABLE "fin"."account_groups" ADD COLUMN "sort" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fin"."account_groups" ADD CONSTRAINT "fin_account_groups_parent_fk" FOREIGN KEY ("company_id","parent_id") REFERENCES "fin"."account_groups"("company_id","id") ON DELETE no action ON UPDATE no action;