import { Decimal } from '@tugeel/shared/money';
import type { ErkhetJournalLine } from '../../../integrations/erkhet';
import {
  type CopyFacts,
  countPlan,
  groupJournal,
  openingPosting,
  pairOldestFirst,
  planCopy,
  sumOpening,
  trPosting,
} from './erkhet-ledger-plan';

// Synthetic rows only.

const line = (over: Partial<ErkhetJournalLine> = {}): ErkhetJournalLine => ({
  trId: 5001,
  ptrId: 700,
  date: '2026-10-05',
  accountCode: '120101',
  debit: '1000.00',
  credit: '0.00',
  description: 'Туршилтын борлуулалт',
  billNumber: 'T-001',
  customer: '90001 - Туршилт дэлгүүр',
  ...over,
});
const party = (code: string) => ({
  ref: `customer:${code}`,
  kind: 'COMPANY' as const,
  name: `Туршилт ${code}`,
});
const known = (code: string) => code === '90001' || code === '90002';

describe('groupJournal', () => {
  it('groups lines into transactions and numbers them in order, across a page break', () => {
    const trs = groupJournal([
      line({ trId: 2, customer: '90001 - Нэг', debit: '100.00' }),
      line({ trId: 2, customer: '90002 - Хоёр', debit: '200.00' }),
      line({ trId: 1, debit: '0.00', credit: '50.00' }),
      // The same transaction again after another one: a page ended inside it.
      line({ trId: 2, customer: '90001 - Нэг', debit: '300.00' }),
    ]);
    expect(trs.map((tr) => tr.trId)).toEqual([2, 1]);
    expect(trs[0]?.lines.map((one) => [one.n, one.partyCode, one.debit.toFixed(2)])).toEqual([
      [1, '90001', '100.00'],
      [2, '90002', '200.00'],
      [3, '90001', '300.00'],
    ]);
    expect(trs[0]?.debit.toFixed(2)).toBe('600.00');
    expect(trs[1]?.credit.toFixed(2)).toBe('50.00');
  });

  it('hashes what a copy carries: a changed amount, text or party is another hash', () => {
    const hash = (over: Partial<ErkhetJournalLine>) => groupJournal([line(over)])[0]?.hash;
    const base = hash({});
    expect(hash({})).toBe(base);
    expect(hash({ debit: '1000.01' })).not.toBe(base);
    expect(hash({ description: 'Өөр утга' })).not.toBe(base);
    expect(hash({ customer: '90002 - Хоёр' })).not.toBe(base);
    expect(hash({ date: '2026-10-06' })).not.toBe(base);
    // The party's name alone is not copied.
    expect(hash({ customer: '90001 - Шинэ нэр' })).toBe(base);
  });

  it('keeps a line without a party under an empty code', () => {
    expect(groupJournal([line({ customer: '' })])[0]?.lines[0]?.partyCode).toBe('');
  });
});

describe('sumOpening', () => {
  it('sums debit and credit per party', () => {
    const sums = sumOpening([
      line({ customer: '90002 - Хоёр', debit: '10.00' }),
      line({ customer: '90001 - Нэг', debit: '100.00' }),
      line({ customer: '90001 - Нэг', debit: '0.00', credit: '30.50' }),
    ]);
    expect(
      sums.map((sum) => [sum.partyCode, sum.debit.toFixed(2), sum.credit.toFixed(2), sum.lines]),
    ).toEqual([
      ['90001', '100.00', '30.50', 2],
      ['90002', '10.00', '0.00', 1],
    ]);
  });
});

describe('planCopy', () => {
  const copy = (over: Partial<CopyFacts> = {}): CopyFacts => ({
    hash: 'h1',
    gone: false,
    state: 'PENDING',
    postedHash: null,
    partyCodes: ['90001'],
    ...over,
  });

  it('posts a new transaction', () => {
    expect(planCopy(copy(), known)).toBe('POST');
  });

  it('leaves a posted one alone while Erkhet says the same', () => {
    expect(planCopy(copy({ state: 'POSTED', postedHash: 'h1' }), known)).toBe('NONE');
  });

  it('revises a changed one', () => {
    expect(planCopy(copy({ state: 'POSTED', postedHash: 'h0' }), known)).toBe('REVISE');
    expect(planCopy(copy({ state: 'BLOCKED', postedHash: 'h0' }), known)).toBe('REVISE');
  });

  it('reverses a vanished one, and drops one that was never posted', () => {
    expect(planCopy(copy({ gone: true, state: 'POSTED', postedHash: 'h1' }), known)).toBe(
      'REVERSE',
    );
    expect(planCopy(copy({ gone: true }), known)).toBe('DROP');
    expect(planCopy(copy({ gone: true, state: 'UNMATCHED' }), known)).toBe('DROP');
    expect(planCopy(copy({ gone: true, state: 'REVERSED' }), known)).toBe('NONE');
  });

  it('leaves out a transaction with a party Bto does not have, then picks it up', () => {
    const unmatched = copy({ partyCodes: ['90001', '70007'] });
    expect(planCopy(unmatched, known)).toBe('LEAVE_OUT');
    expect(planCopy({ ...unmatched, state: 'UNMATCHED' }, known)).toBe('NONE');
    expect(planCopy({ ...unmatched, state: 'UNMATCHED' }, () => true)).toBe('POST');
    expect(planCopy(copy({ partyCodes: [''] }), () => true)).toBe('LEAVE_OUT');
  });

  it('takes back a posted one whose party is no longer known', () => {
    expect(
      planCopy(copy({ state: 'POSTED', postedHash: 'h0', partyCodes: ['70007'] }), known),
    ).toBe('UNMATCH');
  });

  it('posts again what «Хуулсныг буцаах» reversed', () => {
    expect(planCopy(copy({ state: 'REVERSED' }), known)).toBe('POST');
  });

  it('counts a plan', () => {
    expect(countPlan(['POST', 'POST', 'NONE', 'REVISE'])).toMatchObject({
      POST: 2,
      NONE: 1,
      REVISE: 1,
      REVERSE: 0,
    });
  });
});

describe('trPosting', () => {
  it('posts each line under its party against the clearing account, balanced', () => {
    const [tr] = groupJournal([
      line({ customer: '90001 - Нэг', debit: '100.00' }),
      line({ customer: '90002 - Хоёр', debit: '0.00', credit: '40.00', billNumber: '' }),
    ]);
    if (!tr) throw new Error('no transaction');
    const posting = trPosting(tr, 'RECEIVABLE', '120101', party);
    expect(posting?.docNo).toBe('T-001');
    expect(posting?.body.controlTotal).toBe('140.00');
    expect(posting?.body.party).toBeUndefined();
    expect(
      posting?.body.lines.map((one) => [one.key, one.side, one.amount, one.party?.ref ?? null]),
    ).toEqual([
      ['AR', 'DEBIT', '100.00', 'customer:90001'],
      ['AR', 'CREDIT', '40.00', 'customer:90002'],
      ['ERKHET_CLEARING', 'CREDIT', '100.00', null],
      ['ERKHET_CLEARING', 'DEBIT', '40.00', null],
    ]);
    expect(posting?.body.attributes).toMatchObject({
      erkhetAccount: '120101',
      erkhetTr: '5001',
      billNumber: 'T-001',
    });
  });

  it('names the header party when the transaction has one, and uses the payable key', () => {
    const [tr] = groupJournal([line({ accountCode: '310101', debit: '0.00', credit: '7.00' })]);
    if (!tr) throw new Error('no transaction');
    const posting = trPosting(tr, 'PAYABLE', '310101', party);
    expect(posting?.body.party?.ref).toBe('customer:90001');
    expect(posting?.body.lines[0]).toMatchObject({ key: 'AP', side: 'CREDIT', amount: '7.00' });
  });

  it('posts nothing for a transaction without amounts', () => {
    const [tr] = groupJournal([line({ debit: '0.00', credit: '0.00' })]);
    if (!tr) throw new Error('no transaction');
    expect(trPosting(tr, 'RECEIVABLE', '120101', party)).toBeNull();
  });
});

describe('openingPosting', () => {
  it('posts the net balance on its side, dated the day before the start', () => {
    const debit = openingPosting(
      { partyCode: '90001', debit: new Decimal('500'), credit: new Decimal('120.50') },
      'RECEIVABLE',
      '120101',
      '2026-09-30',
      party('90001'),
    );
    expect(debit?.body.documentDate).toBe('2026-09-30');
    expect(debit?.body.lines.map((one) => [one.key, one.side, one.amount])).toEqual([
      ['AR', 'DEBIT', '379.50'],
      ['ERKHET_CLEARING', 'CREDIT', '379.50'],
    ]);
    const credit = openingPosting(
      { partyCode: '80001', debit: new Decimal('0'), credit: new Decimal('90') },
      'PAYABLE',
      '310101',
      '2026-09-30',
      party('80001'),
    );
    expect(credit?.body.lines[0]).toMatchObject({ key: 'AP', side: 'CREDIT', amount: '90.00' });
    expect(
      openingPosting(
        { partyCode: '90001', debit: new Decimal('5'), credit: new Decimal('5') },
        'RECEIVABLE',
        '120101',
        '2026-09-30',
        party('90001'),
      ),
    ).toBeNull();
  });
});

describe('pairOldestFirst', () => {
  const item = (id: number, side: 'DEBIT' | 'CREDIT', date: string, open: string) => ({
    id,
    side,
    date,
    open: new Decimal(open),
  });

  it('closes the oldest debits with the oldest credits', () => {
    const pairs = pairOldestFirst(
      [
        item(3, 'DEBIT', '2026-10-03', '100'),
        item(1, 'DEBIT', '2026-10-01', '50'),
        item(2, 'CREDIT', '2026-10-02', '120'),
        item(4, 'CREDIT', '2026-10-04', '10'),
      ],
      200,
    );
    expect(pairs.map((pair) => [pair.debitId, pair.creditId, pair.amount.toFixed(2)])).toEqual([
      [1, 2, '50.00'],
      [3, 2, '70.00'],
      [3, 4, '10.00'],
    ]);
  });

  it('pairs nothing without both sides, and stops at the limit', () => {
    expect(pairOldestFirst([item(1, 'DEBIT', '2026-10-01', '5')], 200)).toEqual([]);
    expect(
      pairOldestFirst(
        [
          item(1, 'DEBIT', '2026-10-01', '1'),
          item(2, 'DEBIT', '2026-10-01', '1'),
          item(3, 'CREDIT', '2026-10-01', '2'),
        ],
        1,
      ),
    ).toHaveLength(1);
  });
});
