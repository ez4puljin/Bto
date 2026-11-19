/**
 * A deal as Bto expects erxes to answer `dealDetail` (ADR-0218 #8), written from the owner's list
 * of what a deal holds: name, number, stage, createdAt, creator, assigned users, labels, custom
 * fields, description, start and close dates, products with unit price, discount, amount and unit,
 * customers and companies, attachments. Nothing here is a real deal, customer or person. The first
 * live answer of each pipeline is kept in `erxes_pipelines.first_pull` to be laid beside this.
 */
export const FIXTURE_USER = {
  _id: 'u-seller',
  email: 'seller@example.test',
  username: 'seller',
  details: { fullName: 'Туяа Бат', firstName: 'Туяа', lastName: 'Бат', operatorPhone: null },
};

export const FIXTURE_PRODUCTS = [
  {
    _id: 'p-cola',
    name: 'Кола 0.5л',
    code: '101001',
    barcodes: ['4006381333931'],
    uom: 'ш',
    unitPrice: 1500,
  },
  {
    _id: 'p-old',
    name: 'Хуучин кодтой бараа',
    code: '900123',
    barcodes: [],
    uom: 'ш',
    unitPrice: 800,
  },
];

export const FIXTURE_FIELDS = [
  { _id: 'f-route', text: 'Чиглэл', code: 'route', type: 'input' },
  { _id: 'f-paid', text: 'Төлбөр төлсөн', code: 'paid', type: 'check' },
];

export const FIXTURE_DEAL = {
  _id: 'd-1001',
  name: 'Нэг дэлгүүр 11/17',
  number: 'MB-1001',
  description: '<p>Өглөө 10 цагаас өмнө хүргэнэ.</p><p>Хаалга нь арын талд.</p>',
  status: 'active',
  priority: 'Normal',
  createdAt: '2026-11-17T02:10:00.000Z',
  modifiedAt: '2026-11-17T02:12:00.000Z',
  startDate: '2026-11-17T02:10:00.000Z',
  closeDate: '2026-11-19T08:00:00.000Z',
  stageChangedDate: '2026-11-17T02:10:00.000Z',
  stageId: 's-new',
  boardId: 'b-khuvsgul',
  stage: { _id: 's-new', name: 'Шинэ', pipelineId: 'pl-murun' },
  pipeline: { _id: 'pl-murun', name: 'Мөрөн Борлуулалт' },
  userId: 'u-seller',
  createdUser: FIXTURE_USER,
  assignedUserIds: ['u-driver'],
  assignedUsers: [
    {
      _id: 'u-driver',
      email: 'driver@example.test',
      username: 'driver',
      details: { fullName: 'Болд Дорж' },
    },
  ],
  labelIds: ['l-urgent'],
  labels: [{ _id: 'l-urgent', name: 'Яаралтай', colorCode: '#ff0000' }],
  tagIds: [],
  branchIds: [],
  departmentIds: [],
  customFieldsData: [
    { field: 'f-route', value: 'Мөрөн төв', stringValue: 'Мөрөн төв' },
    { field: 'f-paid', value: true },
  ],
  productsData: [
    {
      _id: 'pd-1',
      productId: 'p-cola',
      uom: 'ш',
      currency: 'MNT',
      quantity: 24,
      unitPrice: 1500,
      discountPercent: 10,
      discount: 3600,
      tax: 0,
      amount: 32400,
      tickUsed: true,
    },
    {
      _id: 'pd-2',
      productId: 'p-old',
      uom: 'ш',
      currency: 'MNT',
      quantity: 5,
      unitPrice: 800,
      discountPercent: 0,
      discount: 0,
      tax: 0,
      amount: 4000,
      tickUsed: true,
    },
  ],
  amount: { MNT: 36400 },
  customers: [
    {
      _id: 'c-person',
      code: null,
      firstName: 'Сараа',
      lastName: 'Ган',
      primaryPhone: '99112233',
      phones: ['99112233'],
      primaryEmail: null,
    },
  ],
  companies: [
    {
      _id: 'co-shop',
      code: '50001',
      primaryName: 'Нэг дэлгүүр',
      names: ['Нэг дэлгүүр'],
      primaryPhone: '88001122',
      phones: ['88001122'],
    },
  ],
  attachments: [
    { name: 'zahialga.jpg', url: 'uploads/zahialga.jpg', type: 'image/jpeg', size: 20480 },
  ],
};

/**
 * `configsGetValue(code: "remainderConfig")` as the old ERP read it (ADR-0221): pipeline id →
 * the Erkhet account and the locations the pipeline's `erkhetRemainders` covers. The pipelines
 * and locations are those of 2026-10-22; an entry of another account is not stock.
 */
export const FIXTURE_REMAINDER_CONFIG = {
  'pl-hall': { title: 'Заалны хөдөлгөөн', account: '150101', location: '01,02,11,12,10' },
  'pl-drinks': { title: 'Архины заалны хөдөлгөөн', account: '150101', location: '02,08' },
  'pl-kharkhorin': { title: 'Хархорин', account: '150101', location: '05' },
  'pl-other': { title: 'Өөр данс', account: '120101', location: '01,03' },
};

/** `erkhetRemainders` of two products asked through `pl-hall`. */
export const FIXTURE_REMAINDERS = [
  {
    _id: 'p-cola',
    remainder: 130,
    remainders: [
      { location: '01', remainder: 120 },
      { location: '11', remainder: 10.5 },
      { location: '02', remainder: 0 },
    ],
  },
  { _id: 'p-old', remainder: 0, remainders: [] },
];
