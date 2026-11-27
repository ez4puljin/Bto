import { plainToInstance } from 'class-transformer';
import { IsOptional, validateSync } from 'class-validator';
import { IsDateOnly } from './date-only';

class DayInput {
  @IsDateOnly()
  day: string;
}

class OptionalDayInput {
  @IsOptional()
  @IsDateOnly()
  day?: string | null;
}

describe('calendar date validation', () => {
  it.each(['2024-02-29', '2026-01-01', '2026-04-30', '2026-12-31'])(
    'accepts the calendar day %s',
    (day) => expect(validateSync(plainToInstance(DayInput, { day }))).toEqual([]),
  );

  it.each([
    '2025-02-29',
    '2026-02-30',
    '2026-04-31',
    '2026-00-10',
    '2026-13-01',
    '2026-11-00',
    '2026-1-01',
    '2026-01-01T00:00:00Z',
    '',
    20260101,
    null,
    undefined,
    ['2026-01-01'],
    { date: '2026-01-01' },
  ])('rejects an impossible, malformed or non-string day %j', (day) => {
    const errors = validateSync(plainToInstance(DayInput, { day }));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('isDate');
  });

  it('preserves the existing optional/null semantics of the owning DTO', () => {
    expect(validateSync(plainToInstance(OptionalDayInput, {}))).toEqual([]);
    expect(validateSync(plainToInstance(OptionalDayInput, { day: null }))).toEqual([]);
  });
});
