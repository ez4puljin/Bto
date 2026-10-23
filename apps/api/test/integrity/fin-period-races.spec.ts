import { addMonths } from '@tugeel/shared/time';
import { FinPeriodsService } from '../../src/finance-core';
import { codeOf, intakeCore, type IntakeCore, invoice, today } from '../harness/fin-intake';
import { StaticCaller, TEST_COMPANY } from '../harness/static-caller';

/**
 * A close racing a posting (ADR-0102 #2; docs/modules/finance-core.md §17 closed period, case 5):
 * postings take the company's period lock shared and a close takes it exclusively, so no entry
 * dated in a month commits after that month (or a later one) is closed.
 */
describe('fin period races', () => {
  let core: IntakeCore;
  let periods: FinPeriodsService;
  const company = TEST_COMPANY;
  const closer = () => StaticCaller.user({ [TEST_COMPANY]: ['finance.periods.close'] });
  const monthStart = `${today().slice(0, 7)}-01`;
  const month = (back: number) => addMonths(monthStart, -back).slice(0, 7);
  const dayIn = (back: number) => `${month(back)}-10`;
  const settled = async <T>(promise: Promise<T>, ms: number): Promise<boolean> =>
    Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
    ]);

  beforeAll(async () => {
    core = await intakeCore();
    periods = core.module.get(FinPeriodsService);
  });
  afterAll(async () => {
    await core.close();
  });

  it('makes a close wait for a posting that opens an earlier month, then refuses it', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posted = (): void => undefined;
    const inside = new Promise<void>((resolve) => {
      posted = resolve;
    });
    // A posting in month −5 (no row yet) holds its transaction open.
    const posting = core.db.transaction(async (tx) => {
      const result = await core.intake.submitInTx(
        tx,
        StaticCaller.source(),
        invoice('race-1', '10', { date: dayIn(5) }),
      );
      posted();
      await held;
      return result;
    });
    await inside;
    const close = periods.close(closer(), { company, period: month(4) });
    expect(await settled(close, 400)).toBe(false);
    release();
    await posting;
    // The earlier month now has a row and is open: the close is refused, nothing is left half-done.
    expect(await codeOf(close)).toBe('FIN_PERIOD_ORDER');
  });

  it('refuses a posting in a month that a close committed first', async () => {
    await periods.close(closer(), { company, period: month(5) });
    await periods.close(closer(), { company, period: month(4) });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        core.submit(invoice(`race-2-${index}`, '10', { date: dayIn(4) })),
      ),
    );
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
  });

  it('lets a posting into the month commit before a close that waits for it', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posted = (): void => undefined;
    const inside = new Promise<void>((resolve) => {
      posted = resolve;
    });
    const posting = core.db.transaction(async (tx) => {
      await core.intake.submitInTx(
        tx,
        StaticCaller.source(),
        invoice('race-3', '10', { date: dayIn(3) }),
      );
      posted();
      await held;
    });
    await inside;
    const close = periods.close(closer(), { company, period: month(3) });
    expect(await settled(close, 400)).toBe(false);
    release();
    await posting;
    expect((await close).status).toBe('CLOSED');
    expect(await codeOf(core.submit(invoice('race-4', '10', { date: dayIn(3) })))).toBe(
      'FIN_PERIOD_CLOSED',
    );
  });
});
