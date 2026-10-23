-- The customers' settlement days (ADR-0101): every customer is «Мөрөн» (DAY_20: the 21st–20th due
-- on the 20th) or «Орон нутаг» (MONTH_END: a month due on its last day), and the group replaces the
-- payment term in days. The group is required (owner 2026-10-23); rows that exist before this
-- migration (none in the development database, test copies only) become DAY_20, which the office
-- corrects on the card. Invoices already issued keep their due dates. ai.customers uses the dropped
-- column, so it is recreated with the group (db:migrate grants the ai views to ai_reader).
DROP VIEW ai.customers;--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_payment_term";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "settlement_group" text;--> statement-breakpoint
UPDATE "customers" SET "settlement_group" = 'DAY_20';--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "settlement_group" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_settlement_group" CHECK ("customers"."settlement_group" IN ('DAY_20', 'MONTH_END'));--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "payment_term_days";--> statement-breakpoint
CREATE VIEW ai.customers AS
SELECT c.id, c.code, c.kind, c.name, c.reg_no, c.tin, c.consumer_no, c.phone, c.vat_payer,
       c.city_payer, c.credit_limit, c.settlement_group, c.credit_hold, c.credit_hold_reason,
       c.status, c.note,
       (SELECT a.address FROM public.customer_addresses a
         WHERE a.customer_id = c.id AND a.is_default) AS default_address,
       c.created_at, c.updated_at
  FROM public.customers c;
