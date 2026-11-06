CREATE TABLE "supplier_orderer_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supplier_orderer_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"supplier_id" bigint NOT NULL,
	"user_id" bigint,
	"effective_date" date NOT NULL,
	"changed_by" bigint,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ebarimt_check_history" DROP CONSTRAINT "ebarimt_check_history_kind";--> statement-breakpoint
DROP INDEX "ebarimt_check_entries_ttd_idx";--> statement-breakpoint
DROP INDEX "ebarimt_check_entries_key_idx";--> statement-breakpoint
ALTER TABLE "supplier_orderer_history" ADD CONSTRAINT "supplier_orderer_history_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orderer_history" ADD CONSTRAINT "supplier_orderer_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_orderer_history" ADD CONSTRAINT "supplier_orderer_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_orderer_history_supplier_idx" ON "supplier_orderer_history" USING btree ("supplier_id","effective_date","id");--> statement-breakpoint
ALTER TABLE "ebarimt_check_history" ADD CONSTRAINT "ebarimt_check_history_kind" CHECK ("ebarimt_check_history"."kind" IN ('INIT', 'FILE', 'MANUAL', 'REVERT', 'LINK', 'UNLINK', 'EDIT', 'REMOVE'));--> statement-breakpoint
-- Today's orderers stand from the beginning: nothing older is known (ADR-0170).
INSERT INTO "supplier_orderer_history" ("supplier_id", "user_id", "effective_date", "changed_by", "changed_at")
SELECT "supplier_id", "user_id", DATE '2000-01-01', "updated_by", "updated_at" FROM "supplier_orderers";
