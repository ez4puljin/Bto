-- ADR-0236: a goods receipt's delivery-note discounts are income on 520202 «Худалдан авалтын
-- хөнгөлөлт». Data only, and only adds (ADR-0206): what the api's boot step and an empty chart's
-- template give a new database, written here for a company whose chart already has accounts.
-- Nothing happens on an empty database. Erkhet's chart has the account already; it is added only
-- where no account and no group holds the code.
-- purchase_discount:data:begin
INSERT INTO fin.accounts (company_id, code, name, kind, normal_side, control)
  SELECT c.id, '520202', 'Худалдан авалтын хөнгөлөлт', 'INCOME', 'CREDIT', 'NONE'
    FROM fin.companies c
   WHERE EXISTS (SELECT 1 FROM fin.accounts a WHERE a.company_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM fin.account_groups g
                      WHERE g.company_id = c.id AND g.code = '520202')
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO fin.posting_keys (company_id, code, required_control, requires_tax_code)
  SELECT c.id, 'PURCHASE_DISCOUNT', 'NONE', false
    FROM fin.companies c
   WHERE EXISTS (SELECT 1 FROM fin.accounts a WHERE a.company_id = c.id)
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The key's company-default rule from the beginning, unless it is mapped already. Only a plain,
-- active income account takes it: one that carries a control (a party, money) or is switched off
-- is left for the check below.
INSERT INTO fin.posting_rules (company_id, posting_key, account_id, effective_from)
  SELECT c.id, 'PURCHASE_DISCOUNT', a.id, DATE '2000-01-01'
    FROM fin.companies c
    JOIN fin.accounts a ON a.company_id = c.id AND a.code = '520202'
   WHERE a.kind = 'INCOME' AND a.control = 'NONE' AND a.status = 'ACTIVE'
     AND NOT EXISTS (SELECT 1 FROM fin.posting_rules r
                      WHERE r.company_id = c.id AND r.posting_key = 'PURCHASE_DISCOUNT')
   ORDER BY c.id;
--> statement-breakpoint
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.code, ', ' ORDER BY c.code) INTO missing
    FROM fin.companies c
   WHERE EXISTS (SELECT 1 FROM fin.accounts a WHERE a.company_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM fin.posting_rules r
                      WHERE r.company_id = c.id AND r.posting_key = 'PURCHASE_DISCOUNT');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'purchase_discount: company % has no active income account 520202 without a control (a group or another kind of account holds the code); the key PURCHASE_DISCOUNT needs one', missing;
  END IF;
END $$;
-- purchase_discount:data:end
