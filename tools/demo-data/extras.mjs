// Every write goes through the runner's durable journal and normal staff API.
// These helpers never change company defaults, providers, existing staff or periods.
const DEMO = 'DEMO';
const named = (name) => ({ match: (row) => row.name === name });
const assert = (condition, message) => {
  if (!condition) throw new Error(`Demo extras: ${message}`);
};
const one = (rows, predicate, label) => {
  const matches = rows.filter(predicate);
  assert(matches.length <= 1, `multiple records match ${label}; refusing to guess`);
  return matches[0];
};
const own = (row, label = 'record') => {
  assert(row && /DEMO/.test(row.name ?? row.fullName ?? row.note ?? ''), `${label} is not DEMO`);
  return row;
};

async function seedMoney(ctx) {
  const accounts = [];
  for (const [suffix, code, journal, name] of [
    ['cash', '1001-DEMO', 'CASH', 'DEMO · Туршилтын касс'],
    ['bank', '1101-DEMO', 'BANK', 'DEMO · Туршилтын банк'],
  ]) {
    const existing = one(await ctx.all('/gl-accounts'), (row) => row.code === code, code);
    if (existing) assert(existing.name === name, `${code} belongs to another account`);
    const account = await ctx.create(
      `extras/finance/account/${suffix}`,
      '/gl-accounts',
      { code, name, kind: 'ASSET', journal, currency: 'MNT' },
      { listPath: '/gl-accounts', match: (row) => row.code === code && row.name === name },
    );
    // CASH/BANK journal accounts get their money account from the existing API service.
    const money = one(
      await ctx.all('/money-accounts'),
      (row) => row.glAccountId === account.id,
      `${code} money account`,
    );
    assert(money?.status === 'ACTIVE', `${code} has no active money account`);
    accounts.push(money);
  }
  return accounts;
}

async function salesPipeline(ctx) {
  const name = 'DEMO · Борлуулалтын самбар';
  const board = await ctx.create(
    'extras/sales/board',
    '/sales-boards',
    { name, branchId: ctx.refs.branch.id },
    { listPath: '/sales-boards', ...named(name) },
  );
  const pipelineName = 'DEMO · Захиалгын урсгал';
  const tree = await ctx.all('/sales-boards');
  const existing = one(
    tree.flatMap((row) => row.pipelines ?? []),
    (row) => row.boardId === board.id && row.name === pipelineName,
    pipelineName,
  );
  const created =
    existing ??
    (await ctx.mutate('extras/sales/pipeline', 'POST', '/sales-pipelines', {
      boardId: board.id,
      name: pipelineName,
      visibility: 'PUBLIC',
      ownOrdersOnly: false,
      kind: 'SALES',
      roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
      stages: [
        ['Ноорог', 'NONE'],
        ['Баталгаажсан', 'CONFIRM'],
        ['Бэлтгэж байна', 'PICK'],
        ['Бэлэн', 'NONE'],
        ['Борлуулсан', 'SALE'],
        ['Цуцалсан', 'CANCEL'],
      ].map(([stageName, action]) => ({
        name: `${DEMO} · ${stageName}`,
        action,
        printPickList: false,
        printDeliveryNote: false,
        ebarimt: false,
        roles: { VIEW: [], EDIT: [], MOVE: [] },
      })),
    }));
  const pipeline = own(await ctx.api.get(`/sales-pipelines/${created.id}`), 'pipeline');
  assert(pipeline.boardId === board.id && pipeline.kind === 'SALES', 'wrong demo pipeline');
  assert(
    pipeline.stages.every((stage) => stage.ebarimt === false),
    'receipt-enabled demo stage',
  );
  const stage = (action) => {
    const found = one(pipeline.stages, (row) => row.action === action, `${action} stage`);
    assert(found, `demo pipeline has no ${action} stage`);
    return found.id;
  };
  return { board, pipeline, stage };
}

async function seedSales(ctx, moneyAccounts) {
  const { Decimal } = ctx.shared.money;
  const { board, pipeline, stage } = await salesPipeline(ctx);
  const products = ctx.refs.products.filter(
    (product) => product.demo.stock === 'NORMAL' && product.demo.stage === 'READY',
  );
  assert(products.length >= 12 && ctx.refs.customers.length >= 10, 'core sales data incomplete');
  const existing = await ctx.all(`/sales-orders?pipeline=${pipeline.id}`);
  const details = [];
  for (const row of existing) details.push(await ctx.api.get(`/sales-orders/${row.id}`));
  const targets = [
    ...Array(4).fill('DRAFT'),
    ...Array(4).fill('CONFIRMED'),
    ...Array(3).fill('PICKING'),
    ...Array(3).fill('PACKED'),
    ...Array(10).fill('INVOICED'),
    ...Array(2).fill('CANCELLED'),
  ];
  const orders = [];
  const invoices = [];
  const payments = [];
  for (const [index, target] of targets.entries()) {
    const key = `extras/sales/order/${index + 1}`;
    const note = `DEMO · Захиалга ${String(index + 1).padStart(2, '0')} · ${target}`;
    const customer = ctx.refs.customers[index % ctx.refs.customers.length];
    const prior = one(details, (row) => row.note === note, note);
    const created =
      prior ??
      (await ctx.mutate(`${key}/create`, 'POST', '/sales-orders', {
        customerId: customer.id,
        pipelineId: pipeline.id,
        fulfilment: 'PICKUP',
        deliveryDate: ctx.today,
        paymentMethod: index % 2 === 0 ? 'CASH' : 'BANK_TRANSFER',
        note,
        lines: Array.from({ length: 3 }, (_, offset) => ({
          productUnitId: products[(index * 3 + offset) % products.length].demo.baseUnitId,
          qty: String(2 + ((index + offset) % 3)),
        })),
      }));
    let order = await ctx.api.get(`/sales-orders/${created.id}`);
    assert(order.pipelineId === pipeline.id && order.note === note, 'unexpected demo sales order');
    const move = async (action) => {
      await ctx.mutate(`${key}/move/${action}`, 'POST', `/sales-orders/${order.id}/move`, {
        stageId: stage(action),
        ...(action === 'CANCEL' ? { reason: 'DEMO · Харилцагчийн хүсэлтээр цуцалсан' } : {}),
      });
      order = await ctx.api.get(`/sales-orders/${order.id}`);
    };
    if (target === 'CANCELLED' && order.status === 'DRAFT') await move('CANCEL');
    if (!['DRAFT', 'CANCELLED'].includes(target)) {
      if (order.status === 'DRAFT') await move('CONFIRM');
      if (!['CONFIRMED'].includes(target)) {
        if (order.status === 'CONFIRMED') await move('PICK');
        if (target !== 'PICKING' && order.status === 'PICKING') {
          const info = await ctx.api.get(`/sales-orders/${order.id}/pick-info`);
          const lines = order.lines.map((line) => {
            assert(
              new Decimal(line.qtyApproved).gte(line.qtyBase),
              `order ${order.number} has a stock shortage; no partial demo delivery`,
            );
            const proposal = info.find((row) => row.lineId === line.id);
            const bin = proposal?.bins.find(
              (row) =>
                row.id === proposal.proposedBinId && new Decimal(row.onHand).gte(line.qtyBase),
            );
            assert(bin, `no stocked pick bin for order ${order.number}, line ${line.id}`);
            return { lineId: line.id, qty: line.qtyBase, binId: bin.id };
          });
          await ctx.mutate(`${key}/pick`, 'POST', `/sales-orders/${order.id}/pick`, { lines });
          order = await ctx.api.get(`/sales-orders/${order.id}`);
        }
        if (target === 'PACKED' && order.status === 'PACKED') {
          const ready = pipeline.stages.find((row) => row.name === 'DEMO · Бэлэн');
          assert(ready, 'demo ready stage missing');
          if (order.stageId !== ready.id) {
            await ctx.mutate(`${key}/ready`, 'POST', `/sales-orders/${order.id}/move`, {
              stageId: ready.id,
            });
            order = await ctx.api.get(`/sales-orders/${order.id}`);
          }
        }
        if (target === 'INVOICED' && order.status === 'PACKED') await move('SALE');
      }
    }
    assert(order.status === target, `order ${order.number} is ${order.status}, expected ${target}`);
    orders.push({ id: order.id, number: order.number, status: order.status });
    if (target === 'INVOICED') {
      const candidates = await ctx.all(`/invoices?customerId=${customer.id}`);
      const invoice = one(candidates, (row) => row.orderId === order.id, `invoice for ${order.id}`);
      assert(invoice, `missing invoice for ${order.number}`);
      const detail = await ctx.api.get(`/invoices/${invoice.id}`);
      assert(detail.ebarimt === null, 'demo sale unexpectedly requested an e-Barimt receipt');
      invoices.push({ id: detail.id, number: detail.number, orderId: order.id });
      const invoiceIndex = index - 14;
      // Four paid, three partly paid and three open invoices give useful receivables filters.
      if (invoiceIndex < 7) {
        const reference = `DEMO-SO-${String(index + 1).padStart(2, '0')}`;
        const amount =
          invoiceIndex < 4
            ? detail.total
            : new Decimal(detail.total).div(2).toDecimalPlaces(0).toFixed(2);
        const payment = await ctx.create(
          `${key}/payment`,
          '/payments',
          {
            kind: 'CUSTOMER_PAYMENT',
            moneyAccountId: moneyAccounts[invoiceIndex % 2].id,
            customerId: customer.id,
            amount,
            paidOn: ctx.today,
            reference,
            description: `DEMO · ${order.number} захиалгын төлбөр`,
            allocations: [{ invoiceId: detail.id, amount }],
          },
          {
            listPath: `/payments?customerId=${customer.id}`,
            match: (row) => row.reference === reference,
          },
        );
        payments.push({ id: payment.id, number: payment.number });
      }
    }
  }
  ctx.log(
    `Extras: ${orders.length} sales orders, ${invoices.length} invoices, ${payments.length} payments`,
  );
  return { boardId: board.id, pipelineId: pipeline.id, orders, invoices, payments };
}

async function seedProcurement(ctx) {
  const { addDays } = ctx.shared.time;
  const orders = [];
  const targets = ['PREPARING', 'SENT', 'SHIPPING', 'IN_TRANSIT', 'ARRIVED', 'PREPARING'];
  const statuses = ['PREPARING', 'SENT', 'SHIPPING', 'IN_TRANSIT', 'ARRIVED'];
  for (const [index, target] of targets.entries()) {
    const supplier = ctx.refs.suppliers[index];
    const key = `extras/procurement/order/${index + 1}`;
    const note = `DEMO · Татан авалт ${String(index + 1).padStart(2, '0')} · ${target}`;
    const created = await ctx.create(
      `${key}/create`,
      '/purchase-orders',
      { orderDate: addDays(ctx.today, -index), note, supplierIds: [supplier.id] },
      { listPath: '/purchase-orders', match: (row) => row.note === note },
    );
    let order = await ctx.api.get(`/purchase-orders/${created.id}`);
    assert(order.note === note, 'unexpected purchase order');
    let part = order.suppliers.find((row) => row.supplierId === supplier.id);
    assert(part && order.suppliers.length === 1, 'unexpected purchase-order supplier');
    if (part.status === 'PREPARING') {
      const rows = await ctx.all(`/purchase-orders/${order.id}/suppliers/${supplier.id}/rows`);
      const candidates = rows.filter((row) =>
        ctx.refs.products.some((product) => product.id === row.productId),
      );
      assert(candidates.length > 0, `${supplier.name} has no demo main products`);
      const changes = candidates.slice(0, 3).map((row) => ({
        productId: row.productId,
        field: 'ORDERED',
        productUnitId: row.units.at(-1).id,
        qty: String(4 + index),
        previousUnitId: null,
        previousQty: null,
      }));
      const result = await ctx.mutate(
        `${key}/lines`,
        'PUT',
        `/purchase-orders/${order.id}/suppliers/${supplier.id}/lines`,
        { changes },
      );
      assert(result.refused.length === 0 && result.conflicts.length === 0, 'demo PO line refused');
    }
    for (const next of statuses.slice(1, statuses.indexOf(target) + 1)) {
      if (statuses.indexOf(part.status) < statuses.indexOf(next)) {
        order = await ctx.mutate(
          `${key}/status/${next}`,
          'POST',
          `/purchase-orders/${order.id}/suppliers/${supplier.id}/status`,
          { to: next },
        );
        part = order.suppliers.find((row) => row.supplierId === supplier.id);
      }
    }
    const current = await ctx.api.get(`/purchase-orders/${order.id}`);
    assert(current.status === target, `PO ${current.number} did not reach ${target}`);
    orders.push({ id: current.id, number: current.number, status: current.status });
  }
  ctx.log(`Extras: ${orders.length} purchase orders, including one unposted arrival receipt`);
  return orders;
}

async function seedWorkforce(ctx) {
  const { Decimal } = ctx.shared.money;
  const { addDays, businessInstant } = ctx.shared.time;
  const { checkScheduleDays, weekdayIndex } = ctx.shared.hr;
  const divisions = [];
  for (const [index, label] of ['Борлуулалт', 'Агуулах', 'Санхүү'].entries()) {
    const name = `DEMO · ${label}`;
    divisions.push(
      await ctx.create(
        `extras/hr/division/${index}`,
        '/hr/divisions',
        { name, sort: 100 + index },
        {
          listPath: '/hr/divisions',
          ...named(name),
        },
      ),
    );
  }
  const scheduleName = 'DEMO · Даваа–Баасан 09–18';
  // A day off is omitted from FIXED schedules; each present day needs actual hours.
  const checkedSchedule = checkScheduleDays(
    'FIXED',
    Array.from({ length: 5 }, (_, index) => ({
      weekday: index + 1,
      start: '09:00',
      end: '18:00',
      breakStart: '13:00',
      breakEnd: '14:00',
      minutes: 0,
    })),
  );
  assert(checkedSchedule.ok, 'invalid demo working schedule');
  const schedule = await ctx.create(
    'extras/hr/schedule',
    '/hr/schedules',
    {
      name: scheduleName,
      kind: 'FIXED',
      color: '#3b82f6',
      days: checkedSchedule.days,
      userIds: [],
    },
    { listPath: '/hr/schedules', ...named(scheduleName) },
  );
  const siteName = 'DEMO · Туршилтын ажлын байр';
  const site = await ctx.create(
    'extras/hr/site',
    '/hr/work-sites',
    {
      name: siteName,
      lat: '47.918412',
      lng: '106.917000',
      radiusM: 150,
      branchId: ctx.refs.branch.id,
    },
    { listPath: '/hr/work-sites', ...named(siteName) },
  );
  const employees = [];
  const events = [];
  const names = [
    'Тэмүүлэн',
    'Номин',
    'Билгүүн',
    'Ану',
    'Энхжин',
    'Төгөлдөр',
    'Саруул',
    'Марал',
    'Тэнүүн',
    'Сондор',
    'Итгэл',
    'Уянга',
  ];
  const month = ctx.today.slice(0, 7);
  for (const [index, firstName] of names.entries()) {
    const key = `extras/hr/employee/${index + 1}`;
    const fullName = `DEMO ${firstName}`;
    // Synthetic numeric identifiers satisfy the API's shape; no password/code is issued.
    const phone = `10000${String(index + 1).padStart(3, '0')}`;
    const users = await ctx.all('/users');
    const existing = one(users, (row) => row.phone === `+976${phone}`, phone);
    if (existing) assert(existing.fullName === fullName, `synthetic phone ${phone} is in use`);
    const user = await ctx.create(
      `${key}/user`,
      '/users',
      { fullName, phone, roleIds: [], scopes: { warehouseIds: [], branchIds: [] } },
      {
        listPath: '/users',
        match: (row) => row.fullName === fullName && row.phone === `+976${phone}`,
      },
    );
    const currentUser = await ctx.api.get(`/users/${user.id}`);
    assert(
      !currentUser.passwordSet && currentUser.roleIds.length === 0,
      'demo employee has login access',
    );
    await ctx.mutate(`${key}/card`, 'PUT', `/hr/staff/${user.id}`, {
      firstName,
      lastName: 'DEMO',
      phone,
      position: ['Туршилтын борлуулагч', 'Туршилтын нярав', 'Туршилтын нягтлан'][index % 3],
      divisionId: divisions[index % 3].id,
      employmentType: index === 11 ? 'PROBATION' : 'PERMANENT',
      gender: index % 2 ? 'FEMALE' : 'MALE',
      employedOn: `${month}-01`,
      scheduleId: schedule.id,
    });
    await ctx.mutate(`${key}/attendance-terms`, 'PUT', `/hr/employees/${user.id}`, {
      tracked: true,
      workStart: null,
      workEnd: null,
      graceMinutes: 10,
      workdays: null,
      siteIds: [site.id],
    });
    // Past days only, with complete and late turns plus a few intentional absences.
    for (let offset = 7; offset >= 1; offset -= 1) {
      const day = addDays(ctx.today, -offset);
      if (day.slice(0, 7) !== month || weekdayIndex(day) >= 5 || (index + offset) % 9 === 0)
        continue;
      for (const [kind, clock] of [
        ['IN', (index + offset) % 5 === 0 ? '09:24:00' : '08:56:00'],
        ['OUT', '18:03:00'],
      ]) {
        const at = businessInstant(`${day} ${clock}`).toISOString();
        const event = await ctx.create(
          `${key}/attendance/${day}/${kind}`,
          '/hr/attendance/events',
          { userId: user.id, kind, at, note: 'DEMO · Ирцийн туршилтын бүртгэл' },
          {
            listPath: `/hr/attendance/events?userId=${user.id}&date=${day}`,
            match: (row) =>
              row.userId === user.id &&
              row.kind === kind &&
              row.at === at &&
              row.note?.startsWith('DEMO'),
          },
        );
        events.push(event.id);
      }
    }
    await ctx.mutate(`${key}/pay-terms`, 'PUT', `/payroll/terms/${user.id}`, {
      baseSalary: new Decimal('1600000').plus(new Decimal('100000').times(index)).toFixed(0),
      paysSocialInsurance: true,
      active: true,
      items: [
        {
          key: 'demo-attendance',
          name: 'DEMO · Ирц',
          source: 'ATTENDANCE',
          amount: '200000',
          sort: 0,
        },
        {
          key: 'demo-work',
          name: 'DEMO · Ажлын үнэлгээ',
          source: 'MANUAL',
          amount: '150000',
          sort: 1,
        },
      ],
    });
    employees.push({ userId: user.id, fullName });
  }
  const note = 'DEMO · Туршилтын цалингийн ноорог';
  const runs = await ctx.all('/payroll/runs');
  const existingRun = one(runs, (row) => row.month === month, `payroll ${month}`);
  let payroll = null;
  if (!existingRun || existingRun.note === note) {
    const terms = await ctx.all('/payroll/terms');
    const ids = new Set(employees.map((row) => row.userId));
    if (terms.some((row) => row.hasTerms && row.active && !ids.has(row.userId))) {
      ctx.log('Extras: payroll run skipped because non-demo employees have active pay terms');
    } else {
      const run = await ctx.create(
        'extras/payroll/run',
        '/payroll/runs',
        { month, note },
        {
          listPath: '/payroll/runs',
          match: (row) => row.month === month && row.note === note,
        },
      );
      const detail = await ctx.api.get(`/payroll/runs/${run.id}`);
      assert(
        detail.status === 'DRAFT' && detail.lines.every((line) => ids.has(line.userId)),
        'unexpected payroll run',
      );
      const scores = detail.lines.flatMap((line, index) =>
        line.items
          .filter((item) => item.source === 'MANUAL')
          .map((item) => ({
            itemId: item.id,
            scorePercent: String(80 + (index % 5) * 5),
            note: 'DEMO · Туршилтын үнэлгээ',
          })),
      );
      if (scores.length)
        await ctx.mutate('extras/payroll/scores', 'PUT', `/payroll/scoring/runs/${run.id}/scores`, {
          scores,
        });
      payroll = { id: run.id, month, status: 'DRAFT' };
    }
  } else {
    ctx.log('Extras: existing non-demo payroll month preserved; no run created');
  }
  ctx.log(
    `Extras: ${employees.length} staff without passwords or roles, ${events.length} attendance turns`,
  );
  return {
    employees,
    attendanceEventIds: events,
    payroll,
    divisionIds: divisions.map((row) => row.id),
    scheduleId: schedule.id,
    siteId: site.id,
  };
}

async function seedExpiryAndSegments(ctx) {
  const { addDays } = ctx.shared.time;
  const items = [];
  const offsets = [-14, -3, 0, 2, 5, 7, 14, 21, 30, 45, 60, 90];
  for (const [index, offset] of offsets.entries()) {
    const product = ctx.refs.products[index];
    const note = `DEMO · Хугацааны хяналт ${String(index + 1).padStart(2, '0')}`;
    const item = await ctx.create(
      `extras/expiry/${index + 1}`,
      '/expiry/items',
      {
        productId: product.id,
        expiryDate: addDays(ctx.today, offset),
        qtyFloor: String(3 + index),
        qtyWarehouse: String(6 + index * 2),
        note,
      },
      {
        listPath: '/expiry/items?view=ACTIVE',
        match: (row) => row.product?.id === product.id && row.note === note,
      },
    );
    const status = index % 4 === 1 ? 'CITY_RETURN' : index % 4 === 2 ? 'INTERNAL_SALE' : 'REVIEW';
    if (status !== 'REVIEW')
      await ctx.mutate(
        `extras/expiry/${index + 1}/status`,
        'PUT',
        `/expiry/items/${item.id}/status`,
        { status },
      );
    items.push({ id: item.id, status });
  }
  const segments = [];
  for (const [index, label] of [
    'Онцлох бараа',
    'Өдөр тутмын хэрэгцээ',
    'Ундаа ба хүнс',
  ].entries()) {
    const name = `DEMO · ${label}`;
    const segment = await ctx.create(
      `extras/segments/${index + 1}`,
      '/segments/lists',
      {
        name,
        description: 'DEMO · Программын туршилтын барааны жагсаалт',
        productIds: ctx.refs.products
          .slice(index * 12, index * 12 + 12)
          .map((product) => product.id),
      },
      { listPath: '/segments', ...named(name) },
    );
    segments.push({ id: segment.id, name });
  }
  ctx.log(`Extras: ${items.length} expiry notes and ${segments.length} product lists`);
  return { expiryItems: items, segments };
}

async function seedTills(ctx) {
  const name = 'DEMO · Туршилтын кассын сервер';
  const node = await ctx.create(
    'extras/pos/node',
    '/pos/edge-nodes',
    { code: 'DEMO-EDGE', name },
    {
      listPath: '/pos/edge-nodes',
      match: (row) => row.code === 'DEMO-EDGE' && row.name === name,
    },
  );
  const store = ctx.refs.warehouses.find((warehouse) => warehouse.kind === 'STORE');
  assert(store, 'demo store warehouse missing');
  const tills = [];
  for (let index = 1; index <= 2; index += 1) {
    const code = `DEMO${index}`;
    const tillName = `DEMO · Касс ${index}`;
    const till = await ctx.create(
      `extras/pos/till/${index}`,
      '/pos/tills',
      {
        edgeNodeId: node.id,
        warehouseId: store.id,
        code,
        name: tillName,
        printerHost: null,
        drawerKick: false,
      },
      {
        listPath: '/pos/tills',
        match: (row) => row.edgeNodeId === node.id && row.code === code && row.name === tillName,
      },
    );
    tills.push({ id: till.id, code });
  }
  ctx.log('Extras: two unpaired demo tills; no PINs, tokens, shifts or receipts issued');
  return { edgeNodeId: node.id, tills };
}

export async function seedExtras(ctx) {
  const moneyAccounts = await seedMoney(ctx);
  const sales = await seedSales(ctx, moneyAccounts);
  const purchaseOrders = await seedProcurement(ctx);
  const workforce = await seedWorkforce(ctx);
  const expiryAndSegments = await seedExpiryAndSegments(ctx);
  const pos = await seedTills(ctx);
  return {
    moneyAccountIds: moneyAccounts.map((row) => row.id),
    sales,
    purchaseOrders,
    workforce,
    ...expiryAndSegments,
    pos,
    skipped: [
      'No provider calls, SMS, e-Barimt receipts, real bank details, pairing codes or cashier PINs.',
      'No company defaults, existing staff, existing documents or financial periods changed.',
      'Payroll stays DRAFT; arrival receipt stays unposted; tills stay unpaired without sales.',
    ],
  };
}
