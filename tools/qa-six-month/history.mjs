import { DAYS, MONTHS, FIRST_DAY } from './dataset.mjs';
import { uuid, exactlyOne } from './journal.mjs';
import { configurePosAccounts } from './pos-accounts.mjs';

const idem = { idempotent: true };
const post = (ctx, key, path, body = {}) => ctx.write(key, 'POST', path, body, idem);
const addDays = (day, n) =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const instant = (day, hour = 12, minute = 0) =>
  new Date(
    `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`,
  ).toISOString();
const purchaseQty = (product, monthIndex) =>
  String(Math.ceil((monthIndex === 0 ? 120 : 60) / Number(product.carton)) + (monthIndex % 3));

/** Only production HTTP workflows and StockPostingService's public reconciliation/snapshot methods. */
export async function seedHistory(ctx, { through = DAYS.at(-1) } = {}) {
  const { refs, runtime, state } = ctx;
  const Decimal = runtime.shared.money.Decimal;
  runtime.clock.setDay(FIRST_DAY);
  await configurePosAccounts(ctx);
  await post(ctx, 'history/capital', '/journal-entries', {
    entryDate: FIRST_DAY,
    description: 'QA fictional owner capital, no real bank account',
    lines: [
      { accountId: refs.accounts.bank.id, moneyAccountId: refs.money.bank.id, debit: '2000000000' },
      { accountId: refs.accounts.cash.id, moneyAccountId: refs.money.cash.id, debit: '100000000' },
      { accountId: refs.accounts.capital.id, credit: '2100000000' },
    ],
  });
  // Tokens stay in memory. Rotation is safe on a resumed run; no financial document is created.
  const { token: edgeToken } = await ctx.request('POST', `/pos/edge-nodes/${refs.edge.id}/token`);
  const sync = async (key, event) => {
    const result = await ctx.write(
      key,
      'POST',
      '/pos/sync/events',
      { events: [event] },
      { ...idem, edgeToken },
    );
    const outcome = result.results?.[0];
    if (!outcome || !['APPLIED', 'DUPLICATE'].includes(outcome.status))
      throw new Error(`POS ${key} was not accepted: ${JSON.stringify(outcome)}`);
    return outcome;
  };
  const makeSale = (key, day, till, shiftClientId, specifications, options = {}) => {
    const lines = specifications.map((spec, i) => {
      const price =
        spec.unitPrice ?? String(Math.ceil((Number(spec.product.baseCost) * 1.48) / 10) * 10);
      const money = runtime.shared.pos.lineMoney(spec.qty, price, '0');
      return {
        lineNo: i + 1,
        productId: spec.product.id,
        productUnitId: spec.product.baseUnitId,
        qty: spec.qty,
        factorSnapshot: '1',
        basis: 'RETAIL',
        listPrice: price,
        unitPrice: price,
        discountAmount: '0',
        subtotal: money.subtotal.toFixed(2),
        total: money.total.toFixed(2),
        vatRatePct: '10',
        vatAmount: runtime.shared.pos.lineVat(money.total, '10').toFixed(2),
        refundsLineNo: spec.refundsLineNo ?? null,
        damaged: false,
        ...(spec.expiryBarcode ? { expiryBarcode: spec.expiryBarcode } : {}),
      };
    });
    const totals = runtime.shared.pos.saleTotals(lines);
    return {
      clientId: uuid(key),
      kind: options.kind ?? 'SALE',
      tillCode: till.code,
      shiftClientId,
      cashierUserId: refs.admin.id,
      approvedByUserId: options.kind === 'RETURN' ? refs.admin.id : null,
      number: `QA-${day.replaceAll('-', '')}-${uuid(key).slice(0, 8)}`,
      soldAt: instant(day, options.hour ?? 12, options.minute ?? 0),
      receiptType: 'B2C',
      customerTin: null,
      refundsSaleClientId: options.refundsSaleClientId ?? null,
      lines,
      tenders: [
        { kind: options.tender ?? 'CASH', amount: totals.total.toFixed(2), tendered: null },
      ],
      subtotal: totals.subtotal.toFixed(2),
      discountTotal: totals.discountTotal.toFixed(2),
      total: totals.total.toFixed(2),
      vatTotal: totals.vatTotal.toFixed(2),
      note: `Fictional QA ${key}`,
    };
  };
  for (const [dayIndex, day] of DAYS.entries()) {
    if (day > through) break;
    if (state.completedDays.includes(day)) continue;
    runtime.clock.setDay(day);
    const month = day.slice(0, 7),
      monthIndex = MONTHS.indexOf(month);
    if (day.endsWith('-01')) {
      if (monthIndex)
        await ctx.service(
          `history/${month}/bin-snapshot`,
          'Normal prior-month bin snapshot',
          () => runtime.stock.snapshotBins(day),
          async () => {
            const found = await runtime.reader.query(
              'SELECT count(*)::int AS n FROM stock_snapshot_bin_monthly WHERE snapshot_date=$1',
              [day],
            );
            return found.rows[0].n ? { snapshotDate: day, recovered: true } : null;
          },
        );
      await receiveMonth(ctx, monthIndex, day);
      await transferMonth(ctx, monthIndex);
      await monthlyExpenses(ctx, monthIndex, day);
    }
    for (let saleIndex = 0; saleIndex < 4; saleIndex++) {
      const key = `history/${day}/wholesale/${saleIndex}`;
      const products = Array.from(
        { length: 4 },
        (_, n) => refs.products[(dayIndex * 28 + saleIndex * 7 + n * 3) % 500],
      );
      const order = await post(ctx, `${key}/draft`, '/sales-orders', {
        customerId: refs.customers[(dayIndex * 4 + saleIndex) % refs.customers.length].id,
        fulfilment: 'PICKUP',
        deliveryDate: day,
        paymentMethod: 'CREDIT',
        pipelineId: refs.pipeline.id,
        stageId: refs.pipeline.stages.find((s) => s.action === 'NONE').id,
        note: `Fictional QA ${key}`,
        lines: products.map((p, n) => ({
          productUnitId: p.baseUnitId,
          qty: p.base === 'KG' ? '2.5' : String(2 + (n % 3)),
        })),
      });
      for (const action of ['CONFIRM', 'PICK'])
        await post(ctx, `${key}/${action}`, `/sales-orders/${order.id}/move`, {
          stageId: refs.pipeline.stages.find((s) => s.action === action).id,
        });
      const detail = await ctx.get(`/sales-orders/${order.id}`);
      const info = await ctx.get(`/sales-orders/${order.id}/pick-info`);
      // Freeze the first read: after an interrupted successful pick, proposed quantities may differ.
      const picks = await ctx.memo(
        `${key}/pick-plan`,
        'Read-only deterministic pick plan',
        async () => ({
          lines: detail.lines.map((line) => {
            const binId = info.find((entry) => entry.lineId === line.id)?.proposedBinId;
            if (!binId || new Decimal(line.qtyApproved).lte(0))
              throw new Error(`No stock/pick for ${key} line ${line.id}`);
            return { lineId: line.id, qty: line.qtyApproved, binId };
          }),
        }),
      );
      await post(ctx, `${key}/pick`, `/sales-orders/${order.id}/pick`, picks);
      await post(ctx, `${key}/sell`, `/sales-orders/${order.id}/move`, {
        stageId: refs.pipeline.stages.find((s) => s.action === 'SALE').id,
      });
      const invoice = exactlyOne(await ctx.all(`/invoices?orderId=${order.id}`), `${key}/invoice`);
      if (!invoice) throw new Error(`Wholesale sale did not create invoice ${key}`);
      if (dayIndex % 7 === 0 && saleIndex === 0) {
        const invoiced = await ctx.get(`/invoices/${invoice.id}`);
        const first = invoiced.lines[0],
          product = refs.products.find((p) => p.id === first.productId);
        await post(ctx, `${key}/return`, '/credit-notes', {
          invoiceId: invoice.id,
          noteDate: day,
          reason: `Fictional QA damaged packaging ${key}`,
          warehouseId: product.warehouseId,
          binId: product.binId,
          lines: [{ invoiceLineId: first.id, qty: product.base === 'KG' ? '0.5' : '1' }],
        });
      }
      const fresh = await ctx.get(`/invoices/${invoice.id}`);
      // Some deliberately remain partly outstanding; creates realistic AR aging without a write-off.
      const paidAmount = await ctx.memo(
        `${key}/payment-plan`,
        'Read-only post-return invoice payment amount',
        async () => new Decimal(fresh.openAmount).times(saleIndex === 3 ? '0.6' : '0.9').toFixed(2),
      );
      await post(ctx, `${key}/payment`, '/payments', {
        kind: 'CUSTOMER_PAYMENT',
        customerId: invoice.customerId,
        moneyAccountId: refs.money[saleIndex % 2 ? 'cash' : 'bank'].id,
        amount: paidAmount,
        paidOn: day,
        reference: `QA ${day} order ${saleIndex}`,
        allocations: [{ invoiceId: invoice.id, amount: paidAmount }],
      });
    }
    for (const [tillIndex, till] of refs.tills.entries()) {
      const shiftKey = `history/${day}/pos/${tillIndex}`,
        shiftClientId = uuid(shiftKey);
      const opened = await sync(`${shiftKey}/open`, {
        kind: 'SHIFT_OPENED',
        clientId: shiftClientId,
        shiftOpened: {
          clientId: shiftClientId,
          tillCode: till.code,
          cashierUserId: refs.admin.id,
          number: `QA-${till.code}-${day.replaceAll('-', '')}`,
          openedAt: instant(day, 8),
          openingFloat: '0',
        },
      });
      let cash = new Decimal(0);
      for (let ticket = 0; ticket < 3; ticket++) {
        const key = `${shiftKey}/sale-${ticket}`;
        const specs = Array.from({ length: 5 }, (_, n) => {
          const product =
            refs.products[(dayIndex * 31 + tillIndex * 113 + ticket * 17 + n * 11) % 500];
          return { product, qty: product.base === 'KG' ? '0.75' : String(1 + ((ticket + n) % 2)) };
        });
        const sale = makeSale(key, day, till, shiftClientId, specs, {
          tender: ticket === 1 ? 'CARD' : 'CASH',
          hour: 10 + ticket,
        });
        await sync(key, { kind: 'SALE', clientId: sale.clientId, sale });
        if (ticket !== 1) cash = cash.plus(sale.total);
        if (dayIndex % 7 === 0 && ticket === 0) {
          const returnKey = `${shiftKey}/return-${ticket}`;
          const refund = makeSale(
            returnKey,
            day,
            till,
            shiftClientId,
            [{ ...specs[0], qty: specs[0].product.base === 'KG' ? '0.25' : '1', refundsLineNo: 1 }],
            { kind: 'RETURN', refundsSaleClientId: sale.clientId, hour: 16 },
          );
          await sync(returnKey, { kind: 'RETURN', clientId: refund.clientId, sale: refund });
          cash = cash.minus(refund.total);
        }
      }
      await sync(`${shiftKey}/close`, {
        kind: 'SHIFT_CLOSED',
        clientId: shiftClientId,
        shiftClosed: {
          clientId: shiftClientId,
          closedAt: instant(day, 20),
          countedCash: cash.toFixed(2),
          floatKept: '0',
          note: 'QA exact cash count',
        },
      });
      await post(ctx, `${shiftKey}/handover`, `/pos/shifts/${opened.id}/handover`, {
        moneyAccountId: refs.money.cash.id,
        paidOn: day,
      });
    }
    if (day.endsWith('-15')) await registerHistoricalExpiry(ctx, monthIndex, day);
    const reconciliation = await ctx.service(
      `history/${day}/snapshot`,
      'Daily normal stock reconciliation and snapshot',
      () => runtime.stock.reconcile('QA_SIX_MONTH'),
      async () => {
        const found = await runtime.reader.query(
          'SELECT count(*)::int AS n FROM stock_snapshot_daily WHERE snapshot_date=$1',
          [day],
        );
        return found.rows[0].n ? { snapshotDate: day, recovered: true } : null;
      },
    );
    if (reconciliation.diffCount > 0)
      throw new Error(`Stock drift on ${day}: ${JSON.stringify(reconciliation.diffs)}`);
    state.completedDays.push(day);
    await ctx.save();
    process.stdout.write(`History ${day}: posted wholesale/POS/payments/stock snapshot\n`);
  }
}

async function receiveMonth(ctx, monthIndex, day) {
  const { refs } = ctx,
    Decimal = ctx.runtime.shared.money.Decimal;
  refs.receiptSources ??= {};
  for (const [supplierIndex, supplier] of refs.suppliers.entries()) {
    const key = `history/${day.slice(0, 7)}/purchase/${supplierIndex}`;
    const products = refs.products.filter((p) => p.supplierIndex === supplierIndex);
    const order = await post(ctx, `${key}/draft`, '/purchase-orders', {
      orderDate: day,
      note: `Fictional QA ${key}`,
      supplierIds: [supplier.id],
    });
    await ctx.write(
      `${key}/lines`,
      'PUT',
      `/purchase-orders/${order.id}/suppliers/${supplier.id}/lines`,
      {
        changes: products.map((p) => ({
          productId: p.id,
          productUnitId: p.boxUnitId,
          qty: purchaseQty(p, monthIndex),
          previousUnitId: null,
          previousQty: null,
        })),
      },
      {
        recover: async () => {
          const current = await ctx.all(
            `/purchase-orders/${order.id}/suppliers/${supplier.id}/rows?filter=ORDERED`,
          );
          if (
            current.filter((r) => products.some((p) => p.id === r.productId)).length ===
            products.length
          )
            return { recovered: true };
          return null;
        },
      },
    );
    for (const to of ['SENT', 'SHIPPING', 'IN_TRANSIT', 'ARRIVED'])
      await ctx.write(
        `${key}/${to}`,
        'POST',
        `/purchase-orders/${order.id}/suppliers/${supplier.id}/status`,
        { to },
        {
          recover: async () => {
            const current = await ctx.get(`/purchase-orders/${order.id}`);
            const found = current.suppliers.find((s) => s.supplierId === supplier.id);
            return found?.status === to ? current : null;
          },
        },
      );
    const current = await ctx.get(`/purchase-orders/${order.id}`);
    const receiptId = current.suppliers.find((s) => s.supplierId === supplier.id)?.receiptId;
    if (!receiptId) throw new Error(`Purchase order ${key} produced no receipt`);
    const receipt = await ctx.get(`/receipts/${receiptId}`);
    let qty = new Decimal(0),
      gross = new Decimal(0);
    for (const line of receipt.lines) {
      const product = products.find((p) => p.id === line.productId);
      const enteredQty = purchaseQty(product, monthIndex),
        qtyBase = new Decimal(enteredQty).times(product.carton);
      const price = new Decimal(product.baseCost).times(1 + monthIndex * 0.015).toDecimalPlaces(2);
      const amount = price.times(qtyBase).toDecimalPlaces(2);
      qty = qty.plus(qtyBase);
      gross = gross.plus(amount);
      await ctx.write(
        `${key}/count/${line.id}`,
        'PATCH',
        `/receipt-lines/${line.id}`,
        {
          arrivedQtyBase: qtyBase.toFixed(),
          docAmount: amount.toFixed(2),
          printedUnitPrice: price.times(product.carton).toFixed(2),
          salePrice: String(price.times('1.2').div(10).ceil().times(10).toNumber()),
        },
        { idempotent: true },
      );
      refs.receiptSources[`${monthIndex}/${product.index}`] = {
        receiptId,
        receiptLineId: line.id,
        qtyBase: qtyBase.toFixed(),
        amount: amount.toFixed(2),
      };
    }
    await ctx.write(
      `${key}/totals`,
      'PATCH',
      `/receipts/${receiptId}`,
      {
        supplierDocNo: `QA-${day.slice(0, 7)}-${supplierIndex + 1}`,
        supplierDocDate: day,
        noteTotalQty: qty.toFixed(),
        noteTotalAmount: gross.toFixed(2),
      },
      { idempotent: true },
    );
    await post(ctx, `${key}/post`, `/receipts/${receiptId}/post`);
    await ctx.write(
      `${key}/cost`,
      'PUT',
      `/receipts/${receiptId}/costs`,
      {
        costingVersion: 0,
        noteTotalAmount: gross.toFixed(2),
        lines: receipt.lines.map((line) => ({
          lineId: line.id,
          amount:
            refs.receiptSources[
              `${monthIndex}/${products.find((p) => p.id === line.productId).index}`
            ].amount,
        })),
      },
      idem,
    );
    // A normal account transaction settles 70% of each bill and leaves realistic supplier AP.
    const payable = await ctx.get(`/supplier-balances/${supplier.id}`);
    const amount = gross.times('0.7').toDecimalPlaces(2);
    if (new Decimal(payable.balance).lte(0)) throw new Error(`Missing supplier payable ${key}`);
    const ap = refs.accountRoles.AP;
    if (!ap) throw new Error('Missing AP posting role');
    const supplierPayment = await post(
      ctx,
      `${key}/supplier-payment`,
      '/journal-entries/by-account',
      {
        journal: 'BANK',
        entryDate: day,
        description: `Fictional supplier payment ${key}`,
        accountId: refs.accounts.bank.id,
        side: 'CREDIT',
        counterAccountId: ap.id,
        amount: amount.toFixed(2),
        counterParty: { supplierId: supplier.id },
      },
    );
    const pairs = await ctx.memo(
      `${key}/supplier-allocation-plan`,
      'Read-only exact supplier bill/payment item match',
      async () => {
        const items = await ctx.all(`/supplier-balances/${supplier.id}/open-items`);
        const debit = exactlyOne(
          items.filter((i) => i.side === 'DEBIT' && i.number === supplierPayment.number),
          `${key}/payment-item`,
        );
        const credit = exactlyOne(
          items.filter((i) => i.side === 'CREDIT' && i.number === receipt.number),
          `${key}/bill-item`,
        );
        if (
          !debit ||
          !credit ||
          new Decimal(debit.openAmount).lt(amount) ||
          new Decimal(credit.openAmount).lt(amount)
        )
          throw new Error(`Supplier bill/payment cannot be allocated ${key}`);
        return [{ debitItemId: debit.id, creditItemId: credit.id, amount: amount.toFixed(2) }];
      },
    );
    await post(ctx, `${key}/supplier-allocation`, '/finance/allocations', {
      supplierId: supplier.id,
      date: day,
      description: `Fictional supplier bill settlement ${key}`,
      pairs,
    });
    await ctx.save();
  }
}

async function transferMonth(ctx, monthIndex) {
  const { refs } = ctx;
  for (const fromIndex of [0, 1])
    for (const toIndex of [2, 3]) {
      const key = `history/${MONTHS[monthIndex]}/transfer/${fromIndex}/${toIndex}`;
      const products = refs.products.filter((p) => p.homeWarehouseIndex === fromIndex);
      // Bounded groups fit the production transfer-line limit.
      for (let offset = 0; offset < products.length; offset += 100) {
        const group = products.slice(offset, offset + 100),
          groupKey = `${key}/${offset}`;
        const transfer = await post(ctx, `${groupKey}/create`, '/transfers', {
          origin: 'PUSH',
          sourceWarehouseId: refs.warehouses[fromIndex].id,
          destWarehouseId: refs.warehouses[toIndex].id,
          note: `Fictional QA ${groupKey}`,
          lines: group.map((p) => ({ productUnitId: p.baseUnitId, qty: '12' })),
        });
        await post(ctx, `${groupKey}/ship`, `/transfers/${transfer.id}/ship`, {
          lines: transfer.lines.map((line) => ({
            lineId: line.id,
            qty: '12',
            binId: line.fromBinId ?? refs.bins[fromIndex].id,
          })),
        });
        await post(ctx, `${groupKey}/receive`, `/transfers/${transfer.id}/receive`, {
          lines: transfer.lines.map((line) => ({
            lineId: line.id,
            qty: '12',
            binId: refs.floors[toIndex].id,
          })),
        });
      }
    }
}

async function monthlyExpenses(ctx, monthIndex, day) {
  for (const [key, base] of [
    ['rent', 2800000],
    ['wages', 6500000],
    ['utilities', 680000],
    ['delivery', 420000],
    ['supplies', 180000],
  ])
    await post(ctx, `history/${MONTHS[monthIndex]}/expense/${key}`, '/payments', {
      kind: 'OTHER_OUT',
      moneyAccountId: ctx.refs.money.bank.id,
      glAccountId: ctx.refs.accounts[key].id,
      amount: String(base + monthIndex * 15000),
      paidOn: day,
      description: `Fictional ${key}; ${key === 'wages' ? 'monthly wage expense, not generated payroll/attendance' : 'business expense'}`,
    });
}

async function registerHistoricalExpiry(ctx, monthIndex, day) {
  const product = ctx.refs.products[150 + monthIndex],
    source = ctx.refs.receiptSources[`${monthIndex}/${product.index}`];
  const key = `history/${MONTHS[monthIndex]}/expiry-review`;
  const item = await post(ctx, `${key}/item`, '/expiry/items', {
    productId: product.id,
    expiryDate: addDays(day, 4),
    qtyFloor: '3',
    qtyWarehouse: '0',
    allowDuplicate: true,
    note: `Fictional QA ${key}; historical review only, no backdated markdown publication`,
  });
  await ctx.write(
    `${key}/liability`,
    'PUT',
    `/expiry/items/${item.id}/liability`,
    {
      type: 'SPECIFIC',
      roleIds: [],
      userIds: [ctx.refs.admin.id],
      note: 'Fictional QA liability only',
    },
    idem,
  );
  await ctx.write(
    `${key}/source`,
    'PUT',
    `/expiry/items/${item.id}/source`,
    {
      expectedVersion: 0,
      receiptLineId: source.receiptLineId,
      qtyBase: '3',
    },
    {
      recover: async () => {
        const found = await ctx.get(`/expiry/items/${item.id}/commerce`);
        return found.source?.receiptLineId === source.receiptLineId ? found : null;
      },
    },
  );
  ctx.state.checks.historicalExpiry ??= [];
  if (!ctx.state.checks.historicalExpiry.some((r) => r.month === MONTHS[monthIndex]))
    ctx.state.checks.historicalExpiry.push({
      month: MONTHS[monthIndex],
      itemId: item.id,
      published: false,
    });
}

export async function expiryRoundTrip(ctx, monthIndex, day, till, shiftClientId, makeSale, sync) {
  const product = ctx.refs.products[150 + monthIndex],
    source = ctx.refs.receiptSources[`${monthIndex}/${product.index}`];
  const key = `current/${day}/expiry`;
  const item = await post(ctx, `${key}/item`, '/expiry/items', {
    productId: product.id,
    expiryDate: addDays(day, 4),
    qtyFloor: '3',
    qtyWarehouse: '0',
    allowDuplicate: true,
    note: `Fictional QA ${key}`,
  });
  await ctx.write(
    `${key}/liability`,
    'PUT',
    `/expiry/items/${item.id}/liability`,
    {
      type: 'SPECIFIC',
      roleIds: [],
      userIds: [ctx.refs.admin.id],
      note: 'Fictional QA liability only',
    },
    idem,
  );
  const linked = await ctx.write(
    `${key}/source`,
    'PUT',
    `/expiry/items/${item.id}/source`,
    {
      expectedVersion: 0,
      receiptLineId: source.receiptLineId,
      qtyBase: '3',
    },
    {
      recover: async () => {
        const found = await ctx.get(`/expiry/items/${item.id}/commerce`);
        return found.source?.receiptLineId === source.receiptLineId ? found : null;
      },
    },
  );
  const markdown = await post(ctx, `${key}/markdown`, `/expiry/items/${item.id}/markdowns`, {
    expectedVersion: item.editVersion,
    expectedSourceVersion: linked.sourceVersion,
    expectedCostingVersion: linked.source.current.version,
    expectedLiabilityFingerprint: linked.liabilityFingerprint,
    receiptLineId: source.receiptLineId,
    qtyBase: '3',
    warehouseId: ctx.refs.warehouses[2].id,
    channel: 'RETAIL',
    contextId: till.id,
    unitPrice: '50',
    payrollMonth: MONTHS[monthIndex],
  });
  const approved = markdown.markdowns.at(-1);
  if (!approved || Number(approved.accountingUnitCost) <= 50)
    throw new Error('Expiry fixture must be genuinely below accounting cost');
  const specs = [{ product, qty: '3', unitPrice: '50', expiryBarcode: approved.barcode }];
  const sale = await makeSale(`${key}/sale`, day, till, shiftClientId, specs, { hour: 14 });
  await sync(`${key}/sale`, { kind: 'SALE', clientId: sale.clientId, sale });
  for (const [i, qty] of ['1', '2'].entries()) {
    const refund = await makeSale(
      `${key}/return-${i}`,
      day,
      till,
      shiftClientId,
      [{ product, qty, unitPrice: '50', refundsLineNo: 1, expiryBarcode: approved.barcode }],
      { kind: 'RETURN', refundsSaleClientId: sale.clientId, hour: 15, minute: i },
    );
    await sync(`${key}/return-${i}`, { kind: 'RETURN', clientId: refund.clientId, sale: refund });
  }
  const trace = {
    day,
    historical: false,
    itemId: item.id,
    markdownId: approved.id,
    saleClientId: sale.clientId,
    soldQty: '3',
    partialReturnQty: '1',
    finalReturnQty: '2',
    price: '50',
    accountingUnitCost: approved.accountingUnitCost,
  };
  ctx.state.currentExpiry = trace;
  return trace;
}
