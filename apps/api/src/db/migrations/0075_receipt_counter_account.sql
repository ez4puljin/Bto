-- A receipt names the account its bill credits (ADR-0154): 310 «Дансны өглөг» and «Тооллогын зөрүү», each with its own posting key.
ALTER TABLE "goods_receipts" ADD COLUMN "counter_account_code" text;--> statement-breakpoint
INSERT INTO fin.posting_keys (company_id, code, required_control, requires_tax_code)
  SELECT a.company_id, 'AP_' || a.code, 'NONE', false
    FROM fin.accounts a
   WHERE a.code LIKE '3101%' OR a.code = '313011'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO fin.posting_rules (company_id, posting_key, account_id, effective_from)
  SELECT a.company_id, 'AP_' || a.code, a.id, DATE '2000-01-01'
    FROM fin.accounts a
   WHERE (a.code LIKE '3101%' OR a.code = '313011')
     AND NOT EXISTS (SELECT 1 FROM fin.posting_rules r
                      WHERE r.company_id = a.company_id AND r.posting_key = 'AP_' || a.code);
