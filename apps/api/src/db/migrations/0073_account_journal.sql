-- ADR-0149: an account's journal and currency, as in Erkhet.
ALTER TABLE "fin"."accounts" ADD COLUMN "journal" text DEFAULT 'GENERAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "fin"."accounts" ADD COLUMN "currency" char(3) DEFAULT 'MNT' NOT NULL;--> statement-breakpoint
ALTER TABLE "fin"."accounts" ADD CONSTRAINT "fin_accounts_journal" CHECK ("fin"."accounts"."journal" IN ('GENERAL', 'CASH', 'BANK', 'MONEY', 'RECEIVABLE_PAYABLE', 'VAT', 'INVENTORY', 'FIXED_ASSET'));--> statement-breakpoint
ALTER TABLE "fin"."accounts" ADD CONSTRAINT "fin_accounts_currency" CHECK ("fin"."accounts"."currency" ~ '^[A-Z]{3}$');