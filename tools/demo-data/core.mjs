import { departments, products, suppliers, customers } from './dataset.mjs';

/** Public REST routes only; all domain numbers remain decimal strings. */
export async function seedCore(ctx) {
  const { Decimal } = ctx.shared.money;
  const refs = ctx.refs;
  const named = (name) => ({ match: (row) => row.name === name });
  refs.branch = await ctx.create(
    'core/branch',
    '/branches',
    {
      code: 'DEMO',
      name: 'DEMO Мөрөн бөөний төв',
      address: 'DEMO: зохиомол салбар, бодит хүргэлт хийхгүй',
    },
    { match: (row) => row.code === 'DEMO' && row.name === 'DEMO Мөрөн бөөний төв' },
  );
  refs.warehouses = [];
  refs.bins = [];
  for (const [index, name, kind] of [
    [0, 'Хүнсний төв агуулах', 'WHOLESALE'],
    [1, 'Хуурай хүнс, ахуйн агуулах', 'WHOLESALE'],
    [2, 'Супермаркет', 'STORE'],
  ]) {
    const code = `DEMO-W${index + 1}`;
    const warehouse = await ctx.create(
      `core/warehouse/${index}`,
      '/warehouses',
      {
        code,
        name: `DEMO ${name}`,
        kind,
        branchId: refs.branch.id,
      },
      { match: (row) => row.code === code && row.name === `DEMO ${name}` },
    );
    refs.warehouses.push(warehouse);
    for (let shelf = 1; shelf <= 2; shelf += 1) {
      const binCode = `DEMO-A-0${shelf}`;
      refs.bins.push(
        await ctx.create(
          `core/bin/${index}/${shelf}`,
          '/bins',
          {
            warehouseId: warehouse.id,
            code: binCode,
            type: 'PICKING',
            name: `DEMO ${shelf}-р тавиур`,
            pickSequence: shelf * 10,
          },
          { listPath: `/bins?warehouseId=${warehouse.id}`, match: (row) => row.code === binCode },
        ),
      );
    }
  }
  const categoryRoot = await ctx.create(
    'core/category/root',
    '/categories',
    {
      name: 'DEMO Бөөний бараа',
      iconKey: 'assorted',
    },
    named('DEMO Бөөний бараа'),
  );
  const categories = new Map();
  for (const [key, name, iconKey, children] of departments) {
    const department = await ctx.create(
      `core/category/${key}`,
      '/categories',
      {
        name: `DEMO ${name}`,
        parentId: categoryRoot.id,
        iconKey,
      },
      { match: (row) => row.name === `DEMO ${name}` && row.parentId === categoryRoot.id },
    );
    for (const [childKey, childName] of children) {
      categories.set(
        childKey,
        await ctx.create(
          `core/category/${childKey}`,
          '/categories',
          {
            name: `DEMO ${childName}`,
            parentId: department.id,
          },
          { match: (row) => row.name === `DEMO ${childName}` && row.parentId === department.id },
        ),
      );
    }
  }
  const supplierRoot = await ctx.create(
    'core/supplier-category/root',
    '/supplier-categories',
    {
      name: 'DEMO Нийлүүлэлтийн сүлжээ',
    },
    named('DEMO Нийлүүлэлтийн сүлжээ'),
  );
  const supplierCategories = [];
  for (const [index, [key, name]] of departments.entries()) {
    const parent = await ctx.create(
      `core/supplier-category/${key}`,
      '/supplier-categories',
      {
        name: `DEMO ${name}`,
        parentId: supplierRoot.id,
      },
      named(`DEMO ${name}`),
    );
    for (const [child, suffix] of ['Үйлдвэрлэгч', 'Импортлогч'].entries()) {
      const childName = `DEMO ${index + 1}. ${suffix}`;
      supplierCategories.push(
        await ctx.create(
          `core/supplier-category/${key}/${child}`,
          '/supplier-categories',
          {
            name: childName,
            parentId: parent.id,
          },
          named(childName),
        ),
      );
    }
  }
  refs.suppliers = [];
  for (const supplier of suppliers) {
    const { index, ...body } = supplier;
    refs.suppliers.push(
      await ctx.create(
        `core/supplier/${index}`,
        '/suppliers',
        {
          ...body,
          categoryId: supplierCategories[Math.floor(index / 3) * 2 + (index % 2)].id,
        },
        {
          listPath: `/suppliers?q=${supplier.code}`,
          match: (row) => row.code === supplier.code && row.name === supplier.name,
        },
      ),
    );
  }
  const customerCategories = [];
  for (const [index, name] of [
    'Жижиглэн дэлгүүр',
    'Кафе, хоолны газар',
    'Орон нутгийн дэлгүүр',
  ].entries()) {
    customerCategories.push(
      await ctx.create(
        `core/customer-category/${index}`,
        '/customer-categories',
        {
          name: `DEMO ${name}`,
          sortOrder: index,
        },
        named(`DEMO ${name}`),
      ),
    );
  }
  refs.customers = [];
  for (const customer of customers) {
    const { index, ...body } = customer;
    const created = await ctx.create(
      `core/customer/${index}`,
      '/customers',
      {
        ...body,
        categoryId: customerCategories[index % 3].id,
      },
      {
        listPath: `/customers?q=${customer.code}`,
        match: (row) => row.code === customer.code && row.name === customer.name,
      },
    );
    refs.customers.push(await ctx.api.get(`/customers/${created.id}`));
  }
  const uoms = await ctx.all('/uoms');
  const units = new Map(uoms.map((row) => [row.code, row]));
  for (const code of ['PCS', 'KG', 'BOX'])
    if (!units.has(code))
      throw new Error(`Missing system unit ${code}; start the development API first`);
  refs.products = [];
  for (const product of products) {
    const barcodeBody = `299900${String(product.index + 1).padStart(6, '0')}`;
    const packBarcodeBody = `299901${String(product.index + 1).padStart(6, '0')}`;
    const barcode = `${barcodeBody}${ctx.shared.gtin.gtinCheckDigit(barcodeBody)}`;
    const packBarcode = `${packBarcodeBody}${ctx.shared.gtin.gtinCheckDigit(packBarcodeBody)}`;
    if (
      !ctx.shared.catalog.SKU_PATTERN.test(product.sku) ||
      !ctx.shared.units.FACTOR_PATTERN.test(product.carton)
    )
      throw new Error(`Invalid dataset product ${product.index}`);
    const created = await ctx.create(
      `core/product/${product.index}`,
      '/products',
      {
        sku: product.sku,
        name: product.name,
        categoryId: categories.get(product.category).id,
        vatType: 'VAT_ABLE',
        cityTax: false,
        weightKg: product.weightKg,
        baseUomId: units.get(product.base).id,
        baseBarcodes: [barcode],
        units: [
          {
            uomId: units.get('BOX').id,
            factorToBase: product.carton,
            isDefaultPurchase: true,
            barcodes: [packBarcode],
          },
        ],
      },
      {
        listPath: `/products?q=${product.sku}`,
        match: (row) => row.sku === product.sku && row.name === product.name,
      },
    );
    const detail = await ctx.api.get(`/products/${created.id}`);
    const warehouse = refs.warehouses[product.warehouseIndex];
    const bin = refs.bins[product.warehouseIndex * 2 + (product.index % 2)];
    const demo = {
      ...product,
      warehouseId: warehouse.id,
      baseUnitId: detail.units.find((unit) => unit.isBase).id,
      packUnitId: detail.units.find((unit) => unit.uomId === units.get('BOX').id).id,
    };
    refs.products.push({ ...detail, demo });
    await ctx.mutate(`core/home/${product.index}`, 'PUT', '/product-locations/home', {
      productId: created.id,
      warehouseId: warehouse.id,
    });
    await ctx.mutate(`core/location/${product.index}`, 'PUT', '/product-locations', {
      productId: created.id,
      warehouseId: warehouse.id,
      defaultBinId: bin.id,
      minQty: product.base === 'KG' ? '20' : new Decimal(product.carton).times('2').toFixed(3),
      maxQty: product.base === 'KG' ? '500' : new Decimal(product.carton).times('40').toFixed(3),
    });
    for (const [role, supplierIndex] of [
      ['primary', product.supplierIndex],
      ...(product.index % 2 === 0
        ? [['secondary', (product.supplierIndex + 5) % suppliers.length]]
        : []),
    ]) {
      const supplierId = refs.suppliers[supplierIndex].id;
      await ctx.create(
        `core/link/${product.index}/${role}`,
        '/product-suppliers',
        {
          productId: created.id,
          supplierId,
        },
        {
          listPath: `/product-suppliers?productId=${created.id}`,
          match: (row) => row.productId === created.id && row.supplier.id === supplierId,
        },
      );
    }
  }
  refs.priceProfiles = [];
  for (const [index, name, looseMarkupPct, retailMarkupPct] of [
    [0, 'Хүнсний үндсэн', '10', '22'],
    [1, 'Ундаа, амттан', '12', '28'],
    [2, 'Ахуйн хэрэглээ', '15', '32'],
  ]) {
    refs.priceProfiles.push(
      await ctx.create(
        `core/profile/${index}`,
        '/price-profiles',
        {
          name: `DEMO ${name}`,
          validFrom: ctx.today,
          looseMarkupPct,
          retailMarkupPct,
          retailBulkMinQty: '12',
          retailBulkMarkupPct: '18',
          rounding: 'UP_10',
        },
        named(`DEMO ${name}`),
      ),
    );
  }
  const ready = refs.products.filter((product) => product.demo.stage === 'READY');
  for (const product of ready) {
    await ctx.mutate(`core/price/${product.demo.index}`, 'POST', '/product-prices', {
      productId: product.id,
      validFrom: ctx.today,
      warehousePrice: product.demo.warehousePrice,
      profileId:
        refs.priceProfiles[product.demo.index < 18 ? 0 : product.demo.index < 54 ? 1 : 2].id,
      wholeUomId: units.get('BOX').id,
    });
  }
  await ctx.mutate('core/sale-ready', 'POST', '/pricing/sale-ready', {
    productIds: ready.map((product) => product.id),
  });
  refs.receipts = [];
  for (const supplier of suppliers) {
    const ownProducts = refs.products.filter(
      (product) => product.demo.supplierIndex === supplier.index && product.demo.stock !== 'ZERO',
    );
    const lines = ownProducts.map((product) => ({
      productUnitId: product.demo.baseUnitId,
      enteredQty:
        product.demo.stock === 'LOW'
          ? product.demo.base === 'KG'
            ? '2.500'
            : '2'
          : product.demo.base === 'KG'
            ? '180.500'
            : new Decimal(product.demo.carton)
                .times(String(8 + (product.demo.index % 5)))
                .toFixed(3),
      docUnitPrice: product.demo.cost,
    }));
    if (!lines.length) continue;
    const docNo = `DEMO-GR-${String(supplier.index + 1).padStart(3, '0')}`;
    const receipt = await ctx.create(
      `core/receipt/${supplier.index}`,
      '/receipts',
      {
        supplierId: refs.suppliers[supplier.index].id,
        supplierDocNo: docNo,
        supplierDocDate: ctx.today,
        paymentMethod: 'CREDIT',
        note: `DEMO: зохиомол эхний нөөц, ${supplier.name}`,
        noteTotalQty: lines
          .reduce((sum, line) => sum.plus(line.enteredQty), new Decimal(0))
          .toFixed(3),
        noteTotalAmount: lines
          .reduce(
            (sum, line) => sum.plus(new Decimal(line.enteredQty).times(line.docUnitPrice)),
            new Decimal(0),
          )
          .toFixed(2),
        lines,
      },
      {
        listPath: `/receipts?supplierId=${refs.suppliers[supplier.index].id}`,
        match: (row) => row.supplierDocNo === docNo,
      },
    );
    let detail = await ctx.api.get(`/receipts/${receipt.id}`);
    if (detail.status === 'DRAFT')
      detail = await ctx.mutate(
        `core/receipt-post/${supplier.index}`,
        'POST',
        `/receipts/${receipt.id}/post`,
      );
    if (detail.status !== 'POSTED')
      throw new Error(`DEMO receipt ${receipt.id} is ${detail.status}; refusing to alter it`);
    if (detail.costingStatus !== 'COSTED') {
      const byProductId = new Map(ownProducts.map((product) => [product.id, product]));
      await ctx.mutate(
        `core/receipt-cost/${supplier.index}`,
        'PUT',
        `/receipts/${receipt.id}/costs`,
        {
          costingVersion: detail.costingVersion,
          lines: detail.lines.map((line) => ({
            lineId: line.id,
            unitPrice: byProductId.get(line.productId).demo.cost,
          })),
        },
      );
    }
    refs.receipts.push(await ctx.api.get(`/receipts/${receipt.id}`));
  }
  for (const product of refs.products.filter((product) => product.demo.stage === 'INACTIVE')) {
    await ctx.mutate(`core/inactivate/${product.demo.index}`, 'PATCH', `/products/${product.id}`, {
      status: 'INACTIVE',
    });
  }
  ctx.log(
    'Core complete: 72 products, 24 suppliers, 18 customers, 24 posted/costed credit receipts.',
  );
  return refs;
}
