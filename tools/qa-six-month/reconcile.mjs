import { DAYS, FIRST_DAY, LAST_DAY, MONTHS, QA_DATABASE } from './dataset.mjs';
import { hash } from './journal.mjs';

/**
 * Independent UP_10 invoice-ratio arithmetic. Keep the numerator exact; integer quotient/remainder
 * avoids PostgreSQL division precision moving an exact rounding boundary to the next ten tugriks.
 */
export const MONTH_CLOSING_PRICE_SQL = `WITH months AS(
  SELECT to_char(d,'YYYY-MM') AS month,least((date_trunc('month',d)+interval '1 month'-interval '1 day')::date,$2::date) closing_day
  FROM generate_series($1::date,$2::date,'1 month') d)
  SELECT m.month,p.sku,r.receipt_id,r.printed_unit_price,r.printed_price_factor,r.markup_pct,r.markup_amount,
    price.expected_price,
    t.warehouse_price effective_price FROM months m CROSS JOIN products p
  LEFT JOIN LATERAL(
    SELECT g.id receipt_id,g.effective_date,l.printed_unit_price,l.printed_price_factor,s.enabled,s.rounding,s.markup_pct,s.markup_amount
    FROM goods_receipt_lines l JOIN goods_receipts g ON g.id=l.receipt_id
    LEFT JOIN supplier_price_rules s ON s.supplier_id=g.supplier_id
    WHERE l.product_id=p.id AND g.status='POSTED' AND g.effective_date<=m.closing_day
    ORDER BY g.posted_at DESC,g.id DESC LIMIT 1) r ON true
  CROSS JOIN LATERAL(SELECT
    r.printed_unit_price*(100+r.markup_pct)+r.markup_amount*r.printed_price_factor*100 AS numerator,
    nullif(r.printed_price_factor*1000,0) AS denominator) ratio
  CROSS JOIN LATERAL(SELECT
    (div(ratio.numerator,ratio.denominator)+CASE WHEN mod(ratio.numerator,ratio.denominator)>0 THEN 1 ELSE 0 END)*10 AS expected_price) price
  LEFT JOIN product_prices t ON t.product_id=p.id AND t.valid_from<=m.closing_day AND (t.valid_to IS NULL OR t.valid_to>m.closing_day)
  WHERE r.receipt_id IS NULL OR r.effective_date<(m.month||'-01')::date
    OR r.enabled IS DISTINCT FROM true OR r.rounding IS DISTINCT FROM 'UP_10'
    OR r.printed_unit_price IS NULL OR r.printed_price_factor IS NULL OR r.printed_price_factor<=0
    OR t.warehouse_price IS DISTINCT FROM price.expected_price`;

export const roleAccountIds = (rules, keys) => [
  ...new Set(
    rules
      .filter((r) => keys.includes(r.posting_key) && r.account_id !== null)
      .map((r) => String(r.account_id)),
  ),
];

/** Independent SELECT-only evidence. No rebuilding, posting, corrections or balancing entries. */
export async function reconcile(ctx, through = LAST_DAY) {
  const reader = ctx.runtime.reader,
    checks = [];
  const query = async (sql, values = []) => (await reader.query(sql, values)).rows;
  const check = (name, passed, evidence) => checks.push({ name, passed, evidence });
  const empty = async (name, sql, values = []) => {
    const differences = await query(sql, values);
    check(name, differences.length === 0, {
      differences: differences.slice(0, 30),
      count: differences.length,
    });
  };
  await reader.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const [target] = await query(
      'SELECT current_database() AS database, current_user AS role, now() AS generated_at',
    );
    check(
      'dedicated database and normal app role',
      target.database === QA_DATABASE && target.role === 'app',
      target,
    );
    const [counts] = await query(`SELECT (SELECT count(*)::int FROM products) products,
      (SELECT count(*)::int FROM suppliers) suppliers, (SELECT count(*)::int FROM customers) customers,
      (SELECT count(*)::int FROM supplier_categories) supplier_departments,
      (SELECT count(*)::int FROM goods_receipts WHERE status='POSTED' AND costing_status='COSTED') costed_receipts,
      (SELECT count(*)::int FROM pos_shortfalls) pos_shortfalls`);
    const monthCount = MONTHS.filter((m) => m <= through.slice(0, 7)).length;
    check(
      'exact catalogue counts',
      counts.products === 500 &&
        counts.suppliers === 60 &&
        counts.customers === 80 &&
        counts.supplier_departments === 20,
      counts,
    );
    check(
      'all supplier monthly receipts actually costed',
      counts.costed_receipts === monthCount * 60,
      { actual: counts.costed_receipts, expected: monthCount * 60 },
    );
    check(
      'POS sold actual transferred inventory without automatic shortfall adjustments',
      counts.pos_shortfalls === 0,
      counts.pos_shortfalls,
    );
    const months = await query(
      `WITH months AS (SELECT to_char(d,'YYYY-MM') AS month FROM generate_series($1::date,$2::date,'1 month') d)
      SELECT m.month,
        (SELECT count(*)::int FROM stock_ledger WHERE to_char(effective_date,'YYYY-MM')=m.month) stock_movements,
        (SELECT count(*)::int FROM invoices WHERE status='ISSUED' AND to_char(invoice_date,'YYYY-MM')=m.month) invoices,
        (SELECT count(*)::int FROM pos_sales WHERE kind='SALE' AND sold_day::date BETWEEN $1 AND $2 AND to_char(sold_day::date,'YYYY-MM')=m.month) pos_sales,
        (SELECT count(*)::int FROM fin.journal_entries WHERE to_char(entry_date,'YYYY-MM')=m.month) journal_entries,
        (SELECT count(DISTINCT snapshot_date)::int FROM stock_snapshot_daily WHERE snapshot_date BETWEEN $1 AND $2 AND to_char(snapshot_date,'YYYY-MM')=m.month) snapshot_days
      FROM months m ORDER BY m.month`,
      [FIRST_DAY, through],
    );
    check(
      'every requested calendar month has posted business activity',
      months.length === monthCount &&
        months.every(
          (m) =>
            m.stock_movements > 0 && m.invoices > 0 && m.pos_sales > 0 && m.journal_entries > 0,
        ),
      months,
    );
    const expectedDays = DAYS.filter((d) => d <= through).length;
    const [activity] = await query(
      `SELECT (SELECT count(DISTINCT snapshot_date)::int FROM stock_snapshot_daily WHERE snapshot_date BETWEEN $1 AND $2) snapshot_days,
      (SELECT count(*)::int FROM invoices WHERE status='ISSUED' AND invoice_date BETWEEN $1 AND $2) wholesale_invoices,
      (SELECT count(*)::int FROM pos_sales WHERE kind='SALE' AND sold_day::date BETWEEN $1 AND $2) ordinary_pos_sales,
      (SELECT count(*)::int FROM pos_shifts WHERE opened_at::date BETWEEN $1 AND $2 AND status='HANDED_OVER') handed_over_shifts`,
      [FIRST_DAY, through],
    );
    check(
      'every actual calendar day has sales and service-generated snapshots',
      activity.snapshot_days === expectedDays &&
        activity.wholesale_invoices === expectedDays * 4 &&
        activity.ordinary_pos_sales === expectedDays * 6 &&
        activity.handed_over_shifts === expectedDays * 2,
      { expectedDays, ...activity },
    );
    await empty(
      'warehouse quantities independently equal immutable stock ledger',
      `WITH l AS (
      SELECT warehouse_id,product_id,coalesce(lot_id,0) lot_id,sum(qty_base) qty FROM stock_ledger GROUP BY 1,2,3)
      SELECT coalesce(l.warehouse_id,w.warehouse_id) warehouse_id,coalesce(l.product_id,w.product_id) product_id,l.qty,w.on_hand
      FROM l FULL JOIN warehouse_stock w ON w.warehouse_id=l.warehouse_id AND w.product_id=l.product_id AND coalesce(w.lot_id,0)=l.lot_id
      WHERE coalesce(l.qty,0)<>coalesce(w.on_hand,0)`,
    );
    await empty(
      'bin quantities independently equal immutable stock ledger',
      `WITH l AS (
      SELECT warehouse_id,bin_id,product_id,coalesce(lot_id,0) lot_id,sum(qty_base) qty FROM stock_ledger GROUP BY 1,2,3,4)
      SELECT coalesce(l.bin_id,b.bin_id) bin_id,coalesce(l.product_id,b.product_id) product_id,l.qty,b.on_hand
      FROM l FULL JOIN bin_stock b ON b.warehouse_id=l.warehouse_id AND b.bin_id=l.bin_id AND b.product_id=l.product_id AND coalesce(b.lot_id,0)=l.lot_id
      WHERE coalesce(l.qty,0)<>coalesce(b.on_hand,0)`,
    );
    await empty(
      'sellable inventory independently equals sellable bins',
      `WITH b AS (
      SELECT s.warehouse_id,s.product_id,coalesce(s.lot_id,0) lot_id,sum(s.on_hand) qty FROM bin_stock s JOIN bins b ON b.id=s.bin_id
      WHERE b.type IN ('STORAGE','PICKING','SALESFLOOR') GROUP BY 1,2,3)
      SELECT w.warehouse_id,w.product_id,w.sellable_on_hand,coalesce(b.qty,0) bin_sellable FROM warehouse_stock w LEFT JOIN b
      ON b.warehouse_id=w.warehouse_id AND b.product_id=w.product_id AND b.lot_id=coalesce(w.lot_id,0)
      WHERE w.sellable_on_hand<>coalesce(b.qty,0)`,
    );
    await empty(
      'every journal entry balances independently',
      `SELECT e.id,e.number,sum(l.debit) debit,sum(l.credit) credit
      FROM fin.journal_entries e LEFT JOIN fin.journal_lines l ON l.company_id=e.company_id AND l.entry_id=e.id
      GROUP BY e.id,e.number HAVING count(l.id)<2 OR sum(l.debit)<>sum(l.credit)`,
    );
    await empty(
      'open amounts independently equal original items less live allocations',
      `WITH amounts AS (
      SELECT item_id,sum(amount) amount FROM (
        SELECT debit_item_id item_id,CASE WHEN reverses_allocation_id IS NULL THEN amount ELSE -amount END amount FROM fin.allocations
        UNION ALL SELECT credit_item_id,CASE WHEN reverses_allocation_id IS NULL THEN amount ELSE -amount END FROM fin.allocations) x GROUP BY item_id)
      SELECT i.id,i.amount,i.open_amount,coalesce(a.amount,0) allocated FROM fin.open_items i LEFT JOIN amounts a ON a.item_id=i.id
      WHERE i.open_amount<>i.amount-coalesce(a.amount,0)`,
    );
    await empty(
      'party caches independently equal open items',
      `WITH i AS (
      SELECT company_id,party_id,account_id,sum(CASE WHEN side='DEBIT' THEN open_amount ELSE 0 END) d,
      sum(CASE WHEN side='CREDIT' THEN open_amount ELSE 0 END) c FROM fin.open_items GROUP BY 1,2,3)
      SELECT coalesce(i.party_id,b.party_id) party_id,coalesce(i.account_id,b.account_id) account_id,i.d,i.c,b.open_debit,b.open_credit
      FROM i FULL JOIN fin.party_balances b USING(company_id,party_id,account_id)
      WHERE coalesce(i.d,0)<>coalesce(b.open_debit,0) OR coalesce(i.c,0)<>coalesce(b.open_credit,0)`,
    );
    await empty(
      'AR and AP independently agree between subledger and GL',
      `WITH i AS (
      SELECT company_id,account_id,sum(CASE WHEN side='DEBIT' THEN open_amount ELSE -open_amount END) net FROM fin.open_items GROUP BY 1,2),
      l AS (SELECT company_id,account_id,sum(debit-credit) net FROM fin.journal_lines GROUP BY 1,2)
      SELECT a.code,a.control,coalesce(i.net,0) subledger,coalesce(l.net,0) gl FROM fin.accounts a LEFT JOIN i ON i.company_id=a.company_id AND i.account_id=a.id
      LEFT JOIN l ON l.company_id=a.company_id AND l.account_id=a.id
      WHERE a.control IN ('RECEIVABLE','PAYABLE','ADVANCE_RECEIVED','ADVANCE_PAID') AND coalesce(i.net,0)<>coalesce(l.net,0)`,
    );
    const [manualScenario] = await query(
      `SELECT coalesce(sum(round(note_total_amount*0.7,2)),0) supplier_payments
      FROM goods_receipts WHERE status='POSTED' AND effective_date BETWEEN $1 AND $2`,
      [FIRST_DAY, through],
    );
    const voucherTypes = [
      'FIN.CUSTOMER_RECEIPT',
      'FIN.CUSTOMER_REFUND',
      'FIN.OTHER_RECEIPT',
      'FIN.OTHER_PAYMENT',
    ];
    const money = await query(
      `WITH vouchers AS (
      SELECT d.company_id,d.money_account_id,sum(CASE WHEN d.class='RECEIPT' THEN d.amount ELSE -d.amount END) amount
      FROM fin.documents d JOIN fin.document_types t ON t.company_id=d.company_id AND t.id=d.document_type_id
      WHERE t.code=ANY($1::text[]) AND d.reverses_document_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM fin.documents r WHERE r.company_id=d.company_id AND r.reverses_document_id=d.id)
      GROUP BY d.company_id,d.money_account_id)
      SELECT m.id,m.code,coalesce(v.amount,0)::text voucher_balance,
        coalesce(sum(l.debit-l.credit),0)::text full_gl_balance,
        coalesce(sum(l.debit-l.credit) FILTER(WHERE t.code=ANY($1::text[])),0)::text voucher_gl,
        coalesce(sum(l.debit-l.credit) FILTER(WHERE t.code IN ('FIN.JOURNAL','FIN.OPENING')),0)::text manual_opening_gl,
        coalesce(sum(l.debit-l.credit) FILTER(WHERE t.code IS NULL OR (t.code<>ALL($1::text[]) AND t.code NOT IN ('FIN.JOURNAL','FIN.OPENING'))),0)::text other_gl
      FROM fin.money_accounts m LEFT JOIN vouchers v ON v.company_id=m.company_id AND v.money_account_id=m.id
      LEFT JOIN fin.journal_lines l ON l.company_id=m.company_id AND l.money_account_id=m.id
      LEFT JOIN fin.journal_entries e ON e.company_id=l.company_id AND e.id=l.entry_id
      LEFT JOIN fin.documents d ON d.company_id=e.company_id AND d.id=e.document_id
      LEFT JOIN fin.document_types t ON t.company_id=d.company_id AND t.id=d.document_type_id
      GROUP BY m.id,m.code,v.amount ORDER BY m.code`,
      [voucherTypes],
    );
    const apiMoney = await ctx.all('/money-accounts');
    for (const account of money) {
      const facade = apiMoney.find((a) => Number(a.id) === Number(account.id));
      check(
        `cash/bank voucher book ${account.code} equals independent live voucher documents`,
        facade &&
          Number(facade.balance) === Number(account.voucher_balance) &&
          Number(account.voucher_gl) === Number(account.voucher_balance),
        {
          independentVouchers: account.voucher_balance,
          voucherGl: account.voucher_gl,
          applicationVoucherBook: facade?.balance,
        },
      );
      const expectedManual =
        Number(account.id) === Number(ctx.refs.money.bank.id)
          ? 2000000000 - Number(manualScenario.supplier_payments)
          : Number(account.id) === Number(ctx.refs.money.cash.id)
            ? 100000000
            : 0;
      account.scenario_manual_opening = expectedManual;
      check(
        `cash/bank full GL ${account.code} bridges vouchers with documented capital and supplier journals`,
        Math.abs(Number(account.manual_opening_gl) - expectedManual) < 0.005 &&
          Number(account.other_gl) === 0 &&
          Math.abs(
            Number(account.full_gl_balance) - Number(account.voucher_balance) - expectedManual,
          ) < 0.005,
        {
          fullGl: account.full_gl_balance,
          voucherBook: account.voucher_balance,
          manualOpeningGl: account.manual_opening_gl,
          expectedManualCapitalLessSupplierPayments: expectedManual,
          otherGl: account.other_gl,
        },
      );
    }
    const roleKeys = ['SALES', 'POS_SALES', 'SALES_RETURN', 'COGS', 'INVENTORY'];
    const roles = await query(
      `SELECT DISTINCT ON(r.posting_key) r.posting_key,r.account_id,a.status
      FROM fin.posting_rules r LEFT JOIN fin.accounts a ON a.company_id=r.company_id AND a.id=r.account_id
      WHERE r.company_id=(SELECT company_id FROM fin.accounts WHERE id=$1)
        AND r.posting_key=ANY($2::text[]) AND r.effective_from<=$3
      ORDER BY r.posting_key,r.effective_from DESC,r.id DESC`,
      [ctx.refs.accounts.bank.id, roleKeys, through],
    );
    check(
      'all required posting roles have active effective account mappings',
      roleKeys.every((key) =>
        roles.some((r) => r.posting_key === key && r.account_id !== null && r.status === 'ACTIVE'),
      ),
      roles,
    );
    const [supplierSettlements] = await query(
      `SELECT
      coalesce((SELECT sum(round(note_total_amount*0.7,2)) FROM goods_receipts WHERE status='POSTED' AND effective_date BETWEEN $1 AND $2),0) expected,
      coalesce((SELECT sum(a.amount) FROM fin.allocations a JOIN fin.accounts c ON c.company_id=a.company_id AND c.id=a.account_id
        JOIN fin.documents d ON d.company_id=a.company_id AND d.id=a.document_id WHERE c.control='PAYABLE' AND a.reverses_allocation_id IS NULL AND d.accounting_date BETWEEN $1 AND $2),0) allocated`,
      [FIRST_DAY, through],
    );
    check(
      'supplier bank payments actually settle their bills through supported allocations',
      Number(supplierSettlements.expected) === Number(supplierSettlements.allocated),
      supplierSettlements,
    );
    const glBalance = async (...keys) => {
      const ids = roleAccountIds(roles, keys);
      const [row] = await query(
        'SELECT coalesce(sum(l.debit-l.credit),0)::text amount FROM fin.journal_lines l JOIN fin.journal_entries e ON e.company_id=l.company_id AND e.id=l.entry_id WHERE l.account_id=ANY($1::bigint[]) AND e.entry_date BETWEEN $2 AND $3',
        [ids, FIRST_DAY, through],
      );
      return Number(row.amount);
    };
    const [revenue] = await query(
      `SELECT
      coalesce((SELECT sum(total-vat_total-city_tax_total) FROM invoices WHERE status='ISSUED' AND invoice_date BETWEEN $1 AND $2),0)
      -coalesce((SELECT sum(total-vat_total-city_tax_total) FROM credit_notes WHERE note_date BETWEEN $1 AND $2),0)
      +coalesce((SELECT sum(CASE WHEN kind='SALE' THEN total-vat_total ELSE -(total-vat_total) END) FROM pos_sales WHERE sold_day::date BETWEEN $1 AND $2),0) AS amount`,
      [FIRST_DAY, through],
    );
    const revenueGl = -(await glBalance('SALES', 'POS_SALES', 'SALES_RETURN'));
    check(
      'net revenue independently reconciles invoice/POS/return documents to GL',
      Math.abs(Number(revenue.amount) - revenueGl) < 0.011,
      { sourceDocuments: revenue.amount, gl: revenueGl },
    );
    const [cost] = await query(
      `SELECT coalesce(sum(round(-qty_base*unit_cost,2)),0) amount FROM stock_ledger
      WHERE movement_type IN ('DELIVERY_ISSUE','POS_SALE','RETURN_IN') AND effective_date BETWEEN $1 AND $2`,
      [FIRST_DAY, through],
    );
    // Receipt/re-cost variance is a signed COGS component (ADR-0033 #6, ADR-0097 #3,
    // ADR-0236). Every valuation version contributes its delta, rather than only the latest row.
    const [costVariance] = await query(
      `SELECT coalesce(sum(variance),0) amount FROM stock_valuation_adjustments
      WHERE doc_type='GR' AND effective_date BETWEEN $1 AND $2`,
      [FIRST_DAY, through],
    );
    const sourceCogs = Number(cost.amount) + Number(costVariance.amount);
    const cogs = await glBalance('COGS');
    check(
      'COGS independently bridges sold/returned stock with documented receipt valuation variance',
      Math.abs(sourceCogs - cogs) < 0.005,
      {
        sourceMovements: cost.amount,
        receiptValuationVariance: costVariance.amount,
        sourceCogs,
        gl: cogs,
      },
    );
    const [acquisition] = await query(
      `SELECT coalesce(sum(amount),0) amount FROM (
      SELECT DISTINCT ON(doc_id,doc_line_id) amount FROM stock_valuation_adjustments
      WHERE doc_type='GR' AND effective_date BETWEEN $1 AND $2 ORDER BY doc_id,doc_line_id,version DESC) x`,
      [FIRST_DAY, through],
    );
    const inventoryGl = await glBalance('INVENTORY');
    const sourceInventory = Number(acquisition.amount) - sourceCogs;
    check(
      'inventory GL independently follows acquisition costs, net stock sold and receipt variance',
      Math.abs(sourceInventory - inventoryGl) < 0.005,
      {
        acquisitionCost: acquisition.amount,
        netSoldCost: cost.amount,
        receiptValuationVariance: costVariance.amount,
        netCogs: sourceCogs,
        sourceInventory,
        glInventory: inventoryGl,
      },
    );
    const [valuation] = await query(
      'SELECT coalesce(sum(on_hand*avg_cost),0) amount FROM warehouse_stock',
    );
    check(
      'weighted-average stock valuation agrees with inventory GL',
      Math.abs(Number(valuation.amount) - inventoryGl) < 0.51,
      {
        stockValue: valuation.amount,
        glInventory: inventoryGl,
        toleranceMnt: '0.50',
        reason: 'four-place average-cost cache versus document-cent posting',
      },
    );
    const [profit] = await query(
      `SELECT coalesce(sum(CASE WHEN a.kind='INCOME' THEN l.credit-l.debit WHEN a.kind='EXPENSE' THEN l.credit-l.debit ELSE 0 END),0) amount
      FROM fin.journal_lines l JOIN fin.accounts a ON a.company_id=l.company_id AND a.id=l.account_id
      JOIN fin.journal_entries e ON e.company_id=l.company_id AND e.id=l.entry_id WHERE e.entry_date BETWEEN $1 AND $2`,
      [FIRST_DAY, through],
    );
    const expenseIds = ['rent', 'wages', 'utilities', 'delivery', 'supplies'].map(
      (k) => ctx.refs.accounts[k].id,
    );
    const [expenses] = await query(
      'SELECT coalesce(sum(l.debit-l.credit),0) amount FROM fin.journal_lines l JOIN fin.journal_entries e ON e.company_id=l.company_id AND e.id=l.entry_id WHERE l.account_id=ANY($1::bigint[]) AND e.entry_date BETWEEN $2 AND $3',
      [expenseIds, FIRST_DAY, through],
    );
    const sourceProfit = Number(revenue.amount) - sourceCogs - Number(expenses.amount);
    check(
      'profit independently reconciles source sales, stock cost, receipt variance and five monthly expenses',
      Math.abs(sourceProfit - Number(profit.amount)) < 0.005,
      {
        sourceProfit,
        glProfit: profit.amount,
        netRevenue: revenue.amount,
        costOfGoods: cost.amount,
        receiptValuationVariance: costVariance.amount,
        netCogs: sourceCogs,
        operatingExpenses: expenses.amount,
      },
    );
    const expiryExpected = DAYS.filter((d) => d <= through && d.endsWith('-15')).length;
    const historicalExpiry = ctx.state.checks.historicalExpiry ?? [];
    const persistedExpiry = await query(
      `SELECT i.id,i.liability_type,s.receipt_line_id,
      (SELECT count(*)::int FROM expiry_item_users u WHERE u.item_id=i.id) responsible_users
      FROM expiry_items i JOIN expiry_item_sources s ON s.item_id=i.id WHERE i.id=ANY($1::bigint[])`,
      [historicalExpiry.map((r) => r.itemId)],
    );
    check(
      'historical expiry reviews and responsibility were entered through supported APIs',
      historicalExpiry.length === expiryExpected &&
        historicalExpiry.every((r) => r.published === false) &&
        persistedExpiry.length === expiryExpected &&
        persistedExpiry.every((r) => r.liability_type === 'SPECIFIC' && r.responsible_users === 1),
      { manifest: historicalExpiry, database: persistedExpiry },
    );
    await empty(
      'all daily stock snapshots independently equal movements through that day',
      `WITH dates AS (SELECT DISTINCT snapshot_date d FROM stock_snapshot_daily),
      l AS (SELECT d.d,l.warehouse_id,l.product_id,coalesce(l.lot_id,0) lot_id,sum(l.qty_base) qty FROM dates d JOIN stock_ledger l ON l.effective_date<=d.d GROUP BY 1,2,3,4)
      SELECT coalesce(l.d,s.snapshot_date) AS day,coalesce(l.product_id,s.product_id) product_id,l.qty,s.on_hand
      FROM l FULL JOIN stock_snapshot_daily s ON s.snapshot_date=l.d AND s.warehouse_id=l.warehouse_id AND s.product_id=l.product_id AND coalesce(s.lot_id,0)=l.lot_id
      WHERE coalesce(l.qty,0)<>coalesce(s.on_hand,0)`,
    );
    const [prices] = await query(
      'SELECT count(*)::int total, count(DISTINCT product_id)::int products FROM product_prices',
    );
    const priceMonths = await query(
      `WITH months AS(SELECT to_char(d,'YYYY-MM') AS month,least((date_trunc('month',d)+interval '1 month'-interval '1 day')::date,$2::date) closing_day
        FROM generate_series($1::date,$2::date,'1 month') d)
       SELECT m.month,count(DISTINCT p.product_id)::int products FROM months m LEFT JOIN product_prices p
         ON p.valid_from<=m.closing_day AND (p.valid_to IS NULL OR p.valid_to>m.closing_day) GROUP BY m.month ORDER BY m.month`,
      [FIRST_DAY, through],
    );
    check(
      'all products have an applicable effective price at each month closing, including unchanged carried prices',
      prices.products === 500 &&
        prices.total >= 500 &&
        priceMonths.length === monthCount &&
        priceMonths.every((m) => m.products === 500),
      { ...prices, months: priceMonths },
    );
    const supplierRules = await query(
      'SELECT supplier_id,enabled,markup_pct,markup_amount,rounding FROM supplier_price_rules WHERE supplier_id=ANY($1::bigint[])',
      [ctx.refs.suppliers.map((s) => s.id)],
    );
    const bySupplier = new Map(supplierRules.map((r) => [String(r.supplier_id), r]));
    const changedRules = ctx.refs.suppliers.flatMap((supplier, index) => {
      const rule = bySupplier.get(String(supplier.id));
      const submitted =
        ctx.state.operations[`catalogue/supplier-rule/${index}`]?.specification.payloadHash;
      const actual = rule && {
        expectedVersion: 0,
        enabled: rule.enabled,
        markupPct: String(Number(rule.markup_pct)),
        markupAmount: String(Number(rule.markup_amount)),
        rounding: rule.rounding,
      };
      return submitted && actual && hash(actual) === submitted ? [] : [{ supplierId: supplier.id }];
    });
    check(
      'supplier markup inputs still match the declared fixed scenario setup',
      supplierRules.length === 60 && changedRules.length === 0,
      { rules: supplierRules.length, changedInputs: changedRules },
    );
    await empty(
      'each month closing base price independently matches latest printed invoice ratio and supplier markup',
      MONTH_CLOSING_PRICE_SQL,
      [FIRST_DAY, through],
    );
    await reader.query('COMMIT');
    const passed = checks.every((c) => c.passed),
      complete = through === LAST_DAY && ctx.state.completedDays.length === DAYS.length;
    return {
      dataset: ctx.state.dataset,
      status: passed ? (complete ? 'PASSED' : 'PARTIAL_PASSED') : 'FAILED',
      accepted: passed && complete,
      executedAt: new Date().toISOString(),
      window: { from: FIRST_DAY, through, novemberPartial: true },
      clock: ctx.state.clock,
      days: expectedDays,
      months,
      checks,
      money,
      limitations: [
        'Monthly wages are expense vouchers; no six-month employee attendance/payroll is claimed.',
        'Historical expiry reviews/source/liability exist; markdown publication uses the real database start time, so below-cost sale/return regression runs separately on the actual current day.',
        'Immutable createdAt and database audit timestamps are real generation time.',
        'Cash/bank screens intentionally show live vouchers; owner capital and supplier payments are separate supported manual GL movements, reconciled in the money bridge.',
      ],
    };
  } catch (error) {
    await reader.query('ROLLBACK');
    throw error;
  }
}
