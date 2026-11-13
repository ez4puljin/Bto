import { ReportGate, type ReportGateLimits } from './report-gate';

const limits = (over: Partial<ReportGateLimits> = {}): ReportGateLimits => ({
  maxRunning: 2,
  maxPerCaller: 2,
  maxWaiting: 3,
  waitMs: 1_000,
  ...over,
});

/** Lets the promises of a started waiter settle. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('ReportGate', () => {
  afterEach(() => jest.useRealTimers());

  it('lets reports in up to the limit and keeps the rest in the order they came', async () => {
    const gate = new ReportGate(limits());
    const first = await gate.enter('a');
    const second = await gate.enter('b');
    const order: string[] = [];
    const third = gate.enter('c').then((release) => (order.push('c'), release));
    const fourth = gate.enter('d').then((release) => (order.push('d'), release));
    await settle();
    expect(gate.snapshot()).toEqual({ running: 2, waiting: 2 });
    expect(order).toEqual([]);

    first();
    const releaseThird = await third;
    expect(order).toEqual(['c']);
    expect(gate.snapshot()).toEqual({ running: 2, waiting: 1 });

    second();
    const releaseFourth = await fourth;
    expect(order).toEqual(['c', 'd']);
    releaseThird();
    releaseFourth();
    expect(gate.snapshot()).toEqual({ running: 0, waiting: 0 });
    expect(gate.stats).toEqual({ started: 4, waited: 2, refused: 0 });
  });

  it("holds one caller to its share and lets the next caller pass the caller's line", async () => {
    const gate = new ReportGate(limits({ maxRunning: 3, maxPerCaller: 1 }));
    const first = await gate.enter('a');
    const order: string[] = [];
    const again = gate.enter('a').then((release) => (order.push('a2'), release));
    const other = await gate.enter('b');
    order.push('b');
    await settle();
    // «a» waits though a place is free; «b», who came later, runs.
    expect(order).toEqual(['b']);
    expect(gate.snapshot()).toEqual({ running: 2, waiting: 1 });

    first();
    (await again)();
    other();
    expect(order).toEqual(['b', 'a2']);
    expect(gate.snapshot()).toEqual({ running: 0, waiting: 0 });
  });

  it('refuses at once when the line is full', async () => {
    const gate = new ReportGate(limits({ maxRunning: 1, maxWaiting: 1 }));
    const release = await gate.enter('a');
    const waiting = gate.enter('b');
    await expect(gate.enter('c')).rejects.toMatchObject({
      code: 'REPORTS_BUSY',
      status: 429,
      params: { running: 1, waiting: 1 },
    });
    release();
    (await waiting)();
    expect(gate.stats.refused).toBe(1);
  });

  it('refuses a report that waited too long and gives its place in the line back', async () => {
    jest.useFakeTimers();
    const gate = new ReportGate(limits({ maxRunning: 1, waitMs: 500 }));
    const release = await gate.enter('a');
    const late = gate.enter('b');
    const outcome = expect(late).rejects.toMatchObject({ code: 'REPORTS_BUSY' });
    jest.advanceTimersByTime(500);
    await outcome;
    expect(gate.snapshot()).toEqual({ running: 1, waiting: 0 });
    release();
    expect(gate.snapshot()).toEqual({ running: 0, waiting: 0 });
  });

  it('takes a waiting report out of the line when its client has gone', async () => {
    const gate = new ReportGate(limits({ maxRunning: 1 }));
    const release = await gate.enter('a');
    const gone = new AbortController();
    const left = gate.enter('b', gone.signal);
    const next = gate.enter('c');
    gone.abort();
    await expect(left).rejects.toMatchObject({ code: 'REPORTS_BUSY' });
    expect(gate.snapshot()).toEqual({ running: 1, waiting: 1 });
    release();
    (await next)();
    expect(gate.snapshot()).toEqual({ running: 0, waiting: 0 });
  });

  it('gives a place back only once', async () => {
    const gate = new ReportGate(limits({ maxRunning: 1 }));
    const release = await gate.enter('a');
    release();
    release();
    const again = await gate.enter('b');
    expect(gate.snapshot()).toEqual({ running: 1, waiting: 0 });
    again();
  });
});
