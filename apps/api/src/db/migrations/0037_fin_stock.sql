-- Finance Core F4 — stock and cost (ADR-0097). Data only: what the api's boot step and an empty
-- chart's seed give a new database, written here for a database whose company and chart exist.
-- Nothing happens on an empty database (no company BO yet).
-- fin_stock:data:begin
-- The accounts of the stock's value, with temporary codes until Erkhet's chart (TODO-VERIFY D8, D16).
INSERT INTO fin.accounts (company_id, code, name, kind, normal_side, control)
  SELECT c.id, a.code, a.name, a.kind, a.side, 'NONE'
    FROM fin.companies c
   CROSS JOIN (VALUES
     ('310201', 'Нэхэмжлэл ирээгүй бараа', 'LIABILITY', 'CREDIT'),
     ('610101', 'Борлуулсан барааны өртөг', 'EXPENSE', 'DEBIT'),
     ('740201', 'Барааны дутагдал, хорогдол', 'EXPENSE', 'DEBIT'),
     ('511030', 'Барааны илүүдэл', 'INCOME', 'CREDIT'),
     ('390101', 'Эхний үлдэгдлийн түр данс', 'EQUITY', 'CREDIT'),
     ('730201', 'Дотоод хэрэгцээний бараа', 'EXPENSE', 'DEBIT'),
     ('730202', 'Урамшууллын бараа', 'EXPENSE', 'DEBIT'),
     ('730203', 'Маркетингийн бараа', 'EXPENSE', 'DEBIT'),
     ('730204', 'Актласан бараа', 'EXPENSE', 'DEBIT'),
     ('730205', 'Бусад байгууллагад шилжүүлсэн бараа', 'EXPENSE', 'DEBIT'),
     ('730209', 'Бусад зарлагын бараа', 'EXPENSE', 'DEBIT')
   ) AS a (code, name, kind, side)
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO fin.posting_keys (company_id, code, required_control, requires_tax_code)
  SELECT c.id, k.code, 'NONE', false
    FROM fin.companies c
   CROSS JOIN (VALUES ('GOODS_RECEIVED'), ('COGS'), ('STOCK_LOSS'), ('STOCK_GAIN'), ('OPENING_STOCK'),
     ('ISSUE_INTERNAL'), ('ISSUE_BONUS'), ('ISSUE_MARKETING'), ('ISSUE_WRITE_OFF'),
     ('ISSUE_TRANSFER_OUT'), ('ISSUE_OTHER')) AS k (code)
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Each new key's company-default rule from the beginning, unless the accountant already mapped it.
INSERT INTO fin.posting_rules (company_id, posting_key, account_id, effective_from)
  SELECT c.id, m.key, a.id, DATE '2000-01-01'
    FROM fin.companies c
   CROSS JOIN (VALUES ('GOODS_RECEIVED', '310201'), ('COGS', '610101'), ('STOCK_LOSS', '740201'),
     ('STOCK_GAIN', '511030'), ('OPENING_STOCK', '390101'), ('ISSUE_INTERNAL', '730201'),
     ('ISSUE_BONUS', '730202'), ('ISSUE_MARKETING', '730203'), ('ISSUE_WRITE_OFF', '730204'),
     ('ISSUE_TRANSFER_OUT', '730205'), ('ISSUE_OTHER', '730209')) AS m (key, code)
    JOIN fin.accounts a ON a.company_id = c.id AND a.code = m.code
   WHERE c.code = 'BO'
     AND NOT EXISTS (SELECT 1 FROM fin.posting_rules r
                      WHERE r.company_id = c.id AND r.posting_key = m.key)
   ORDER BY m.key;
--> statement-breakpoint
-- The stock value documents' number series (TODO-VERIFY) and their document type.
INSERT INTO fin.number_series (company_id, code, pattern, digits)
  SELECT id, 'STOCK', 'Б-{year}{month}{day}-', 4 FROM fin.companies WHERE code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO fin.document_types (company_id, code, source_system_id, class, number_mode, number_series)
  SELECT c.id, 'BTO.STOCK_VALUE', s.id, 'JOURNAL', 'CORE', 'STOCK'
    FROM fin.companies c
    JOIN fin.source_systems s ON s.tenant_id = c.tenant_id AND s.code = 'BTO'
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fin.companies WHERE code = 'BO')
     AND ((SELECT count(*) FROM fin.document_types) <> 13
          OR (SELECT count(*) FROM fin.number_series) <> 4
          OR (SELECT count(DISTINCT posting_key) FROM fin.posting_rules
               WHERE posting_key IN ('GOODS_RECEIVED', 'COGS', 'STOCK_LOSS', 'STOCK_GAIN',
                 'OPENING_STOCK', 'ISSUE_INTERNAL', 'ISSUE_BONUS', 'ISSUE_MARKETING',
                 'ISSUE_WRITE_OFF', 'ISSUE_TRANSFER_OUT', 'ISSUE_OTHER')) <> 11) THEN
    RAISE EXCEPTION 'fin_stock: the stock document type, its series or the stock rules are incomplete';
  END IF;
END $$;
-- fin_stock:data:end
