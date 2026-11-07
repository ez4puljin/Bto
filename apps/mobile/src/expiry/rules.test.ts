import { describe, expect, it } from 'vitest';
import {
  chipCount,
  chosenFromBarcode,
  chosenFromLookup,
  cleanQty,
  createBodyOf,
  daysLeftOf,
  daysWords,
  displayDate,
  duplicateChoiceOf,
  EMPTY_EXPIRY_FORM,
  EXPIRY_CHIPS,
  type ExpiryForm,
  type ExpiryStanding,
  formOf,
  hasProblems,
  isAwaitingRows,
  movesOf,
  patchOf,
  problemsOfEdit,
  problemsOfNew,
} from './rules';

const TODAY = '2026-11-07';
const form = (patch: Partial<ExpiryForm>): ExpiryForm => ({
  ...EMPTY_EXPIRY_FORM,
  date: '2027-01-31',
  floor: '12',
  ...patch,
});
const standing: ExpiryStanding = {
  expiryDate: '2027-01-31',
  qtyFloor: '12',
  qtyWarehouse: '2.5',
  note: 'Эхний тэмдэглэл',
};

describe('the days of a record', () => {
  it('counts whole days from the server’s today, across months and a leap day', () => {
    expect(daysLeftOf(TODAY, TODAY)).toBe(0);
    expect(daysLeftOf('2026-11-08', TODAY)).toBe(1);
    expect(daysLeftOf('2026-11-06', TODAY)).toBe(-1);
    expect(daysLeftOf('2026-12-07', TODAY)).toBe(30);
    expect(daysLeftOf('2028-03-01', '2028-02-28')).toBe(2);
    expect(daysLeftOf('2025-12-31', '2026-01-01')).toBe(-1);
  });

  it('says the days in the shared words', () => {
    expect(daysWords(-3)).toEqual({ key: 'expiry.days.past', n: 3 });
    expect(daysWords(0)).toEqual({ key: 'expiry.days.today', n: 0 });
    expect(daysWords(12)).toEqual({ key: 'expiry.days.left', n: 12 });
  });

  it('shows a date with slashes', () => {
    expect(displayDate('2026-11-07')).toBe('2026/11/07');
  });
});

describe('the chips', () => {
  it('takes each chip’s count from the summary', () => {
    const counts = { active: 5, expired: 1, urgent: 2, soon: 3, archived: 4 };
    expect(EXPIRY_CHIPS.map((chip) => chipCount(counts, chip))).toEqual([5, 1, 2, 3, 4]);
  });
});

describe('an empty list', () => {
  const answered = { isLoading: false, isPlaceholderData: false };

  it('waits on its first read and on an earlier empty answer kept in its place', () => {
    expect(isAwaitingRows({ isLoading: true, isPlaceholderData: false }, 0)).toBe(true);
    expect(isAwaitingRows({ isLoading: false, isPlaceholderData: true }, 0)).toBe(true);
  });

  it('says it is empty once its own answer came', () => {
    expect(isAwaitingRows(answered, 0)).toBe(false);
  });

  it('never waits while there are rows to show, even kept ones', () => {
    expect(isAwaitingRows({ isLoading: false, isPlaceholderData: true }, 3)).toBe(false);
    expect(isAwaitingRows(answered, 3)).toBe(false);
  });
});

describe('what a count’s field keeps', () => {
  it('keeps digits only for a whole unit', () => {
    expect(cleanQty('12', false)).toBe('12');
    expect(cleanQty('1a2 ', false)).toBe('12');
    expect(cleanQty('12.5', false)).toBe('12');
    expect(cleanQty('123456789012345', false)).toBe('12345678901');
  });

  it('keeps one separator and three decimals for a fractional unit', () => {
    expect(cleanQty('2,5', true)).toBe('2.5');
    expect(cleanQty('2.', true)).toBe('2.');
    expect(cleanQty('.5', true)).toBe('0.5');
    expect(cleanQty('1.23456', true)).toBe('1.234');
    expect(cleanQty('1.2.3', true)).toBe('1.23');
  });
});

describe('a new record', () => {
  const problems = (patch: Partial<ExpiryForm>, today: string | null = TODAY, frac = false) =>
    problemsOfNew(form(patch), today, frac);

  it('accepts a date, a count on either side, and a past date: finding expired goods is the point', () => {
    expect(hasProblems(problems({}))).toBe(false);
    expect(hasProblems(problems({ floor: '', warehouse: '3' }))).toBe(false);
    expect(hasProblems(problems({ date: '2026-01-02' }))).toBe(false);
  });

  it('refuses a date that is not whole or real, and one too far either way', () => {
    expect(problems({ date: '' }).date).toBe('date');
    expect(problems({ date: '2026-11' }).date).toBe('date');
    expect(problems({ date: '2027-02-30' }).date).toBe('date');
    expect(problems({ date: '2021-11-06' }).date).toBe('range');
    expect(problems({ date: '2021-11-07' }).date).toBeNull();
    expect(problems({ date: '2041-11-07' }).date).toBeNull();
    expect(problems({ date: '2041-11-08' }).date).toBe('range');
  });

  it('leaves the range to the server when the summary has not told today', () => {
    expect(problems({ date: '2001-01-01' }, null).date).toBeNull();
    expect(problems({ date: '2001-13-01' }, null).date).toBe('date');
  });

  it('wants a whole number unless the base unit is known to be fractional', () => {
    expect(problems({ floor: '2.5' }).floor).toBe('whole');
    expect(problemsOfNew(form({ floor: '2.5' }), TODAY, null).floor).toBe('whole');
    expect(problemsOfNew(form({ warehouse: '2.5' }), TODAY, true).warehouse).toBeNull();
    expect(problemsOfNew(form({ floor: '2.' }), TODAY, true).floor).toBe('qty');
  });

  it('wants at least one count above zero', () => {
    expect(problems({ floor: '', warehouse: '' }).counts).toBe(true);
    expect(problems({ floor: '0', warehouse: '00' }).counts).toBe(true);
    expect(problems({ floor: '0', warehouse: '1' }).counts).toBe(false);
    expect(problemsOfNew(form({ floor: '0.001' }), TODAY, true).counts).toBe(false);
  });

  it('sends an empty count as 0, trims the note and asks for a duplicate only when told', () => {
    expect(createBodyOf(7, form({ floor: '007', warehouse: '', note: '  ' }), false)).toEqual({
      productId: 7,
      expiryDate: '2027-01-31',
      qtyFloor: '7',
      qtyWarehouse: '0',
    });
    expect(createBodyOf(7, form({ note: ' тавиур 3 ' }), true)).toMatchObject({
      note: 'тавиур 3',
      allowDuplicate: true,
    });
  });
});

describe('the yes to a duplicate', () => {
  const given = duplicateChoiceOf(7, form({ warehouse: '3' }));

  it('stands while the product, the date and the counts as sent stand', () => {
    expect(duplicateChoiceOf(7, form({ warehouse: '3' }))).toBe(given);
    expect(duplicateChoiceOf(7, form({ floor: '012', warehouse: '03' }))).toBe(given);
  });

  it('stands when only the note changes', () => {
    expect(duplicateChoiceOf(7, form({ warehouse: '3', note: 'тавиур 3' }))).toBe(given);
  });

  it('ends when the product, the date or a count changes', () => {
    expect(duplicateChoiceOf(8, form({ warehouse: '3' }))).not.toBe(given);
    expect(duplicateChoiceOf(7, form({ warehouse: '3', date: '2027-02-01' }))).not.toBe(given);
    expect(duplicateChoiceOf(7, form({ warehouse: '3', floor: '13' }))).not.toBe(given);
    expect(duplicateChoiceOf(7, form({ warehouse: '4' }))).not.toBe(given);
  });

  it('does not take one side’s count for the other’s', () => {
    expect(duplicateChoiceOf(7, form({ floor: '3', warehouse: '12' }))).not.toBe(given);
  });
});

describe('a correction', () => {
  it('sends nothing while nothing differs', () => {
    expect(patchOf(standing, {}, 4)).toBeNull();
    expect(
      patchOf(
        standing,
        {
          date: '2027-01-31',
          floor: '012',
          warehouse: '2.50',
          note: ' Эхний тэмдэглэл ',
        },
        4,
      ),
    ).toBeNull();
  });

  it('sends the version and only the fields that changed', () => {
    expect(patchOf(standing, { floor: '10' }, 4)).toEqual({ expectedVersion: 4, qtyFloor: '10' });
    expect(patchOf(standing, { date: '2027-02-01', note: '' }, 5)).toEqual({
      expectedVersion: 5,
      expiryDate: '2027-02-01',
      note: '',
    });
    expect(patchOf(standing, { floor: '', warehouse: '0' }, 6)).toEqual({
      expectedVersion: 6,
      qtyFloor: '0',
      qtyWarehouse: '0',
    });
  });

  it('keeps what was typed over what a reload brings, and follows the rest', () => {
    const edits = { floor: '10' };
    const reloaded = { ...standing, qtyWarehouse: '7', note: 'Өөр хүн бичсэн' };
    expect(formOf(reloaded, edits)).toEqual({
      date: '2027-01-31',
      floor: '10',
      warehouse: '7',
      note: 'Өөр хүн бичсэн',
    });
    expect(patchOf(reloaded, edits, 9)).toEqual({ expectedVersion: 9, qtyFloor: '10' });
  });

  it('checks only what changes, and lets both counts reach zero', () => {
    // A carried record: a fraction on a whole unit and a date long past stay correctable.
    const carried = { ...standing, expiryDate: '2010-01-01' };
    expect(hasProblems(problemsOfEdit(carried, { floor: '10' }, TODAY, false))).toBe(false);
    expect(problemsOfEdit(carried, { warehouse: '3.5' }, TODAY, false).warehouse).toBe('whole');
    expect(problemsOfEdit(carried, { date: '2010-01-02' }, TODAY, false).date).toBe('range');
    expect(problemsOfEdit(standing, { date: '' }, TODAY, false).date).toBe('date');
    expect(
      hasProblems(problemsOfEdit(standing, { floor: '0', warehouse: '0' }, TODAY, false)),
    ).toBe(false);
  });
});

describe('a history row', () => {
  it('names only the count that moved, without trailing zeros', () => {
    expect(
      movesOf({
        qtyFloorOld: '12.000',
        qtyFloorNew: '10.000',
        qtyWarehouseOld: '3',
        qtyWarehouseNew: '3.000',
      }),
    ).toEqual({ floor: { from: '12', to: '10' }, warehouse: null });
  });
});

describe('the chosen product', () => {
  const product = { id: 3, sku: 'A-100', name: 'Туршилтын ус', baseUnit: { uomName: 'ш' } };

  it('has no pack from a search or a piece’s barcode', () => {
    expect(chosenFromLookup(product).pack).toBeNull();
    expect(
      chosenFromBarcode({
        product,
        unit: { uomName: 'ш', factorToBase: '1', isBase: true },
      }).pack,
    ).toBeNull();
  });

  it('tells a box’s barcode in the base unit', () => {
    expect(
      chosenFromBarcode({
        product,
        unit: { uomName: 'хайрцаг', factorToBase: '24.000000', isBase: false },
      }),
    ).toEqual({
      id: 3,
      sku: 'A-100',
      name: 'Туршилтын ус',
      baseUnit: 'ш',
      pack: { unit: 'хайрцаг', n: '24' },
    });
  });
});
