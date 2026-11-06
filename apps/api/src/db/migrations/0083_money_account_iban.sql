ALTER TABLE "fin"."money_accounts" ADD COLUMN IF NOT EXISTS "iban" text;--> statement-breakpoint
ALTER TABLE "fin"."money_accounts" ADD COLUMN IF NOT EXISTS "account_holder" text;