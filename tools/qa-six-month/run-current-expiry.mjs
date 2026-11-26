import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { optionsOf, throwRunFailures } from './run.mjs';
import { startRuntime } from './runtime.mjs';
import { createJournal, uuid } from './journal.mjs';
import { expiryRoundTrip } from './history.mjs';
import { LAST_DAY } from './dataset.mjs';

/** Separate actual-current-date regression: PostgreSQL's markdown starts_at stays honest. */
export async function runCurrentExpiry(argv = process.argv.slice(2)) {
  const options = optionsOf(argv);
  if (!options.apply) {
    process.stdout.write(
      'PREVIEW: separate actual-current-date expiry loss/partial/full return regression; no database opened\n',
    );
    return;
  }
  let runtime, ctx;
  let failed = false,
    error;
  const cleanupErrors = [];
  try {
    runtime = await startRuntime({
      ...options,
      explicitlyEnabled: true,
      password: process.env.BTO_QA_PASSWORD,
    });
    runtime.clock.restore();
    // The logical adapter has been removed. Journal checkpoints need a harmless tick, while every
    // business helper, application query, database default and audit timestamp now uses wall time.
    runtime.clock = { tick() {} };
    ctx = await createJournal(runtime);
    if (!ctx.state.acceptance?.accepted)
      throw new Error(
        'Complete and independently accept historical seed before current-date expiry regression',
      );
    const day = runtime.require('@tugeel/shared/time').businessDate();
    if (day <= LAST_DAY)
      throw new Error('Current expiry regression must be outside the historical window');
    const Decimal = runtime.shared.money.Decimal,
      till = ctx.refs.tills[0];
    const shiftKey = `current/${day}/expiry-shift`,
      shiftClientId = uuid(shiftKey);
    const { token: edgeToken } = await ctx.request(
      'POST',
      `/pos/edge-nodes/${ctx.refs.edge.id}/token`,
    );
    const sync = async (key, event) => {
      const result = await ctx.write(
        key,
        'POST',
        '/pos/sync/events',
        { events: [event] },
        { idempotent: true, edgeToken },
      );
      const outcome = result.results?.[0];
      if (!outcome || !['APPLIED', 'DUPLICATE'].includes(outcome.status))
        throw new Error(`Current expiry event rejected: ${JSON.stringify(outcome)}`);
      return outcome;
    };
    // Explicit event timestamps must remain byte-identical after a crash/resume.
    const stamp = (key) =>
      ctx.memo(`${key}/timestamp`, 'Actual wall-time POS event instant', async () =>
        new Date().toISOString(),
      );
    const openedAt = await stamp(`${shiftKey}/open`);
    const opened = await sync(`${shiftKey}/open`, {
      kind: 'SHIFT_OPENED',
      clientId: shiftClientId,
      shiftOpened: {
        clientId: shiftClientId,
        tillCode: till.code,
        cashierUserId: ctx.refs.admin.id,
        number: `QAX-${day.replaceAll('-', '')}`,
        openedAt,
        openingFloat: '0',
      },
    });
    const makeSale = async (key, _day, selectedTill, selectedShift, specs, fields = {}) => {
      const lines = specs.map((spec, i) => {
        const money = runtime.shared.pos.lineMoney(spec.qty, spec.unitPrice, '0');
        return {
          lineNo: i + 1,
          productId: spec.product.id,
          productUnitId: spec.product.baseUnitId,
          qty: spec.qty,
          factorSnapshot: '1',
          basis: 'RETAIL',
          listPrice: spec.unitPrice,
          unitPrice: spec.unitPrice,
          subtotal: money.subtotal.toFixed(2),
          discountAmount: '0',
          total: money.total.toFixed(2),
          vatRatePct: '10',
          vatAmount: runtime.shared.pos.lineVat(money.total, '10').toFixed(2),
          expiryBarcode: spec.expiryBarcode,
          refundsLineNo: spec.refundsLineNo ?? null,
          damaged: false,
        };
      });
      const totals = runtime.shared.pos.saleTotals(lines);
      return {
        clientId: uuid(key),
        kind: fields.kind ?? 'SALE',
        tillCode: selectedTill.code,
        shiftClientId: selectedShift,
        cashierUserId: ctx.refs.admin.id,
        approvedByUserId: ctx.refs.admin.id,
        number: `QAX-${uuid(key)}`,
        soldAt: await stamp(key),
        receiptType: 'B2C',
        customerTin: null,
        refundsSaleClientId: fields.refundsSaleClientId ?? null,
        lines,
        tenders: [{ kind: 'CASH', amount: totals.total.toFixed(2), tendered: null }],
        subtotal: totals.subtotal.toFixed(2),
        discountTotal: totals.discountTotal.toFixed(2),
        total: totals.total.toFixed(2),
        vatTotal: totals.vatTotal.toFixed(2),
        note: 'Actual current-day QA expiry regression; excluded from six-month history',
      };
    };
    const trace = await expiryRoundTrip(ctx, 5, day, till, shiftClientId, makeSale, sync);
    await sync(`${shiftKey}/close`, {
      kind: 'SHIFT_CLOSED',
      clientId: shiftClientId,
      shiftClosed: {
        clientId: shiftClientId,
        closedAt: await stamp(`${shiftKey}/close`),
        countedCash: '0',
        floatKept: '0',
        note: 'QA full expiry refund; net cash zero',
      },
    });
    const allocation = (
      await runtime.reader.query(
        `SELECT a.id,a.qty_base,a.cost_amount,a.revenue_amount,a.loss_amount,a.shares,
      coalesce(sum(r.qty_base),0) returned_qty,coalesce(sum(r.loss_amount),0) reversed_loss,count(r.id)::int return_count,
      (SELECT coalesce(sum((s->>'amount')::numeric),0) FROM jsonb_array_elements(a.shares) s) sale_shares,
      (SELECT coalesce(sum((s->>'amount')::numeric),0) FROM expiry_return_allocations x CROSS JOIN LATERAL jsonb_array_elements(x.shares) s WHERE x.sale_allocation_id=a.id) return_shares
      FROM expiry_sale_allocations a LEFT JOIN expiry_return_allocations r ON r.sale_allocation_id=a.id
      WHERE a.markdown_id=$1 GROUP BY a.id`,
        [trace.markdownId],
      )
    ).rows;
    const shift = await ctx.get(`/pos/shifts/${opened.id}`);
    const returnFacts = (
      await runtime.reader.query(
        `SELECT r.id,r.qty_base,r.loss_amount,r.shares
      FROM expiry_return_allocations r JOIN expiry_sale_allocations a ON a.id=r.sale_allocation_id
      WHERE a.markdown_id=$1 ORDER BY r.id`,
        [trace.markdownId],
      )
    ).rows;
    const payroll = (
      await runtime.reader.query(
        `WITH keys AS (
      SELECT source_key FROM expiry_sale_allocations WHERE markdown_id=$1
      UNION ALL SELECT r.source_key FROM expiry_return_allocations r JOIN expiry_sale_allocations a ON a.id=r.sale_allocation_id WHERE a.markdown_id=$1)
      SELECT p.user_id,count(*)::int AS rows,coalesce(sum(p.amount),0) net,
        coalesce(sum(CASE WHEN p.source_kind='EXPIRY_SALE' THEN p.amount ELSE 0 END),0) charged,
        coalesce(sum(CASE WHEN p.source_kind='EXPIRY_RETURN' THEN p.amount ELSE 0 END),0) refunded
      FROM payroll_source_deductions p JOIN keys k ON k.source_key=p.source_key GROUP BY p.user_id`,
        [trace.markdownId],
      )
    ).rows;
    const checks = [
      {
        name: 'one actual below-cost allocation',
        passed:
          allocation.length === 1 &&
          Number(allocation[0].loss_amount) > 0 &&
          Number(allocation[0].cost_amount) > Number(allocation[0].revenue_amount),
      },
      {
        name: 'partial then full return restores exact final cent',
        passed:
          allocation.length === 1 &&
          Number(allocation[0].returned_qty) === 3 &&
          allocation[0].return_count === 2 &&
          returnFacts.length === 2 &&
          Number(returnFacts[0].qty_base) === 1 &&
          Number(returnFacts[1].qty_base) === 2 &&
          Number(allocation[0].reversed_loss) === Number(allocation[0].loss_amount),
      },
      {
        name: 'employee allocation reverses without excess deduction',
        passed:
          allocation.length === 1 &&
          new Decimal(allocation[0].sale_shares).plus(allocation[0].return_shares).isZero(),
      },
      {
        name: 'actual employee deduction rows charge and refund exactly without a balance',
        passed:
          payroll.length === 1 &&
          payroll[0].rows === 3 &&
          new Decimal(payroll[0].net).isZero() &&
          allocation.length === 1 &&
          new Decimal(payroll[0].charged).eq(allocation[0].loss_amount) &&
          new Decimal(payroll[0].refunded).negated().eq(allocation[0].loss_amount),
      },
      {
        name: 'actual shift cash and sales net to zero',
        passed:
          new Decimal(shift.cashSales).minus(shift.cashRefunds).isZero() &&
          new Decimal(shift.variance).isZero(),
      },
    ];
    const stock = await runtime.stock.reconcile('QA_CURRENT_EXPIRY');
    checks.push({
      name: 'global stock remains reconciled after actual returns',
      passed: stock.diffCount === 0,
    });
    const journalDiffs = (
      await runtime.reader.query(
        'SELECT entry_id FROM fin.journal_lines GROUP BY entry_id HAVING sum(debit)<>sum(credit)',
      )
    ).rows;
    checks.push({ name: 'all global journals still balance', passed: journalDiffs.length === 0 });
    const report = {
      status: checks.every((c) => c.passed) ? 'PASSED' : 'FAILED',
      historical: false,
      businessDay: day,
      clock:
        'Logical adapter fully restored; actual wall time for every business/database/audit timestamp',
      trace,
      checks,
      allocation,
      returnFacts,
      payroll,
      historicalAcceptance: ctx.state.acceptance.status,
      executedAt: new Date().toISOString(),
    };
    ctx.state.currentExpiryAcceptance = report;
    await ctx.save();
    await writeFile(
      join(runtime.directory, 'expiry-current-acceptance.json'),
      JSON.stringify(report, null, 2) + '\n',
      { mode: 0o600 },
    );
    process.stdout.write(`Current-date expiry ${day}: ${report.status}\n`);
    if (report.status !== 'PASSED') process.exitCode = 1;
  } catch (failure) {
    failed = true;
    error = failure;
  } finally {
    try {
      await ctx?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await runtime?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  throwRunFailures({ failed, error, cleanupErrors });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  runCurrentExpiry().catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  });
