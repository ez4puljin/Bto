-- Finance Core F3 — payables (ADR-0091). Data only: what the api's boot step (ensureDefaultCompany)
-- and an empty chart's seed (ensureDefaultChart) give a new database, written here for a database
-- whose company and chart already exist. Nothing happens on an empty database (no company BO yet).
-- fin_payables:data:begin
-- The three accounts of a supplier's bill, with temporary codes until Erkhet's chart (TODO-VERIFY
-- D16): the payable (a party-control account), the VAT inside purchases, the stock it pays for.
INSERT INTO fin.accounts (company_id, code, name, kind, normal_side, control)
  SELECT c.id, a.code, a.name, a.kind, a.side, a.control
    FROM fin.companies c
   CROSS JOIN (VALUES
     ('310101', 'Дансны өглөг', 'LIABILITY', 'CREDIT', 'PAYABLE'),
     ('130301', 'НӨАТ-ын авлага (худалдан авалт)', 'ASSET', 'DEBIT', 'NONE'),
     ('140101', 'Бараа материал', 'ASSET', 'DEBIT', 'NONE')
   ) AS a (code, name, kind, side, control)
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO fin.posting_keys (company_id, code, required_control, requires_tax_code)
  SELECT c.id, k.code, k.control, k.tax
    FROM fin.companies c
   CROSS JOIN (VALUES ('AP', 'PAYABLE', false), ('VAT_INPUT', 'NONE', true), ('INVENTORY', 'NONE', false))
     AS k (code, control, tax)
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Each new key's company-default rule from the beginning, unless the accountant already mapped it.
INSERT INTO fin.posting_rules (company_id, posting_key, account_id, effective_from)
  SELECT c.id, m.key, a.id, DATE '2000-01-01'
    FROM fin.companies c
   CROSS JOIN (VALUES ('AP', '310101'), ('VAT_INPUT', '130301'), ('INVENTORY', '140101'))
     AS m (key, code)
    JOIN fin.accounts a ON a.company_id = c.id AND a.code = m.code
   WHERE c.code = 'BO'
     AND NOT EXISTS (SELECT 1 FROM fin.posting_rules r
                      WHERE r.company_id = c.id AND r.posting_key = m.key)
   ORDER BY m.key;
--> statement-breakpoint
-- Bto's purchase documents, numbered by Bto (the receipt's or the issue's number).
INSERT INTO fin.document_types (company_id, code, source_system_id, class, number_mode, number_series)
  SELECT c.id, t.code, s.id, t.class, 'SOURCE', NULL
    FROM fin.companies c
   CROSS JOIN (VALUES
     ('BTO.SUPPLIER_BILL', 'AP_BILL'),
     ('BTO.SUPPLIER_BILL_CREDIT', 'AP_CREDIT'),
     ('BTO.RECEIPT_RECOST', 'JOURNAL'),
     ('BTO.SUPPLIER_RETURN', 'AP_CREDIT')
   ) AS t (code, class)
    JOIN fin.source_systems s ON s.tenant_id = c.tenant_id AND s.code = 'BTO'
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- One party per Bto supplier (a company; suppliers have no kind), its ref `supplier:<id>` and its
-- place in BO, as the SUPPLIER_CHANGED hook makes it. One statement: the ids are drawn once in `src`.
WITH t AS (SELECT t.id, s.id AS source_id
             FROM fin.tenants t JOIN fin.source_systems s ON s.tenant_id = t.id AND s.code = 'BTO'
            WHERE t.code = 'BUTEN_ORGIL'),
     src AS MATERIALIZED (
       SELECT su.id AS supplier_id, su.name, su.tin, su.reg_no,
              nextval(pg_get_serial_sequence('fin.parties', 'id')) AS party_id
         FROM public.suppliers su, t
        WHERE EXISTS (SELECT 1 FROM fin.companies c WHERE c.code = 'BO')
          AND NOT EXISTS (SELECT 1 FROM fin.party_refs r
                           WHERE r.tenant_id = t.id AND r.source_system_id = t.source_id
                             AND r.external_id = 'supplier:' || su.id)),
     p AS (INSERT INTO fin.parties (id, tenant_id, kind, name, tin, register_no)
             OVERRIDING SYSTEM VALUE
             SELECT src.party_id, t.id, 'COMPANY', src.name, src.tin, src.reg_no FROM src, t
           RETURNING id),
     r AS (INSERT INTO fin.party_refs (tenant_id, source_system_id, external_id, party_id)
             SELECT t.id, t.source_id, 'supplier:' || src.supplier_id, src.party_id FROM src, t)
INSERT INTO fin.party_companies (company_id, party_id, tenant_id)
  SELECT c.id, src.party_id, c.tenant_id FROM src, fin.companies c WHERE c.code = 'BO';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fin.companies WHERE code = 'BO')
     AND ((SELECT count(*) FROM fin.document_types) <> 12
          OR (SELECT count(DISTINCT posting_key) FROM fin.posting_rules
               WHERE posting_key IN ('AP', 'VAT_INPUT', 'INVENTORY')) <> 3
          OR (SELECT count(*) FROM fin.party_refs WHERE external_id LIKE 'supplier:%')
             <> (SELECT count(*) FROM public.suppliers)) THEN
    RAISE EXCEPTION 'fin_payables: the document types, the payable rules or the suppliers'' parties are incomplete';
  END IF;
END $$;
-- fin_payables:data:end
