-- ADR-0250. A posted bank line keeps what the books hold of it, so an edit after posting is seen and
-- «Гүйлгээ засах» writes only the changed lines again; a fee's and a settlement's own Erkhet party.
ALTER TABLE "bank_statement_lines" ADD COLUMN "posted_fields" jsonb;--> statement-breakpoint
ALTER TABLE "bank_statement_settings" ADD COLUMN "fee_party_code" text;--> statement-breakpoint
ALTER TABLE "bank_statement_settings" ADD COLUMN "settlement_party_code" text;--> statement-breakpoint
-- A line posted until now could not be edited after posting: its fields are what the books hold.
UPDATE "bank_statement_lines"
SET "posted_fields" = jsonb_build_object(
  'customerId', "customer_id",
  'supplierId', "supplier_id",
  'counterAccountId', "counter_account_id",
  'description', "description",
  'action', "action"
)
WHERE "posted_at" IS NOT NULL;
