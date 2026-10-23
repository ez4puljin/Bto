-- Finance Core F6 — the year close (ADR-0105). Data only: what the api's boot step and an empty
-- chart's seed give a new database, written here for a database whose company and chart exist.
-- Nothing happens on an empty database (no company BO yet).
-- fin_year_close:data:begin
-- Retained earnings, a temporary code until Erkhet's chart (TODO-VERIFY D16).
INSERT INTO fin.accounts (company_id, code, name, kind, normal_side, control)
  SELECT c.id, '340101', 'Хуримтлагдсан ашиг (алдагдал)', 'EQUITY', 'CREDIT', 'NONE'
    FROM fin.companies c
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO fin.posting_keys (company_id, code, required_control, requires_tax_code)
  SELECT id, 'RETAINED_EARNINGS', 'NONE', false FROM fin.companies WHERE code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The key's company-default rule from the beginning, unless the accountant already mapped it.
INSERT INTO fin.posting_rules (company_id, posting_key, account_id, effective_from)
  SELECT c.id, 'RETAINED_EARNINGS', a.id, DATE '2000-01-01'
    FROM fin.companies c
    JOIN fin.accounts a ON a.company_id = c.id AND a.code = '340101'
   WHERE c.code = 'BO'
     AND NOT EXISTS (SELECT 1 FROM fin.posting_rules r
                      WHERE r.company_id = c.id AND r.posting_key = 'RETAINED_EARNINGS');
--> statement-breakpoint
-- The year close's document type (a journal of the core's screens, numbered from the journal series).
INSERT INTO fin.document_types (company_id, code, source_system_id, class, number_mode, number_series)
  SELECT c.id, 'FIN.YEAR_CLOSE', s.id, 'JOURNAL', 'CORE', 'JOURNAL'
    FROM fin.companies c
    JOIN fin.source_systems s ON s.tenant_id = c.tenant_id AND s.code = 'FIN'
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fin.companies WHERE code = 'BO')
     AND (NOT EXISTS (SELECT 1 FROM fin.document_types WHERE code = 'FIN.YEAR_CLOSE')
          OR NOT EXISTS (SELECT 1 FROM fin.posting_rules WHERE posting_key = 'RETAINED_EARNINGS')) THEN
    RAISE EXCEPTION 'fin_year_close: the year close type or the retained-earnings rule is missing';
  END IF;
END $$;
-- fin_year_close:data:end
