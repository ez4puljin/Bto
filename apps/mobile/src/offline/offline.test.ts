import { Decimal } from '@tugeel/shared/money';
import { unitPriceOf } from '@tugeel/shared/pricing';
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, type ShopQuery } from '../shop/filters';
import { estimateLine, estimateQuote, unpricedCount } from './estimate';
import {
  keptBarcode,
  keptCategoryPage,
  keptCategoryTiles,
  keptCustomer,
  keptCustomerPage,
  keptProductPage,
  keptProducts,
  keptProductsOf,
} from './query';
import { KeptStore } from './store';
import {
  type KeptCategory,
  type KeptCustomer,
  type KeptData,
  type KeptDisk,
  type KeptPointer,
  type KeptProduct,
  type KeptSource,
  readKept,
  refreshKept,
} from './walk';

const unit = (
  id: number,
  factor: string,
  extra: Partial<KeptProduct['units'][number]> = {},
): KeptProduct['units'][number] => ({
  id,
  uomName: factor === '1' ? 'ш' : 'хайрцаг',
  uomCode: factor === '1' ? 'PCS' : 'BOX',
  factorToBase: factor,
  isBase: factor === '1',
  isDefaultSales: factor === '1',
  barcodes: [],
  wholesale: null,
  basis: factor === '1' ? 'LOOSE' : 'WAREHOUSE',
  ...extra,
});

const product = (id: number, extra: Partial<KeptProduct> = {}): KeptProduct => ({
  id,
  sku: `S${id}`,
  name: `Бараа ${id}`,
  categoryId: 1,
  thumbUrl: null,
  images: [],
  isNew: false,
  sellable: true,
  homeWarehouseId: 1,
  available: '10',
  stockBlocked: false,
  basePrice: '1000',
  basePriceBefore: null,
  dealPrice: null,
  deal: null,
  units: [unit(id * 10, '1', { wholesale: '1100' })],
  mainSupplierId: null,
  ...extra,
});

const customer = (id: number, extra: Partial<KeptCustomer> = {}): KeptCustomer => ({
  id,
  code: `C${id}`,
  name: `Дэлгүүр ${id}`,
  phone: null,
  address: null,
  addresses: [],
  contacts: [],
  overdue: null,
  creditHold: false,
  ...extra,
});

const category = (id: number, parentId: number | null, name: string): KeptCategory => ({
  id,
  parentId,
  name,
  defaultClassificationCode: null,
  skuFrom: null,
  skuTo: null,
  productCount: 0,
  childCount: 0,
  imageUrl: null,
  iconKey: null,
});

const CONTEXT = {
  today: '2026-11-19',
  boards: [],
  defaultStageId: null,
  warehouses: [],
  branchNames: [],
  appName: null,
  appColor: null,
};

const dataOf = (products: KeptProduct[], customers: KeptCustomer[] = []): KeptData => ({
  at: '2026-11-19T03:00:00.000Z',
  products,
  customers,
  context: CONTEXT,
  categories: [
    category(1, null, 'Хүнс'),
    category(2, 1, 'Сүү'),
    category(3, 2, 'Тараг'),
    category(4, null, 'Ахуй'),
  ],
  suppliers: [],
});

const query = (patch: Partial<ShopQuery> = {}): ShopQuery => ({
  ...EMPTY_FILTERS,
  q: '',
  ...patch,
});

/** A disk in memory; `failWrites` after N writes, `log` of every call. */
let disks = 0;

class MemoryDisk implements KeptDisk {
  /** One walk at a time per id: two stores of one user share it. */
  readonly id: string;
  files = new Map<string, string>();
  pointer: KeptPointer | null = null;
  removed: string[] = [];
  failAfter = Infinity;
  failPointer = false;
  writes = 0;
  constructor(id = `disk-${(disks += 1)}`) {
    this.id = id;
  }
  loadPointer = () => Promise.resolve(this.pointer);
  savePointer = (pointer: KeptPointer) => {
    if (this.failPointer) return Promise.reject(new Error('pointer not stored'));
    this.pointer = pointer;
    return Promise.resolve();
  };
  write = (gen: string, name: string, text: string) => {
    this.writes += 1;
    if (this.writes > this.failAfter) return Promise.reject(new Error('disk full'));
    this.files.set(`${gen}/${name}`, text);
    return Promise.resolve();
  };
  read = (gen: string, name: string) => {
    const text = this.files.get(`${gen}/${name}`);
    return text === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(text);
  };
  gens = () =>
    Promise.resolve([...new Set([...this.files.keys()].map((key) => key.split('/')[0] ?? ''))]);
  removeGen = (gen: string) => {
    this.removed.push(gen);
    for (const key of [...this.files.keys()]) if (key.startsWith(`${gen}/`)) this.files.delete(key);
    return Promise.resolve();
  };
}

/** A server of `pages` product pages; counts how many calls run at once. */
function sourceOf(pages: KeptProduct[][], options: { failAt?: number } = {}) {
  let open = 0;
  let most = 0;
  let calls = 0;
  const call = async <T>(make: () => T): Promise<T> => {
    open += 1;
    most = Math.max(most, open);
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 1));
    open -= 1;
    if (options.failAt !== undefined && calls === options.failAt) throw new TypeError('Network');
    return make();
  };
  const source: KeptSource = {
    products: (cursor) =>
      call(() => {
        const at = cursor === null ? 0 : Number.parseInt(cursor, 10);
        return { data: pages[at] ?? [], nextCursor: at + 1 < pages.length ? String(at + 1) : null };
      }),
    customers: () => call(() => ({ data: [customer(1)], nextCursor: null })),
    context: () => call(() => CONTEXT),
    categories: () => call(() => dataOf([]).categories),
    suppliers: () => call(() => []),
  };
  return { source, most: () => most, calls: () => calls };
}

let gens = 0;
const options = {
  now: () => new Date('2026-11-19T03:00:00.000Z'),
  newGen: () => `g${(gens += 1)}`,
};

describe('the kept copy: the walk and the swap (ADR-0225 #2)', () => {
  it('walks every page one after another and swaps the copy in when the whole walk is in', async () => {
    const disk = new MemoryDisk();
    const { source, most } = sourceOf([[product(1), product(2)], [product(3)]]);
    const pointer = await refreshKept(source, disk, options);
    expect(most()).toBe(1);
    expect(pointer).toMatchObject({ products: 3, customers: 1, productFiles: 2, customerFiles: 1 });
    expect(disk.pointer).toEqual(pointer);
    const data = await readKept(disk, pointer);
    expect(data.products.map((one) => one.id)).toEqual([1, 2, 3]);
    expect(data.customers.map((one) => one.id)).toEqual([1]);

    // The next walk replaces it and removes the old folder.
    const next = await refreshKept(sourceOf([[product(4)]]).source, disk, options);
    expect(disk.pointer?.gen).toBe(next.gen);
    expect(disk.removed).toContain(pointer.gen);
  });

  it('a walk that fails keeps the copy in use untouched and removes its own files', async () => {
    const disk = new MemoryDisk();
    const first = await refreshKept(sourceOf([[product(1)]]).source, disk, options);
    // The second page's call gets no answer.
    await expect(
      refreshKept(sourceOf([[product(5)], [product(6)]], { failAt: 2 }).source, disk, options),
    ).rejects.toThrow();
    expect(disk.pointer).toEqual(first);
    expect((await readKept(disk, first)).products.map((one) => one.id)).toEqual([1]);
    expect([...disk.files.keys()].every((key) => key.startsWith(`${first.gen}/`))).toBe(true);

    // A full disk too.
    disk.failAfter = disk.writes + 1;
    await expect(
      refreshKept(sourceOf([[product(7)], [product(8)]]).source, disk, options),
    ).rejects.toThrow('disk full');
    expect(disk.pointer).toEqual(first);
  });

  it('reads nothing at start, the data on first need, and keeps the old copy when a refresh fails', async () => {
    const disk = new MemoryDisk();
    const store = new KeptStore(disk, sourceOf([[product(1)]]).source, options);
    await store.ready;
    expect(store.getSnapshot().pointer).toBeNull();
    expect(store.isStale()).toBe(true);
    expect(await store.data()).toBeNull();
    expect(await store.refresh()).toBe(true);
    expect((await store.data())?.products).toHaveLength(1);
    expect(store.isStale()).toBe(false);

    const failing = new KeptStore(disk, sourceOf([[product(9)]], { failAt: 1 }).source, options);
    await failing.ready;
    expect(await failing.refresh()).toBe(false);
    expect(failing.getSnapshot()).toMatchObject({ failed: true, progress: null });
    expect((await failing.data())?.products.map((one) => one.id)).toEqual([1]);
  });
});

describe('the kept copy: two walks, a store that is gone, a failed swap (review 2026-11-20)', () => {
  it('a pointer that cannot be stored keeps the old copy, and the new folder goes', async () => {
    const disk = new MemoryDisk();
    const first = await refreshKept(sourceOf([[product(1)]]).source, disk, options);
    disk.failPointer = true;
    await expect(refreshKept(sourceOf([[product(2)]]).source, disk, options)).rejects.toThrow(
      'pointer not stored',
    );
    expect(disk.pointer).toEqual(first);
    expect((await readKept(disk, first)).products.map((one) => one.id)).toEqual([1]);
    expect([...disk.files.keys()].every((key) => key.startsWith(`${first.gen}/`))).toBe(true);
  });

  it('two stores of one user walk once at a time: the second waits and takes the copy', async () => {
    // Two stores over the same files (a sign-out and in again as the same user).
    const shared = new MemoryDisk('server:7');
    const first = sourceOf([[product(1)], [product(2)]]);
    const second = sourceOf([[product(3)]]);
    const a = new KeptStore(shared, first.source, options);
    const b = new KeptStore(shared, second.source, options);
    await Promise.all([a.ready, b.ready]);
    const [ra, rb] = await Promise.all([a.refresh(), b.refresh()]);
    expect([ra, rb]).toEqual([true, true]);
    // B never walked: it took A's copy.
    expect(second.calls()).toBe(0);
    expect(b.getSnapshot().pointer).toEqual(shared.pointer);
    const kept = await b.data();
    expect(kept?.products.map((one) => one.id)).toEqual([1, 2]);
    expect(new Set([...shared.files.keys()].map((key) => key.split('/')[0]))).toEqual(
      new Set([shared.pointer?.gen]),
    );
  });

  it('a walk whose store is gone stops, never moves the pointer and removes its folder', async () => {
    const disk = new MemoryDisk();
    const first = await refreshKept(sourceOf([[product(1)]]).source, disk, options);
    const slow = sourceOf([[product(5)], [product(6)], [product(7)]]);
    const store = new KeptStore(disk, slow.source, options);
    await store.ready;
    const walking = store.refresh();
    await new Promise((resolve) => setTimeout(resolve, 2));
    store.dispose();
    expect(await walking).toBe(false);
    expect(disk.pointer).toEqual(first);
    expect([...disk.files.keys()].every((key) => key.startsWith(`${first.gen}/`))).toBe(true);
    // A disposed store starts nothing.
    expect(await store.refresh()).toBe(false);
  });

  it('a copy whose files went missing is checked before the swap and never used', async () => {
    const disk = new MemoryDisk();
    const first = await refreshKept(sourceOf([[product(1)]]).source, disk, options);
    // Another hand removes the new folder's first page while the walk writes the rest.
    const { source } = sourceOf([[product(2)], [product(3)]]);
    const original = source.customers;
    source.customers = (cursor) => {
      for (const key of [...disk.files.keys()]) {
        if (key.endsWith('/p-0.json') && !key.startsWith(first.gen)) disk.files.delete(key);
      }
      return original(cursor);
    };
    await expect(refreshKept(source, disk, options)).rejects.toThrow('missing');
    expect(disk.pointer).toEqual(first);
    expect([...disk.files.keys()].every((key) => key.startsWith(`${first.gen}/`))).toBe(true);
  });

  it('an unreadable copy counts as stale, so the next moment online downloads again', async () => {
    const disk = new MemoryDisk();
    const store = new KeptStore(disk, sourceOf([[product(1)]]).source, options);
    await store.ready;
    await store.refresh();
    expect(store.isStale()).toBe(false);
    for (const key of [...disk.files.keys()]) if (key.endsWith('p-0.json')) disk.files.delete(key);
    const fresh = new KeptStore(disk, sourceOf([[product(1)]]).source, options);
    await fresh.ready;
    expect(await fresh.data()).toBeNull();
    expect(fresh.isStale()).toBe(true);
  });
});

describe('the shop over the kept copy', () => {
  const products = [
    product(1, {
      name: 'Сүү Сэнгүр 1л',
      sku: '10001',
      categoryId: 2,
      isNew: true,
      basePrice: '3000',
    }),
    product(2, { name: 'Тараг жимстэй', sku: '10002', categoryId: 3, basePrice: '1500' }),
    product(3, {
      name: 'Угаалгын нунтаг',
      sku: '20001',
      categoryId: 4,
      available: '0',
      mainSupplierId: 7,
      basePrice: null,
      units: [unit(30, '1', { barcodes: ['4006381333931'] })],
    }),
    product(4, {
      name: 'Сүүтэй цай',
      sku: '30004',
      categoryId: 2,
      stockBlocked: true,
      available: '0',
    }),
  ];
  const data = dataOf(products);
  const ids = (q: ShopQuery) => keptProducts(data, q).map((one) => one.id);

  it('searches the name with the server’s keys, and the sku and a barcode exactly first', () => {
    expect(ids(query({ q: 'сүү' }))).toEqual(expect.arrayContaining([1, 4]));
    expect(ids(query({ q: 'сүү' }))).not.toContain(2);
    expect(ids(query({ q: 'ТАРАГ жимс' }))).toEqual([2]);
    expect(ids(query({ q: '10002' }))).toEqual([2]);
    // A sku prefix.
    expect(ids(query({ q: '1000' }))).toEqual(expect.arrayContaining([1, 2]));
    expect(ids(query({ q: '4006381333931' }))).toEqual([3]);
  });

  it('filters a category with its subcategories, a supplier, and the last known stock', () => {
    expect(ids(query({ categoryIds: [1] }))).toEqual(expect.arrayContaining([1, 2, 4]));
    expect(ids(query({ categoryIds: [1] }))).not.toContain(3);
    expect(ids(query({ categoryIds: [2] })).sort()).toEqual([1, 2, 4]);
    expect(ids(query({ supplierIds: [7] }))).toEqual([3]);
    expect(ids(query({ inStock: true })).sort()).toEqual([1, 2]);
  });

  it('sorts new first, or by price with the unpriced last, and pages with a total', () => {
    expect(ids(query())[0]).toBe(1);
    expect(ids(query({ sort: 'PRICE_ASC' }))).toEqual([4, 2, 1, 3]);
    expect(ids(query({ sort: 'PRICE_DESC' }))).toEqual([1, 2, 4, 3]);
    const first = keptProductPage(data, query(), null, 3);
    expect(first).toMatchObject({ total: 4, nextCursor: '3' });
    expect(first.data).toHaveLength(3);
    expect(keptProductPage(data, query(), '3', 3)).toMatchObject({ total: null, nextCursor: null });
    expect(keptProductsOf(data, [3, 99, 1]).map((one) => one.id)).toEqual([3, 1]);
  });

  it('finds a scanned code by the server’s lookup keys (a UPC-A read of an EAN-13 too)', () => {
    const withUpc = dataOf([
      product(5, { units: [unit(50, '1'), unit(51, '12', { barcodes: ['0012345678905'] })] }),
      ...products,
    ]);
    expect(keptBarcode(withUpc, '4006381333931')).toEqual({ productId: 3, unitId: 30 });
    expect(keptBarcode(withUpc, '012345678905')).toEqual({ productId: 5, unitId: 51 });
    expect(keptBarcode(withUpc, '9999999999994')).toBeNull();
  });

  it('lists the categories and a category’s page from the kept copy', () => {
    expect(keptCategoryTiles(data).map((one) => [one.name, one.productCount])).toEqual([
      ['Ахуй', 1],
      ['Хүнс', 3],
    ]);
    const page = keptCategoryPage(data, 1);
    expect(page).toMatchObject({ productCount: 3, banners: [], sections: [] });
    expect(page?.subcategories.map((one) => one.id)).toEqual([2]);
    expect(keptCategoryPage(data, 99)).toBeNull();
  });
});

describe('the store picker over the kept copy', () => {
  const data = dataOf(
    [],
    [
      customer(1, { name: 'Номин дэлгүүр', code: 'C001', phone: '+97699112233' }),
      customer(2, {
        name: 'Алтан гадас',
        code: 'C002',
        creditHold: true,
        addresses: [{ id: 9, label: 'Гол', address: 'Мөрөн', isDefault: true }],
        contacts: [{ name: 'Бат', phone: '99001122' }],
      }),
    ],
  );

  it('searches the name, the code and the phone, by name', () => {
    expect(keptCustomerPage(data, '', null, 30).data.map((one) => one.id)).toEqual([2, 1]);
    expect(keptCustomerPage(data, 'номин', null, 30).data.map((one) => one.id)).toEqual([1]);
    expect(keptCustomerPage(data, 'C002', null, 30).data.map((one) => one.id)).toEqual([2]);
    expect(keptCustomerPage(data, '9911', null, 30).data.map((one) => one.id)).toEqual([1]);
  });

  it('gives the addresses, the contacts and the credit facts for the checkout', () => {
    expect(keptCustomer(data, 2)).toMatchObject({
      creditHold: true,
      addresses: [{ id: 9, isDefault: true }],
      contacts: [{ name: 'Бат' }],
    });
    expect(keptCustomer(data, 3)).toBeNull();
  });
});

describe('the estimate (ADR-0225 #4)', () => {
  // A box of 24 at the warehouse price, a loose piece at the WHOLESALE loose price.
  const boxed = product(6, {
    basePrice: '1000',
    units: [
      unit(60, '1', { wholesale: '1100', basis: 'LOOSE' }),
      unit(61, '24', { wholesale: '24000', basis: 'WAREHOUSE' }),
    ],
  });

  it('prices a pack unit at the warehouse price per base unit times the pack', () => {
    const line = estimateLine(boxed, 61, '2');
    expect(line).toMatchObject({ priced: true, total: '48000.00' });
    expect(line?.parts[0]).toMatchObject({
      basis: 'WAREHOUSE',
      unitPrice: unitPriceOf(new Decimal('1000'), new Decimal('24')).toFixed(0),
    });
  });

  it('splits pieces into whole packs and the loose rest as the server does', () => {
    const line = estimateLine(boxed, 60, '25');
    expect(line?.parts.map((part) => [part.basis, part.qty, part.unitPrice])).toEqual([
      ['WAREHOUSE', '1', '24000'],
      ['LOOSE', '1', '1100'],
    ]);
    expect(line?.total).toBe('25100.00');
  });

  it('takes the deal price for the packs and says what it took off', () => {
    const line = estimateLine({ ...boxed, dealPrice: '900' }, 61, '1');
    expect(line).toMatchObject({
      total: '21600.00',
      subtotal: '24000.00',
      discountAmount: '2400.00',
    });
  });

  it('marks a line without a kept price unpriced, and sums the cart as an estimate', () => {
    const quote = estimateQuote(
      [boxed, product(7, { basePrice: null, units: [unit(70, '1')] })],
      [
        { productUnitId: 61, qty: '1' },
        { productUnitId: 70, qty: '3' },
        { productUnitId: 999, qty: '1' },
      ],
      '2026-11-19',
    );
    expect(quote.estimated).toBe(true);
    expect(quote.lines.map((line) => line.priced)).toEqual([true, false, false]);
    expect(quote.total).toBe('24000.00');
    // The total leaves the unpriced lines out: the screens say how many.
    expect(unpricedCount(quote)).toBe(2);
  });
});
