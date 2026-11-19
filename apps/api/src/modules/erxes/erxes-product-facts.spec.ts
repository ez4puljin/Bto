import {
  type BtoCategory,
  ErxesProductIndex,
  majorityProfile,
  placeErxesCategory,
  TillPlanIndex,
  tillPlans,
} from './erxes-product-facts';
import {
  ERXES_TILL_POS,
  type ErxesFactProduct,
  type ErxesPlan,
  readCategories,
  readFactProduct,
  readPlans,
  readPosList,
  readTags,
} from './erxes-wire';

// Bto's categories as the product master made them (ADR-0098), with a range widened and a name
// changed since, as the real system has them.
const CATEGORIES: BtoCategory[] = [
  { id: 1, parentId: null, name: 'Шингэн Бүтээгдэхүүн', skuFrom: '100000' },
  { id: 2, parentId: 1, name: 'Ангилаагүй', skuFrom: null },
  { id: 3, parentId: 1, name: '101 Дарс виски', skuFrom: '101000' },
  { id: 4, parentId: null, name: 'Тамхи', skuFrom: null },
  { id: 5, parentId: null, name: 'Төрөл бүрийн бараа', skuFrom: '900000' },
  { id: 6, parentId: 5, name: 'Хүүхдийн Бүтээгдэхүүн', skuFrom: null },
  { id: 7, parentId: 5, name: '905 Хятад бараа', skuFrom: '905000' },
  { id: 8, parentId: 2, name: 'Савалгаатай чихэр', skuFrom: '215000' },
  { id: 9, parentId: 2, name: '504 Саван', skuFrom: null },
  { id: 10, parentId: 2, name: '508 Саван', skuFrom: null },
];

describe('the Bto category of an erxes category (ADR-0223)', () => {
  it('takes a numbered category by its range, else by the number in its name', () => {
    expect(placeErxesCategory('101 Дарс виски', CATEGORIES)).toBe(3);
    expect(placeErxesCategory('905 Хятад бараа', CATEGORIES)).toBe(7);
    // Renamed in Bto without its number: its range still says which it is.
    expect(placeErxesCategory('215 Савалгаатай чихэр', CATEGORIES)).toBe(8);
    // Two «Саван» stay apart by their numbers.
    expect(placeErxesCategory('504 Саван', CATEGORIES)).toBe(9);
    expect(placeErxesCategory('508 Саван', CATEGORIES)).toBe(10);
  });

  it("takes «+» groups, a group's own name and the unnumbered names", () => {
    expect(placeErxesCategory('+Тамхи', CATEGORIES)).toBe(4);
    expect(placeErxesCategory('Шингэн Бүтээгдэхүүн', CATEGORIES)).toBe(2);
    expect(placeErxesCategory('Хүүхдийн бүтээгдэхүүн ', CATEGORIES)).toBe(6);
  });

  it('settles nothing Bto has no counterpart for', () => {
    expect(placeErxesCategory('Хархорин Боломж', CATEGORIES)).toBeNull();
    expect(placeErxesCategory('303 Сүү', CATEGORIES)).toBeNull();
    expect(placeErxesCategory('+Электрон тамхи', CATEGORIES)).toBeNull();
    expect(placeErxesCategory(null, CATEGORIES)).toBeNull();
  });
});

const plan = (erxesId: string, fields: Partial<ErxesPlan> = {}): ErxesPlan => ({
  erxesId,
  name: erxesId,
  active: true,
  isPriority: true,
  applyType: 'tag',
  products: [],
  productsExcluded: [],
  tags: [],
  tagsExcluded: [],
  branchIds: ['b-pos'],
  departmentIds: ['d-pos'],
  pipelineId: null,
  ...fields,
});
const product = (erxesId: string, tagIds: string[], code = erxesId): ErxesFactProduct => ({
  erxesId,
  code,
  barcodes: [],
  categoryId: null,
  tagIds,
});
const TILLS = [
  { name: ERXES_TILL_POS, branchId: 'b-pos', departmentId: 'd-pos' },
  { name: 'Хархорин', branchId: 'b-kh', departmentId: 'd-kh' },
];

describe("an erxes product's price group (ADR-0223)", () => {
  it("keeps the supermarket till's active plans and the public ones", () => {
    const plans = [
      plan('own'),
      plan('public', { branchIds: [], departmentIds: [] }),
      plan('kharkhorin', { branchIds: ['b-kh'], departmentIds: ['d-kh'] }),
      plan('pipeline', { branchIds: [], departmentIds: [], pipelineId: 'pl-1' }),
      plan('off', { active: false }),
    ];
    expect(tillPlans(plans, TILLS).map((one) => one.erxesId)).toEqual(['own', 'public']);
    expect(tillPlans(plans, [])).toEqual([]);
  });

  it('is the set of tag plans reaching the product, child tags in and exclusions out', () => {
    const index = new TillPlanIndex(
      [
        plan('p-main', { tags: ['t-bb'], tagsExcluded: ['t-bb-off'] }),
        plan('p-main-bulk', { tags: ['t-bb'], isPriority: false }),
        plan('p-beer', { tags: ['t-beer'], productsExcluded: ['x-beer'] }),
        plan('p-egg', { applyType: 'product', products: ['egg'] }),
      ],
      [
        { erxesId: 't-bb', parentId: null },
        { erxesId: 't-bb-kid', parentId: 't-bb' },
        { erxesId: 't-bb-off', parentId: 't-bb' },
        { erxesId: 't-beer', parentId: null },
      ],
    );
    expect(index.signature(product('a', ['t-bb']))).toBe('p-main.p-main-bulk');
    expect(index.signature(product('b', ['t-bb-kid']))).toBe('p-main.p-main-bulk');
    expect(index.signature(product('c', ['t-bb-off']))).toBe('p-main-bulk');
    expect(index.signature(product('d', ['t-beer', 't-bb']))).toBe('p-beer.p-main.p-main-bulk');
    expect(index.signature(product('x-beer', ['t-beer']))).toBe('');
    expect(index.signature(product('e', []))).toBe('');
    expect(index.hasProductPlan(product('egg', []))).toBe(true);
    expect(index.hasProductPlan(product('a', ['t-bb']))).toBe(false);
  });

  it('takes the profile more than half of its Bto products carry', () => {
    expect(
      majorityProfile(
        new Map([
          [7, 30],
          [1, 2],
        ]),
      ),
    ).toBe(7);
    expect(
      majorityProfile(
        new Map([
          [7, 2],
          [1, 2],
        ]),
      ),
    ).toBeNull();
    expect(majorityProfile(new Map())).toBeNull();
    expect(majorityProfile(undefined)).toBeNull();
  });
});

describe('finding an Erkhet item in erxes (ADR-0223)', () => {
  const index = new ErxesProductIndex([
    { ...product('e1', [], '101001'), barcodes: ['4006381333931'] },
    { ...product('e2', [], '26Q4045'), barcodes: ['5901234123457'] },
    { ...product('e3', [], '101002'), barcodes: ['5901234123457'] },
    product('e4', [], '101003'),
    product('e5', [], '101003'),
  ]);

  it('by code first, then by a barcode only one product holds', () => {
    expect(index.find({ code: '101001', barcodes: [] })?.erxesId).toBe('e1');
    expect(index.find({ code: ' 26Q4045', barcodes: [] })?.erxesId).toBe('e2');
    expect(index.find({ code: '999999', barcodes: ['4006381333931'] })?.erxesId).toBe('e1');
    // A barcode two products hold, or a code two products share, settles nothing.
    expect(index.find({ code: '999999', barcodes: ['5901234123457'] })).toBeNull();
    expect(index.find({ code: '101003', barcodes: [] })).toBeNull();
    expect(index.find({ code: null, barcodes: [] })).toBeNull();
  });
});

describe("reading erxes's answers (checked 2026-11-19)", () => {
  it('reads products, categories, tags, tills and plans defensively', () => {
    expect(
      readFactProduct({
        _id: 'p1',
        code: '101001',
        barcodes: ['4006381333931', null],
        categoryId: 'c1',
        tagIds: ['t1', 't2'],
      }),
    ).toEqual({
      erxesId: 'p1',
      code: '101001',
      barcodes: ['4006381333931'],
      categoryId: 'c1',
      tagIds: ['t1', 't2'],
    });
    expect(readFactProduct({ code: '1' })).toBeNull();
    expect(readCategories([{ _id: 'c1', name: '101 Дарс виски', code: '101' }, {}])).toEqual([
      { erxesId: 'c1', name: '101 Дарс виски' },
    ]);
    expect(readTags([{ _id: 't1', name: 'BB', parentId: null }])).toEqual([
      { erxesId: 't1', parentId: null },
    ]);
    expect(
      readPosList([{ _id: 'x', name: ERXES_TILL_POS, branchId: 'b', departmentId: 'd' }]),
    ).toEqual([{ name: ERXES_TILL_POS, branchId: 'b', departmentId: 'd' }]);
    expect(
      readPlans([
        {
          _id: 'pl1',
          name: 'Үндсэн',
          status: 'active',
          isPriority: true,
          applyType: 'tag',
          tags: ['t1'],
          branchIds: ['b'],
          departmentIds: ['d'],
          pipelineId: '',
        },
      ]),
    ).toEqual([
      plan('pl1', {
        name: 'Үндсэн',
        tags: ['t1'],
        branchIds: ['b'],
        departmentIds: ['d'],
      }),
    ]);
  });
});
