import { plainToInstance } from 'class-transformer';
import { IsOptional, validateSync } from 'class-validator';
import { commaSeparatedIds, IsCommaSeparatedIds } from './comma-separated-ids';

class QueryDto {
  @IsOptional()
  @IsCommaSeparatedIds(100)
  pipelineIds?: string;
}

describe('comma-separated query ids', () => {
  it.each([
    ['', []],
    ['1', [1]],
    ['001,2,1', [1, 2, 1]],
    ['9007199254740991', [Number.MAX_SAFE_INTEGER]],
  ])('preserves a valid legacy query %j', (value, expected) => {
    expect(commaSeparatedIds(value)).toEqual(expected);
    expect(validateSync(plainToInstance(QueryDto, { pipelineIds: value }))).toEqual([]);
  });

  it.each([
    '99999999999999999999',
    '9'.repeat(1000),
    '9007199254740992',
    '0',
    '000',
    ',',
    ',1',
    '1,',
    '1,,2',
    '-1',
    '+1',
    '1.0',
    '1tail',
    ' 1',
    '1, 2',
    1,
    ['1', '2'],
    {},
  ])('rejects malformed or unsafe ids %j without truncation', (value) => {
    expect(commaSeparatedIds(value)).toBeNull();
    expect(validateSync(plainToInstance(QueryDto, { pipelineIds: value }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'pipelineIds' })]),
    );
  });

  it('accepts at most 100 ids, preserving omitted and explicit empty legacy queries', () => {
    const maximum = Array.from({ length: 100 }, () => String(Number.MAX_SAFE_INTEGER)).join(',');
    expect(commaSeparatedIds(maximum)).toHaveLength(100);
    expect(commaSeparatedIds(`${maximum},1`)).toBeNull();
    expect(validateSync(plainToInstance(QueryDto, {}))).toEqual([]);
  });
});
