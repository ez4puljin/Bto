/** Fictional trade data. Names resemble ordinary groceries; no real contact, tax or bank IDs. */
export const DATASET_ID = 'bto-qa-six-month-20261124-v1';
export const QA_DATABASE = 'bto_qa_six_month_20261124';
export const FIRST_DAY = '2026-06-01';
export const LAST_DAY = '2026-11-23';
export const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];

const packs = (labels, weights, costs, cartons = [24, 20, 12, 8, 6]) =>
  labels.map((label, index) => ({
    label,
    weightKg: String(weights[index]),
    cost: costs[index],
    carton: String(cartons[index]),
  }));

/** Twenty departments, five genuine product distinctions and five sensible pack variants each. */
export const DEPARTMENTS = [
  {
    key: 'flour',
    name: 'Гурил, гурилан бүтээгдэхүүн',
    family: 'Хуурай хүнс',
    noun: 'Гурил',
    varieties: [
      'Буудайн дээд гурил',
      'Буудайн нэгдүгээр гурил',
      'Бүхэл үрийн гурил',
      'Хөх тарианы гурил',
      'Бялууны зориулалтын гурил',
    ],
    packs: packs(
      ['500г', '1кг', '2кг', '5кг', '10кг'],
      [0.5, 1, 2, 5, 10],
      [1400, 2600, 5000, 12000, 23500],
      [20, 10, 6, 4, 2],
    ),
  },
  {
    key: 'rice',
    name: 'Будаа, үр тариа',
    family: 'Хуурай хүнс',
    noun: 'Үр тариа',
    varieties: [
      'Урт цагаан будаа',
      'Бөөрөнхий цагаан будаа',
      'Бор будаа',
      'Жасмин будаа',
      'Гурвалжин будаа',
    ],
    packs: packs(
      ['500г', '800г', '1кг', '2кг', '5кг'],
      [0.5, 0.8, 1, 2, 5],
      [1700, 2500, 3100, 6000, 14500],
    ),
  },
  {
    key: 'pasta',
    name: 'Гоймон, бэлэн хоол',
    family: 'Хуурай хүнс',
    noun: 'Гоймон',
    varieties: [
      'Нарийн гоймон',
      'Мушгиа гоймон',
      'Хавтгай гоймон',
      'Өндөгтэй гоймон',
      'Бүхэл үрийн гоймон',
    ],
    packs: packs(
      ['250г', '400г', '500г', '800г', '1кг'],
      [0.25, 0.4, 0.5, 0.8, 1],
      [1050, 1600, 1900, 2900, 3500],
    ),
  },
  {
    key: 'oil',
    name: 'Хүнсний тос',
    family: 'Хуурай хүнс',
    noun: 'Тос',
    varieties: [
      'Наранцэцгийн тос',
      'Эрдэнэ шишийн тос',
      'Шар буурцгийн тос',
      'Канола тос',
      'Холимог ургамлын тос',
    ],
    packs: packs(
      ['250мл', '500мл', '1л', '2л', '5л'],
      [0.23, 0.46, 0.92, 1.84, 4.6],
      [1500, 2600, 4700, 9000, 21500],
      [24, 12, 12, 6, 4],
    ),
  },
  {
    key: 'sugar',
    name: 'Элсэн чихэр, давс',
    family: 'Хуурай хүнс',
    noun: 'Амт',
    varieties: [
      'Цагаан элсэн чихэр',
      'Бор элсэн чихэр',
      'Ёотон',
      'Нунтаг сахар',
      'Иоджуулсан давс',
    ],
    packs: packs(
      ['250г', '500г', '1кг', '2кг', '5кг'],
      [0.25, 0.5, 1, 2, 5],
      [850, 1500, 2800, 5400, 13000],
    ),
  },
  {
    key: 'breakfast',
    name: 'Өглөөний хүнс',
    family: 'Хуурай хүнс',
    noun: 'Өглөө',
    varieties: [
      'Овьёосны нэвс',
      'Эрдэнэ шишийн өглөөний хоол',
      'Хатаасан жимстэй мюсли',
      'Самартай гранола',
      'Бүхэл үрийн өглөөний хоол',
    ],
    packs: packs(
      ['200г', '350г', '500г', '750г', '1кг'],
      [0.2, 0.35, 0.5, 0.75, 1],
      [1800, 2700, 3600, 5200, 6700],
    ),
  },
  {
    key: 'milk',
    name: 'Сүү, сүүн ундаа',
    family: 'Сүүн бүтээгдэхүүн',
    noun: 'Сүү',
    cold: true,
    varieties: [
      'Үнээний сүү 3.2%',
      'Үнээний сүү 2.5%',
      'Тослог багатай сүү',
      'Шоколадтай сүү',
      'Лактозгүй сүү',
    ],
    packs: packs(
      ['200мл', '500мл', '900мл', '1л', '2л'],
      [0.2, 0.5, 0.9, 1, 2],
      [700, 1500, 2500, 2700, 5100],
    ),
  },
  {
    key: 'yogurt',
    name: 'Тараг, цагаан идээ',
    family: 'Сүүн бүтээгдэхүүн',
    noun: 'Цагаан идээ',
    cold: true,
    varieties: [
      'Цэвэр тараг',
      'Гүзээлзгэнэтэй тараг',
      'Нэрстэй тараг',
      'Чацарганатай тараг',
      'Тоорын амттай тараг',
    ],
    packs: packs(
      ['150г', '250г', '450г', '900г', '1.5кг'],
      [0.15, 0.25, 0.45, 0.9, 1.5],
      [850, 1300, 2100, 3800, 6000],
    ),
  },
  {
    key: 'water',
    name: 'Ус, рашаан',
    family: 'Ундаа, ус',
    noun: 'Ус',
    varieties: ['Цэвэр ус', 'Эрдэсжүүлсэн ус', 'Хийжүүлсэн ус', 'Нимбэгтэй ус', 'Байгалийн рашаан'],
    packs: packs(
      ['330мл', '500мл', '1л', '1.5л', '5л'],
      [0.33, 0.5, 1, 1.5, 5],
      [450, 550, 850, 1100, 2900],
      [24, 24, 12, 12, 4],
    ),
  },
  {
    key: 'juice',
    name: 'Жүүс, жимсний ундаа',
    family: 'Ундаа, ус',
    noun: 'Жимсний ундаа',
    varieties: ['Алимны жүүс', 'Жүржийн жүүс', 'Олон жимсний жүүс', 'Тоорын жүүс', 'Анарын жүүс'],
    packs: packs(
      ['200мл', '330мл', '500мл', '1л', '2л'],
      [0.2, 0.33, 0.5, 1, 2],
      [650, 1000, 1450, 2700, 5000],
    ),
  },
  {
    key: 'soda',
    name: 'Хийжүүлсэн ундаа',
    family: 'Ундаа, ус',
    noun: 'Ундаа',
    varieties: [
      'Кола ундаа',
      'Жүржийн хийжүүлсэн ундаа',
      'Нимбэгийн хийжүүлсэн ундаа',
      'Лийрийн хийжүүлсэн ундаа',
      'Сахаргүй кола ундаа',
    ],
    packs: packs(
      ['250мл', '330мл', '500мл', '1л', '1.5л'],
      [0.25, 0.33, 0.5, 1, 1.5],
      [650, 900, 1150, 2000, 2700],
    ),
  },
  {
    key: 'tea',
    name: 'Цай, кофе',
    family: 'Ундаа, ус',
    noun: 'Цай кофе',
    varieties: ['Хар цай', 'Ногоон цай', 'Ургамлын цай', 'Жимстэй цай', 'Сүүтэй цайны холимог'],
    packs: packs(
      ['20 уут', '25 уут', '50 уут', '100 уут', '200 уут'],
      [0.04, 0.05, 0.1, 0.2, 0.4],
      [1500, 1800, 3300, 5900, 11000],
    ),
  },
  {
    key: 'biscuit',
    name: 'Жигнэмэг, амттан',
    family: 'Амттан, зууш',
    noun: 'Жигнэмэг',
    varieties: [
      'Сүүн жигнэмэг',
      'Овьёосны жигнэмэг',
      'Шоколадтай жигнэмэг',
      'Цөцгийтэй жигнэмэг',
      'Самартай жигнэмэг',
    ],
    packs: packs(
      ['90г', '150г', '200г', '300г', '500г'],
      [0.09, 0.15, 0.2, 0.3, 0.5],
      [650, 1100, 1450, 2000, 3200],
    ),
  },
  {
    key: 'snack',
    name: 'Самар, хатаасан жимс',
    family: 'Амттан, зууш',
    noun: 'Самар',
    varieties: [
      'Газрын самар',
      'Кешью самар',
      'Бүйлс самар',
      'Хатаасан үзэм',
      'Самар жимсний холимог',
    ],
    packs: packs(
      ['50г', '100г', '150г', '250г', '500г'],
      [0.05, 0.1, 0.15, 0.25, 0.5],
      [700, 1300, 1900, 3000, 5700],
    ),
  },
  {
    key: 'sauce',
    name: 'Соус, амтлагч',
    family: 'Хуурай хүнс',
    noun: 'Соус',
    varieties: [
      'Улаан лоолийн кетчуп',
      'Майонез',
      'Шар буурцгийн соус',
      'Чили соус',
      'Салатны соус',
    ],
    packs: packs(
      ['100г', '200г', '350г', '500г', '1кг'],
      [0.1, 0.2, 0.35, 0.5, 1],
      [750, 1300, 2050, 2800, 5100],
    ),
  },
  {
    key: 'canned',
    name: 'Лаазалсан хүнс',
    family: 'Хуурай хүнс',
    noun: 'Нөөц хүнс',
    varieties: [
      'Ногоон вандуй',
      'Амтат эрдэнэ шиш',
      'Улаан шош',
      'Хальсалсан улаан лооль',
      'Холимог ногоо',
    ],
    packs: packs(
      ['200г', '340г', '400г', '800г', '1.5кг'],
      [0.2, 0.34, 0.4, 0.8, 1.5],
      [1200, 1800, 2100, 3800, 6500],
    ),
  },
  {
    key: 'meat',
    name: 'Мах, махан бүтээгдэхүүн',
    family: 'Хөргүүрийн хүнс',
    noun: 'Мах',
    cold: true,
    base: 'KG',
    varieties: [
      'Үхрийн цул мах',
      'Хонины гуяны мах',
      'Үхрийн татсан мах',
      'Тахианы цээж мах',
      'Гахайн цул мах',
    ],
    packs: packs(
      ['шинэ', 'хөргөсөн', 'хөлдөөсөн', 'зориулалтын савлагаатай', 'ясгүй ангилсан'],
      [1, 1, 1, 1, 1],
      [14500, 14200, 13800, 14900, 15500],
      [10, 10, 10, 10, 10],
    ),
  },
  {
    key: 'produce',
    name: 'Жимс, хүнсний ногоо',
    family: 'Шинэ хүнс',
    noun: 'Шинэ ургац',
    base: 'KG',
    varieties: ['Улаан алим', 'Шар төмс', 'Шар сонгино', 'Лууван', 'Цагаан байцаа'],
    packs: packs(
      [
        'дотоодын I зэрэг',
        'дотоодын II зэрэг',
        'импортын I зэрэг',
        'сонгож ангилсан',
        'угааж бэлтгэсэн',
      ],
      [1, 1, 1, 1, 1],
      [3000, 2600, 3400, 3600, 3900],
      [20, 20, 20, 20, 20],
    ),
  },
  {
    key: 'cleaning',
    name: 'Ахуйн цэвэрлэгээ',
    family: 'Ахуйн хэрэглээ',
    noun: 'Ахуйн хангамж',
    varieties: [
      'Аяга таваг угаагч',
      'Шал угаагч',
      'Универсал цэвэрлэгч',
      'Шил цэвэрлэгч',
      'Угаалгын шингэн',
    ],
    packs: packs(
      ['250мл', '500мл', '750мл', '1л', '2л'],
      [0.25, 0.5, 0.75, 1, 2],
      [1500, 2500, 3500, 4500, 8300],
    ),
  },
  {
    key: 'hygiene',
    name: 'Хувийн ариун цэвэр',
    family: 'Ахуйн хэрэглээ',
    noun: 'Ариун цэвэр',
    varieties: [
      'Гар угаах шингэн саван',
      'Чийгшүүлэгч шингэн саван',
      'Хүүхдийн шингэн саван',
      'Бактерийн эсрэг саван',
      'Үнэргүй шингэн саван',
    ],
    packs: packs(
      ['100мл', '200мл', '300мл', '500мл', '1л'],
      [0.1, 0.2, 0.3, 0.5, 1],
      [850, 1500, 2100, 3200, 5800],
    ),
  },
];

export function checkDigit(body) {
  const sum = [...body].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1),
    0,
  );
  return String((10 - (sum % 10)) % 10);
}

export const SUPPLIERS = DEPARTMENTS.flatMap((department, departmentIndex) =>
  ['Хангайн', 'Талын', 'Дэлгэр'].map((region, variant) => {
    const index = departmentIndex * 3 + variant;
    return {
      index,
      code: String(88010001 + index),
      name: `${region} ${department.noun} ${variant === 1 ? 'Худалдаа' : 'Трейд'} ХХК`,
      department: department.key,
      family: department.family,
      vatPayer: index % 3 !== 2,
      paymentTermDays: [7, 14, 30][variant],
      email: `supplier-${index + 1}@example.invalid`,
      address: [
        'Улаанбаатар, Баянгол дүүрэг',
        'Улаанбаатар, Сонгинохайрхан дүүрэг',
        'Хөвсгөл, Мөрөн сум',
      ][variant],
      note: `${DATASET_ID}: зохиомол нийлүүлэгч; бодит регистр, данс, утас ашиглаагүй`,
    };
  }),
);

export const PRODUCTS = DEPARTMENTS.flatMap((department, departmentIndex) =>
  department.varieties.flatMap((variety, varietyIndex) =>
    department.packs.map((pack, packIndex) => {
      const index = departmentIndex * 25 + varietyIndex * 5 + packIndex;
      const barcodeBody = `298824${String(index + 1).padStart(6, '0')}`;
      const boxBody = `298825${String(index + 1).padStart(6, '0')}`;
      return {
        index,
        sku: String(88000001 + index),
        name: `${variety} ${pack.label}${department.base === 'KG' ? ' кг' : ''}`,
        department: department.key,
        family: department.family,
        supplierIndex: departmentIndex * 3 + ((varietyIndex + packIndex) % 3),
        alternateSupplierIndex: departmentIndex * 3 + ((varietyIndex + packIndex + 1) % 3),
        base: department.base ?? 'PCS',
        weightKg: pack.weightKg,
        carton: pack.carton,
        barcode: barcodeBody + checkDigit(barcodeBody),
        boxBarcode: boxBody + checkDigit(boxBody),
        baseCost: String(
          Math.round((pack.cost * [100, 108, 115, 95, 125][varietyIndex]) / 100 / 10) * 10,
        ),
        homeWarehouseIndex: department.cold ? 1 : 0,
        cold: department.cold ?? false,
      };
    }),
  ),
);

export const CUSTOMERS = Array.from({ length: 80 }, (_, index) => {
  const prefix = ['Дэлгэр', 'Хангай', 'Саруул', 'Талын', 'Хөвсгөл', 'Мөрөн', 'Тунгалаг', 'Наран'];
  const suffix = ['Хүнс', 'Өглөө', 'Төв', 'Маркет', 'Сайхан'];
  const kind = index < 40 ? 'дэлгүүр' : index < 60 ? 'кафе' : 'ресторан';
  return {
    index,
    code: String(88020001 + index),
    name: `${prefix[index % 8]} ${suffix[Math.floor(index / 8) % 5]} ${kind} ${String(Math.floor(index / 40) + 1).padStart(2, '0')}`,
    kind: 'COMPANY',
    settlementGroup: ['DAY_20', 'MONTH_END'][index % 2],
    creditLimit: '50000000',
    note: `${DATASET_ID}: зохиомол харилцагч`,
  };
});

export function daysBetween(first = FIRST_DAY, last = LAST_DAY) {
  const days = [];
  for (
    let at = new Date(`${first}T00:00:00Z`);
    at.toISOString().slice(0, 10) <= last;
    at.setUTCDate(at.getUTCDate() + 1)
  )
    days.push(at.toISOString().slice(0, 10));
  return days;
}

export const DAYS = daysBetween();

export function summary() {
  return {
    datasetId: DATASET_ID,
    database: QA_DATABASE,
    window: {
      first: FIRST_DAY,
      last: LAST_DAY,
      months: MONTHS,
      days: DAYS.length,
      lastMonthPartial: true,
    },
    products: PRODUCTS.length,
    suppliers: SUPPLIERS.length,
    supplierDepartments: DEPARTMENTS.length,
    supplierFamilies: new Set(DEPARTMENTS.map((d) => d.family)).size,
    customers: CUSTOMERS.length,
    kgProducts: PRODUCTS.filter((p) => p.base === 'KG').length,
    warehouses: { wholesale: 2, store: 2 },
    targets: {
      receipts: 360,
      wholesaleSalesPerDay: 4,
      posTicketsPerDay: 6,
      returnsEveryDays: 7,
      monthlyExpenses: 5,
    },
    historyClock:
      'QA-process logical business clock only; PostgreSQL clock, defaults and createdAt audit timestamps remain actual generation time',
    fiction:
      'All companies and transactions synthetic; no real tax IDs, contacts, bank accounts or external providers',
  };
}
