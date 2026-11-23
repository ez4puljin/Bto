-- «Ашгийн самбар»'s operating expenses, other income and tax from the books (ADR-0238,
-- docs/modules/reporting.md). SQL only, like 0046: only a migration names a `fin` relation
-- (tools/finance-core/fin-sql.test.mjs), so the reporting module reads the journal and the chart
-- through these views. Nothing changes in `fin`; app gets SELECT on the three views, ai_reader
-- nothing. Every row carries its company's code: the services keep to the installation's company.

-- Every posted journal line on an INCOME or EXPENSE account, live. `amount` is signed by the
-- account: an expense positive on an EXPENSE account (debit − credit), an income positive on an
-- INCOME account (credit − debit). The year close (ADR-0105: documents of type YEAR_CLOSE that move
-- the year's result into retained earnings) and its reversals are left out, as the income statement
-- leaves them out (statementBalances), or every closed year would read zero. A reversal stays: it
-- nets its original out on its own date, as the books have it. `branch_id` is Bto's branch
-- (`public.branches.id`, through the BTO source's branch refs), NULL for a line without one.
CREATE VIEW reporting.ledger_lines AS
SELECT c.code AS company_code, l.id AS line_id, e.id AS entry_id, e.entry_date,
       e.number AS entry_number, d.number AS document_number,
       coalesce(d.source_doc_type, e.source_doc_type) AS source_doc_type,
       coalesce(d.source_doc_id, e.source_doc_id) AS source_doc_id,
       e.reverses_id IS NOT NULL AS is_reversal,
       coalesce(l.description, e.description) AS description,
       a.id AS account_id, a.code AS account_code, a.name AS account_name, a.kind AS account_kind,
       a.group_id,
       CASE WHEN r.external_id ~ '^[0-9]{1,18}$' THEN r.external_id::bigint END AS branch_id,
       l.party_id, pa.name AS party_name,
       CASE WHEN a.kind = 'EXPENSE' THEN l.debit - l.credit ELSE l.credit - l.debit END AS amount
  FROM fin.journal_lines l
  JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
  JOIN fin.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
  JOIN fin.companies c ON c.id = l.company_id
  LEFT JOIN fin.documents d ON d.company_id = e.company_id AND d.id = e.document_id
  LEFT JOIN fin.parties pa ON pa.tenant_id = c.tenant_id AND pa.id = l.party_id
  LEFT JOIN fin.source_systems s ON s.tenant_id = c.tenant_id AND s.code = 'BTO'
  LEFT JOIN fin.branch_refs r
    ON r.company_id = l.company_id AND r.source_system_id = s.id AND r.branch_id = l.branch_id
 WHERE a.kind IN ('INCOME', 'EXPENSE')
   AND e.source_doc_type IS DISTINCT FROM 'YEAR_CLOSE'
   AND NOT EXISTS (
         SELECT 1 FROM fin.journal_entries o
          WHERE o.company_id = e.company_id AND o.id = e.reverses_id
            AND o.source_doc_type = 'YEAR_CLOSE');
--> statement-breakpoint

-- The chart's accounts (every kind and status): which accounts a group holds.
CREATE VIEW reporting.ledger_accounts AS
SELECT c.code AS company_code, a.id AS account_id, a.code, a.name, a.kind, a.group_id, a.status
  FROM fin.accounts a
  JOIN fin.companies c ON c.id = a.company_id;
--> statement-breakpoint

-- The chart's group tree (ADR-0148).
CREATE VIEW reporting.ledger_groups AS
SELECT c.code AS company_code, g.id AS group_id, g.code, g.name, g.parent_id, g.sort
  FROM fin.account_groups g
  JOIN fin.companies c ON c.id = g.company_id;
--> statement-breakpoint
REVOKE ALL ON reporting.ledger_lines, reporting.ledger_accounts, reporting.ledger_groups FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON reporting.ledger_lines, reporting.ledger_accounts, reporting.ledger_groups TO app;
