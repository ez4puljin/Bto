import { Decimal } from '@tugeel/shared/money';
import { compareStock, type BtoSide, type ErkhetSide, sameUnit } from './erxes-stock-compare';
import {
  ERKHET_REMAINDERS,
  planRemainders,
  PRODUCT_PAGE,
  readRemainderConfig,
  readRemainders,
  REMAINDER_CONFIG,
  renderQuery,
} from './erxes-wire';
import { FIXTURE_REMAINDER_CONFIG, FIXTURE_REMAINDERS } from './erxes-wire.fixture';
import { remainderCalls } from './services/erxes-stock-run-flow.service';
import { estimatedFinish } from './services/erxes-stock.service';

describe('reading remainderConfig', () => {
  const expected = [
    { pipelineId: 'pl-hall', account: '150101', locations: ['01', '02', '10', '11', '12'] },
    { pipelineId: 'pl-drinks', account: '150101', locations: ['02', '08'] },
    { pipelineId: 'pl-kharkhorin', account: '150101', locations: ['05'] },
    { pipelineId: 'pl-other', account: '120101', locations: ['01', '03'] },
  ];

  it('reads the JSON erxes answers', () => {
    expect(readRemainderConfig(FIXTURE_REMAINDER_CONFIG)).toEqual(expected);
  });

  it('reads it inside `value`, and as text', () => {
    expect(
      readRemainderConfig({ _id: 'c1', code: 'remainderConfig', value: FIXTURE_REMAINDER_CONFIG }),
    ).toEqual(expected);
    expect(
      readRemainderConfig(JSON.stringify({ value: JSON.stringify(FIXTURE_REMAINDER_CONFIG) })),
    ).toEqual(expected);
  });

  it('answers nothing for nothing', () => {
    expect(readRemainderConfig(null)).toEqual([]);
    expect(readRemainderConfig('not json')).toEqual([]);
    expect(readRemainderConfig({ 'pl-x': 'broken' })).toEqual([]);
  });
});

describe('the pipeline plan', () => {
  it('covers every stock location with the fewest pipelines, each location once', () => {
    expect(planRemainders(readRemainderConfig(FIXTURE_REMAINDER_CONFIG))).toEqual([
      { pipelineId: 'pl-hall', locations: ['01', '02', '10', '11', '12'] },
      { pipelineId: 'pl-drinks', locations: ['08'] },
      { pipelineId: 'pl-kharkhorin', locations: ['05'] },
    ]);
  });

  it('leaves out other accounts and empty entries', () => {
    expect(
      planRemainders([
        { pipelineId: 'a', account: '120101', locations: ['01'] },
        { pipelineId: 'b', account: '150101', locations: [] },
      ]),
    ).toEqual([]);
  });

  it('cuts a run into calls of 50 products through every step', () => {
    const ids = Array.from({ length: 120 }, (_, at) => `p${at}`);
    const plan = [
      { pipelineId: 'a', locations: ['01'] },
      { pipelineId: 'b', locations: ['08'] },
    ];
    const calls = remainderCalls(ids, plan);
    expect(calls).toHaveLength(6);
    expect(calls.map((call) => [call.ids.length, call.step.pipelineId])).toEqual([
      [50, 'a'],
      [50, 'b'],
      [50, 'a'],
      [50, 'b'],
      [20, 'a'],
      [20, 'b'],
    ]);
  });
});

describe('reading erkhetRemainders', () => {
  it('reads each location as text, zeros included', () => {
    const rows = readRemainders(FIXTURE_REMAINDERS);
    expect(rows.map((row) => [row.erxesId, Object.fromEntries(row.byLocation)])).toEqual([
      ['p-cola', { '01': '120', '11': '10.5', '02': '0' }],
      ['p-old', {}],
    ]);
  });

  it('reads remainders sent as JSON text, sums a location named twice, skips junk', () => {
    const [row] = readRemainders([
      {
        _id: 'p1',
        remainders: JSON.stringify([
          { location: '01', remainder: '2.5' },
          { location: '01', remainder: 1 },
          { location: null, remainder: 4 },
          { location: '02', remainder: 'many' },
        ]),
      },
      { remainders: [] },
    ]);
    expect(Object.fromEntries(row?.byLocation ?? [])).toEqual({ '01': '3.5' });
  });

  it('asks as the old ERP asked', () => {
    const remainders = renderQuery(ERKHET_REMAINDERS[0]!).document;
    expect(remainders).toContain(
      'erkhetRemainders(productIds: $productIds, stageId: "", pipelineId: $pipelineId) {',
    );
    expect(renderQuery(PRODUCT_PAGE[0]!).document).toContain(
      'products(status: "active", perPage: $perPage, page: $page) {',
    );
    // erxes's JSON takes no selection.
    expect(renderQuery(REMAINDER_CONFIG[0]!).document).toBe(
      'query bto {\nconfigsGetValue(code: "remainderConfig")\n}',
    );
  });
});

describe('the comparison', () => {
  const erkhet = (
    erxesId: string,
    productId: number | null,
    quantity: string,
    extra: Partial<ErkhetSide> = {},
  ): ErkhetSide => ({
    erxesId,
    code: erxesId.toUpperCase(),
    name: `name ${erxesId}`,
    uom: 'ш',
    productId,
    matchReason: productId === null ? 'PRODUCT_NOT_FOUND' : null,
    readOk: true,
    quantity: new Decimal(quantity),
    ...extra,
  });
  const bto = (productId: number, onHand: string, unit = 'ш'): [number, BtoSide] => [
    productId,
    {
      productId,
      sku: `SKU${productId}`,
      name: `Bto ${productId}`,
      unit,
      onHand: new Decimal(onHand),
    },
  ];

  it('puts Erkhet beside Bto with the difference', () => {
    const result = compareStock(
      [erkhet('a', 1, '10'), erkhet('b', 2, '5')],
      new Map([bto(1, '7'), bto(2, '5')]),
    );
    expect(
      result.matched.map((row) => [
        row.sku,
        row.erkhet?.toString(),
        row.bto.toString(),
        row.difference?.toString(),
      ]),
    ).toEqual([
      ['SKU1', '10', '7', '3'],
      ['SKU2', '5', '5', '0'],
    ]);
  });

  it('adds up erxes products that are one Bto product', () => {
    const [row] = compareStock(
      [erkhet('a', 1, '10'), erkhet('b', 1, '2.5')],
      new Map([bto(1, '12')]),
    ).matched;
    expect(row?.erkhet?.toString()).toBe('12.5');
    expect(row?.erxes.map((entry) => entry.erxesId)).toEqual(['a', 'b']);
  });

  it('keeps an unknown Erkhet quantity unknown, never zero', () => {
    const [row] = compareStock(
      [erkhet('a', 1, '0', { readOk: false })],
      new Map([bto(1, '4')]),
    ).matched;
    expect(row?.erkhet).toBeNull();
    expect(row?.difference).toBeNull();
  });

  it('marks a unit that differs from the base unit', () => {
    const result = compareStock(
      [erkhet('a', 1, '2', { uom: 'хайрцаг' }), erkhet('b', 2, '3', { uom: ' Ш ' })],
      new Map([bto(1, '24'), bto(2, '3')]),
    );
    expect(result.matched.map((row) => row.unitDiffers)).toEqual([true, false]);
    expect(sameUnit('кг', 'КГ')).toBe(true);
  });

  it('groups what one side does not know', () => {
    const result = compareStock(
      [
        erkhet('a', null, '6'),
        erkhet('b', null, '0'),
        erkhet('c', null, '3', { readOk: false }),
        erkhet('d', 1, '0'),
      ],
      new Map([bto(1, '0'), bto(9, '8'), bto(10, '0')]),
    );
    expect(result.notInBto.map((row) => [row.erxesId, row.erkhet.toString()])).toEqual([
      ['a', '6'],
    ]);
    expect(result.notInErkhet.map((row) => [row.productId, row.bto.toString()])).toEqual([
      [9, '8'],
    ]);
    // Nothing on either side: no row.
    expect(result.matched).toEqual([]);
  });
});

describe('the finish time', () => {
  it('follows the pace so far', () => {
    const startedAt = new Date('2026-11-19T02:00:00Z');
    const now = startedAt.getTime() + 60_000;
    const at = estimatedFinish(
      { status: 'RUNNING', startedAt, batchesDone: 10, batchesTotal: 40 },
      now,
    );
    expect(at?.toISOString()).toBe('2026-11-19T02:04:00.000Z');
    expect(
      estimatedFinish({ status: 'RUNNING', startedAt, batchesDone: 0, batchesTotal: 40 }, now),
    ).toBeNull();
    expect(
      estimatedFinish({ status: 'DONE', startedAt, batchesDone: 40, batchesTotal: 40 }, now),
    ).toBeNull();
  });
});
