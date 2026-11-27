import { FinError } from '../errors';
import { monthOf } from './periods';

describe('fiscal calendar months', () => {
  it.each([
    ['2024-02-29', '2024-02-29'],
    ['2026-02-28', '2026-02-28'],
    ['2026-04-30', '2026-04-30'],
    ['2026-12-31', '2026-12-31'],
  ])('keeps the real month containing %s', (date, endsOn) => {
    expect(monthOf(date)).toEqual({
      code: date.slice(0, 7),
      startsOn: `${date.slice(0, 7)}-01`,
      endsOn,
    });
  });

  it.each(['2025-02-29', '2026-02-30', '2026-04-31', '2026-00-10', '2026-11-00'])(
    'rejects the nonexistent day %s before opening or reading a fiscal period',
    (date) => {
      expect(() => monthOf(date)).toThrow(FinError);
      expect(() => monthOf(date)).toThrow(expect.objectContaining({ code: 'FIN_PAYLOAD_INVALID' }));
    },
  );
});
