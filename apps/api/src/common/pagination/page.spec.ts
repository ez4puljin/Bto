import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min, validateSync } from 'class-validator';
import { queryBoolean, queryInteger } from './page';

class Filters {
  @IsOptional()
  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  userId?: number;

  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  includeArchived?: boolean;
}

describe('query value coercion', () => {
  it.each([1, '1', '+1', ' 001 '])('keeps valid integer query values %j', (userId) => {
    const value = plainToInstance(Filters, { userId });
    expect(validateSync(value)).toEqual([]);
    expect(value.userId).toBe(1);
  });

  it.each([
    '1tail',
    '1.5',
    '1e3',
    '',
    '9007199254740992',
    Number.MAX_SAFE_INTEGER + 1,
    [],
    ['1'],
    {},
  ])('rejects malformed integer filters instead of truncating or forgetting %j', (userId) =>
    expect(validateSync(plainToInstance(Filters, { userId }))).toHaveLength(1),
  );

  it.each([
    ['true', true],
    ['false', false],
    [true, true],
    [false, false],
  ])('keeps valid boolean query values %j', (includeArchived, expected) => {
    const value = plainToInstance(Filters, { includeArchived });
    expect(validateSync(value)).toEqual([]);
    expect(value.includeArchived).toBe(expected);
  });

  it.each(['yes', '0', '1', '', [], ['true'], {}, 1])(
    'rejects malformed boolean filters instead of treating them as false %j',
    (includeArchived) =>
      expect(validateSync(plainToInstance(Filters, { includeArchived }))).toHaveLength(1),
  );

  it('leaves omitted filters optional', () => {
    expect(validateSync(plainToInstance(Filters, {}))).toEqual([]);
  });
});
