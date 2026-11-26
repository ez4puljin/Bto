import { DEPARTMENTS, SUPPLIERS, PRODUCTS, CUSTOMERS, FIRST_DAY } from './dataset.mjs';
import { rows, exactlyOne } from './journal.mjs';

const named = (name) => ({ match: (row) => row.name === name });
const stablePut = (ctx, key, path, body) => ctx.write(key, 'PUT', path, body, { idempotent: true });

export async function seedCatalogue(ctx) {
  const refs = ctx.refs;
  for (const [key, value] of [
    ['company.vat_payer', true],
    ['company.city_tax_payer', false],
    ['tax.vat_rate_pct', '10'],
  ])
    await ctx.write(
      `catalogue/setting/${key}`,
      'POST',
      '/settings',
      { key, value, effectiveFrom: FIRST_DAY },
      {
        recover: async () =>
          exactlyOne(
            (await ctx.all('/settings'))
              .filter((r) => r.key === key)
              .flatMap((r) => r.entries ?? [])
              .filter((r) => r.effectiveFrom === FIRST_DAY && r.value === value),
            `setting/${key}`,
          ),
      },
    );
  refs.branch = await ctx.create(
    'catalogue/branch',
    '/branches',
    {
      code: 'QA-SIX',
      name: 'Хотын хүнсний худалдаа · туршилт',
      address: 'Улаанбаатар · зохиомол туршилтын байгууллага',
    },
    { match: (r) => r.code === 'QA-SIX' },
  );
  refs.warehouses = [];
  refs.bins = [];
  refs.floors = [];
  for (const [i, name, kind] of [
    [0, 'Хүнсний төв агуулах', 'WHOLESALE'],
    [1, 'Хөргүүртэй төв агуулах', 'WHOLESALE'],
    [2, 'Баянзүрх салбар дэлгүүр', 'STORE'],
    [3, 'Хан-Уул салбар дэлгүүр', 'STORE'],
  ]) {
    const code = `QA-W${i + 1}`;
    const warehouse = await ctx.create(
      `catalogue/warehouse/${i}`,
      '/warehouses',
      { code, name, kind, branchId: refs.branch.id },
      { match: (r) => r.code === code },
    );
    refs.warehouses.push(warehouse);
    const shelf = await ctx.create(
      `catalogue/bin/${i}`,
      '/bins',
      {
        warehouseId: warehouse.id,
        code: 'A-01',
        type: 'PICKING',
        name: i === 1 ? 'Хөргүүрийн үндсэн тавиур' : 'Үндсэн тавиур',
        pickSequence: 10,
      },
      { listPath: `/bins?warehouseId=${warehouse.id}`, match: (r) => r.code === 'A-01' },
    );
    refs.bins.push(shelf);
    const floor = rows(await ctx.get(`/bins?warehouseId=${warehouse.id}&limit=200`)).find(
      (r) => r.type === 'SALESFLOOR',
    );
    refs.floors.push(floor ?? shelf);
  }
  refs.categories = {};
  refs.supplierCategories = {};
  const families = new Map();
  for (const department of DEPARTMENTS) {
    if (!families.has(department.family))
      families.set(
        department.family,
        await ctx.create(
          `catalogue/family/${department.family}`,
          '/categories',
          { name: department.family },
          named(department.family),
        ),
      );
    refs.categories[department.key] = await ctx.create(
      `catalogue/category/${department.key}`,
      '/categories',
      { name: department.name, parentId: families.get(department.family).id },
      named(department.name),
    );
    refs.supplierCategories[department.key] = await ctx.create(
      `catalogue/supplier-category/${department.key}`,
      '/supplier-categories',
      { name: department.name },
      named(department.name),
    );
  }
  refs.suppliers = [];
  for (const supplier of SUPPLIERS) {
    const { index, department, ...body } = supplier;
    delete body.family;
    const saved = await ctx.create(
      `catalogue/supplier/${index}`,
      '/suppliers',
      { ...body, categoryId: refs.supplierCategories[department].id },
      { listPath: `/suppliers?q=${supplier.code}`, match: (r) => r.code === supplier.code },
    );
    refs.suppliers.push(saved);
    await stablePut(
      ctx,
      `catalogue/supplier-rule/${index}`,
      `/pricing/supplier-rules/${saved.id}`,
      {
        expectedVersion: 0,
        enabled: true,
        markupPct: String(12 + (index % 5) * 2),
        markupAmount: index % 4 === 0 ? '50' : '0',
        rounding: 'UP_10',
      },
    );
  }
  refs.customers = [];
  for (const customer of CUSTOMERS) {
    const { index, creditLimit, ...body } = customer;
    const saved = await ctx.create(`catalogue/customer/${index}`, '/customers', body, {
      listPath: `/customers?q=${customer.code}`,
      match: (r) => r.code === customer.code,
    });
    await stablePut(ctx, `catalogue/customer-credit/${index}`, `/customers/${saved.id}/credit`, {
      creditLimit,
      settlementGroup: body.settlementGroup,
      creditHold: false,
      creditHoldReason: null,
    });
    refs.customers.push(saved);
  }
  const uoms = rows(await ctx.get('/uoms'));
  const unit = (code) => {
    const found = uoms.find((r) => r.code === code);
    if (!found) throw new Error(`Missing seeded UOM ${code}`);
    return found;
  };
  refs.profile = await ctx.create(
    'catalogue/profile',
    '/price-profiles',
    {
      name: 'Хүнсний үндсэн үнэ',
      validFrom: FIRST_DAY,
      looseMarkupPct: '5',
      retailMarkupPct: '18',
      retailBulkMinQty: '12',
      retailBulkMarkupPct: '10',
      rounding: 'UP_10',
    },
    named('Хүнсний үндсэн үнэ'),
  );
  refs.products = [];
  for (const product of PRODUCTS) {
    const saved = await ctx.create(
      `catalogue/product/${product.index}`,
      '/products',
      {
        sku: product.sku,
        name: product.name,
        categoryId: refs.categories[product.department].id,
        vatType: 'VAT_ABLE',
        cityTax: false,
        weightKg: product.weightKg,
        baseUomId: unit(product.base).id,
        baseBarcodes: [product.barcode],
        units: [
          {
            uomId: unit('BOX').id,
            factorToBase: product.carton,
            isDefaultPurchase: true,
            barcodes: [product.boxBarcode],
          },
        ],
      },
      { listPath: `/products?q=${product.sku}`, match: (r) => r.sku === product.sku },
    );
    const detail = await ctx.get(`/products/${saved.id}`);
    const home = refs.warehouses[product.homeWarehouseIndex];
    const reference = {
      ...product,
      id: saved.id,
      baseUnitId: detail.units.find((u) => u.isBase).id,
      boxUnitId: detail.units.find((u) => u.uomId === unit('BOX').id).id,
      warehouseId: home.id,
      binId: refs.bins[product.homeWarehouseIndex].id,
    };
    refs.products.push(reference);
    await stablePut(ctx, `catalogue/home/${product.index}`, '/product-locations/home', {
      productId: saved.id,
      warehouseId: home.id,
    });
    for (const location of [product.homeWarehouseIndex, 2, 3])
      await stablePut(
        ctx,
        `catalogue/location/${product.index}/${location}`,
        '/product-locations',
        {
          productId: saved.id,
          warehouseId: refs.warehouses[location].id,
          defaultBinId: refs.bins[location].id,
          minQty: location < 2 ? '12' : '3',
          maxQty: location < 2 ? '120' : '24',
        },
      );
    for (const [label, supplierIndex] of [
      ['main', product.supplierIndex],
      ...(product.index % 3 === 0 ? [['alternate', product.alternateSupplierIndex]] : []),
    ]) {
      const supplierId = refs.suppliers[supplierIndex].id;
      await ctx.create(
        `catalogue/link/${product.index}/${label}`,
        '/product-suppliers',
        { productId: saved.id, supplierId },
        {
          listPath: `/product-suppliers?productId=${saved.id}`,
          match: (r) => r.productId === saved.id && (r.supplierId ?? r.supplier?.id) === supplierId,
        },
      );
    }
    await ctx.write(
      `catalogue/price/${product.index}`,
      'POST',
      '/product-prices',
      {
        productId: saved.id,
        validFrom: FIRST_DAY,
        warehousePrice: String(Math.ceil((Number(product.baseCost) * 1.18) / 10) * 10),
        profileId: refs.profile.id,
        wholeUomId: unit('BOX').id,
      },
      {
        idempotent: true,
        recover: async () => {
          const view = await ctx.get(`/product-prices?productId=${saved.id}`);
          return exactlyOne(
            [view.current, ...view.scheduled, ...view.history].filter(
              (r) => r?.validFrom === FIRST_DAY,
            ),
            `price/${product.index}`,
          );
        },
      },
    );
    if (product.index % 100 === 99)
      process.stdout.write(`Catalogue: ${product.index + 1}/500 products\n`);
  }
  for (let i = 0; i < 4; i++)
    await stablePut(
      ctx,
      `catalogue/location-rule/${i}`,
      `/pricing/location-rules/${refs.warehouses[i].id}`,
      {
        expectedVersion: 0,
        enabled: true,
        priceType: i < 2 ? 'BASE' : 'ADDITIONAL',
        markupPct: i < 2 ? '0' : String(16 + (i - 2) * 3),
        markupAmount: '0',
        rounding: 'UP_10',
      },
    );
  for (let i = 0; i < 500; i += 100)
    await ctx.write(
      `catalogue/sale-ready/${i}`,
      'POST',
      '/pricing/sale-ready',
      { productIds: refs.products.slice(i, i + 100).map((p) => p.id) },
      { idempotent: true },
    );
  await seedFinanceAndSales(ctx);
  await ctx.save();
}

async function seedFinanceAndSales(ctx) {
  const refs = ctx.refs;
  refs.accounts = {};
  for (const [key, code, name, kind, journal] of [
    ['cash', 'QA-CASH', 'Төв касс · туршилт', 'ASSET', 'CASH'],
    ['bank', 'QA-BANK', 'Банкны харилцах · туршилт', 'ASSET', 'BANK'],
    ['capital', 'QA-CAPITAL', 'Эзэмшигчийн хөрөнгө · туршилт', 'EQUITY', 'GENERAL'],
    ['rent', 'QA-RENT', 'Түрээсийн зардал', 'EXPENSE', 'GENERAL'],
    ['wages', 'QA-WAGES', 'Цалингийн зардал · сар тутмын ерөнхий гүйлгээ', 'EXPENSE', 'GENERAL'],
    ['utilities', 'QA-UTILITIES', 'Цахилгаан дулааны зардал', 'EXPENSE', 'GENERAL'],
    ['delivery', 'QA-DELIVERY', 'Тээврийн зардал', 'EXPENSE', 'GENERAL'],
    ['supplies', 'QA-SUPPLIES', 'Аж ахуйн хэрэглээний зардал', 'EXPENSE', 'GENERAL'],
  ])
    refs.accounts[key] = await ctx.create(
      `catalogue/account/${key}`,
      '/gl-accounts',
      { code, name, kind, journal, currency: 'MNT' },
      { match: (r) => r.code === code },
    );
  const money = rows(await ctx.get('/money-accounts'));
  refs.money = Object.fromEntries(
    ['cash', 'bank'].map((key) => [
      key,
      money.find((r) => r.glAccountId === refs.accounts[key].id),
    ]),
  );
  if (!refs.money.cash || !refs.money.bank)
    throw new Error('Normal CASH/BANK account creation did not create money accounts');
  refs.accountRoles = Object.fromEntries(
    rows(await ctx.get('/gl-accounts'))
      .filter((r) => r.role)
      .map((r) => [r.role, r]),
  );
  refs.board = await ctx.create(
    'catalogue/board',
    '/sales-boards',
    { name: 'Бөөний борлуулалт', branchId: refs.branch.id },
    named('Бөөний борлуулалт'),
  );
  refs.pipeline = await ctx.write(
    'catalogue/pipeline',
    'POST',
    '/sales-pipelines',
    {
      boardId: refs.board.id,
      name: 'Захиалгаас борлуулалт',
      visibility: 'PUBLIC',
      ownOrdersOnly: false,
      kind: 'SALES',
      roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
      stages: [
        ['Шинэ захиалга', 'NONE'],
        ['Баталгаажуулах', 'CONFIRM'],
        ['Бэлтгэх', 'PICK'],
        ['Борлуулсан', 'SALE'],
        ['Цуцлах', 'CANCEL'],
      ].map(([name, action]) => ({
        name,
        action,
        printPickList: false,
        printDeliveryNote: false,
        ebarimt: false,
        roles: { VIEW: [], EDIT: [], MOVE: [] },
      })),
    },
    {
      recover: async () =>
        exactlyOne(
          rows(await ctx.get('/sales-boards'))
            .flatMap((b) => b.pipelines ?? [])
            .filter((p) => p.boardId === refs.board.id && p.name === 'Захиалгаас борлуулалт'),
          'catalogue/pipeline',
        ),
    },
  );
  refs.pipeline = await ctx.get(`/sales-pipelines/${refs.pipeline.id}`);
  refs.edge = await ctx.create(
    'catalogue/edge',
    '/pos/edge-nodes',
    { code: 'QA-SIX', name: 'Туршилтын хоёр салбарын POS' },
    { match: (r) => r.code === 'QA-SIX' },
  );
  refs.tills = [];
  for (const i of [2, 3])
    refs.tills.push(
      await ctx.create(
        `catalogue/till/${i}`,
        '/pos/tills',
        {
          edgeNodeId: refs.edge.id,
          warehouseId: refs.warehouses[i].id,
          code: `QA${i - 1}`,
          name: `${refs.warehouses[i].name} касс`,
          printerHost: null,
        },
        { match: (r) => r.code === `QA${i - 1}` },
      ),
    );
  await stablePut(ctx, 'catalogue/cashier', `/pos/cashiers/${refs.admin.id}/pin`, {
    pin: '827416',
    tillIds: refs.tills.map((t) => t.id),
  });
}
