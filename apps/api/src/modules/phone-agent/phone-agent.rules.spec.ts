import {
  confirmed,
  emptySchedule,
  isWorkingTime,
  normalizeSchedule,
  outcomeOf,
  type PhoneMessageRole,
  sameTurn,
  scheduleIssues,
} from './phone-agent.rules';

/** An instant by its Ulaanbaatar wall clock (UTC+8, no daylight saving). */
const ub = (wall: string) => new Date(`${wall}:00+08:00`);

describe('the phone line’s working hours (ADR-0232 answer 5)', () => {
  const schedule = normalizeSchedule({
    week: {
      '1': [
        ['09:00', '13:00'],
        ['14:00', '18:00'],
      ],
      '6': [['10:00', '15:00']],
    },
    exceptions: [
      { date: '2026-11-26', intervals: [] },
      { date: '2026-11-29', intervals: [['00:00', '24:00']] },
    ],
  });

  it('is working inside an interval of the weekday, `[from, to)`, in Ulaanbaatar', () => {
    // 2026-11-23 is a Monday.
    expect(isWorkingTime(schedule, ub('2026-11-23T09:00'))).toBe(true);
    expect(isWorkingTime(schedule, ub('2026-11-23T12:59'))).toBe(true);
    expect(isWorkingTime(schedule, ub('2026-11-23T13:00'))).toBe(false);
    expect(isWorkingTime(schedule, ub('2026-11-23T08:59'))).toBe(false);
    expect(isWorkingTime(schedule, ub('2026-11-23T18:00'))).toBe(false);
    // Saturday by the shop's clock, though still Friday in UTC.
    expect(isWorkingTime(schedule, new Date('2026-11-28T02:30:00Z'))).toBe(true);
    // A weekday without intervals: the AI answers all day.
    expect(isWorkingTime(schedule, ub('2026-11-24T11:00'))).toBe(false);
    expect(isWorkingTime(emptySchedule(), ub('2026-11-23T11:00'))).toBe(false);
  });

  it('lets a dated exception replace its day', () => {
    // A Thursday holiday without hours; a Sunday worked through.
    expect(isWorkingTime(schedule, ub('2026-11-26T11:00'))).toBe(false);
    expect(isWorkingTime(schedule, ub('2026-11-29T23:59'))).toBe(true);
    expect(isWorkingTime(schedule, ub('2026-11-30T00:00'))).toBe(false);
  });

  it('refuses a schedule that is not one', () => {
    expect(scheduleIssues(schedule)).toEqual([]);
    expect(scheduleIssues(null)).toEqual([{ path: 'schedule', code: 'shape' }]);
    expect(scheduleIssues({ week: { '1': [['18:00', '09:00']] } })).toEqual([
      { path: 'schedule.week.1.0', code: 'order' },
    ]);
    expect(
      scheduleIssues({
        week: {
          '2': [
            ['09:00', '13:00'],
            ['12:00', '18:00'],
          ],
        },
      }),
    ).toEqual([{ path: 'schedule.week.2.1', code: 'order' }]);
    expect(scheduleIssues({ week: { '3': [['9:00', '25:00']] } })).toEqual([
      { path: 'schedule.week.3.0', code: 'time' },
    ]);
    expect(scheduleIssues({ week: { '0': [] } })).toEqual([
      { path: 'schedule.week', code: 'shape' },
    ]);
    expect(
      scheduleIssues({
        week: {},
        exceptions: [
          { date: '2026-13-40', intervals: [] },
          { date: '2026-12-31', intervals: [] },
          { date: '2026-12-31', intervals: [] },
        ],
      }),
    ).toEqual([
      { path: 'schedule.exceptions.0.date', code: 'date' },
      { path: 'schedule.exceptions.2.date', code: 'duplicate' },
    ]);
  });
});

describe('«no order without yes» (ADR-0232 #7)', () => {
  const turns = (...roles: [PhoneMessageRole, string?][]) =>
    roles.map(([role, text], index) => ({ seq: index + 1, role, text: text ?? 'үг' }));

  it('needs the agent’s words after the quote and the caller’s after those', () => {
    expect(confirmed(turns(['USER'], ['TOOL'], ['AGENT'], ['USER']), 2, 4)).toBe(true);
    expect(confirmed(turns(['USER'], ['TOOL']), 2, 2)).toBe(false);
    expect(confirmed(turns(['USER'], ['TOOL'], ['AGENT']), 2, 3)).toBe(false);
    // The caller spoke before the read-back, not after it.
    expect(confirmed(turns(['AGENT'], ['USER'], ['TOOL'], ['AGENT']), 3, 4)).toBe(false);
    expect(confirmed(turns(['TOOL'], ['USER'], ['AGENT']), 1, 3)).toBe(false);
    // Silence is no answer and no read-back.
    expect(confirmed(turns(['TOOL'], ['AGENT'], ['USER', '  ']), 1, 3)).toBe(false);
    expect(confirmed(turns(['TOOL'], ['AGENT', ''], ['USER']), 1, 3)).toBe(false);
  });

  it('refuses while a turn up to the tool call is missing', () => {
    const all = turns(['TOOL'], ['AGENT'], ['USER'], ['USER']);
    expect(confirmed(all, 1, 4)).toBe(true);
    expect(
      confirmed(
        all.filter((turn) => turn.seq !== 3),
        1,
        4,
      ),
    ).toBe(false);
    expect(confirmed(all.slice(1), 1, 4)).toBe(false);
    expect(confirmed(all, 1, 5)).toBe(false);
  });
});

describe('a call’s outcome and the reconcile’s comparison', () => {
  it('files a call by what it left behind', () => {
    const none = {
      ordered: false,
      callback: false,
      recognised: true,
      statusTold: false,
      failed: false,
    };
    expect(outcomeOf({ ...none, ordered: true, callback: true, failed: true })).toBe('ORDERED');
    expect(outcomeOf({ ...none, callback: true, failed: true })).toBe('CALLBACK');
    expect(outcomeOf({ ...none, failed: true })).toBe('FAILED');
    expect(outcomeOf({ ...none, recognised: false, statusTold: true })).toBe('NO_MATCH');
    expect(outcomeOf({ ...none, statusTold: true })).toBe('STATUS_ONLY');
    expect(outcomeOf(none)).toBe('ABANDONED');
  });

  it('takes two turns for one whatever the case, the spacing or an interruption', () => {
    expect(sameTurn('Кола  байна уу', 'кола байна уу ')).toBe(true);
    expect(sameTurn('Нэг хайрцаг кола, гурван ус', 'Нэг хайрцаг кола')).toBe(true);
    expect(sameTurn('Тийм', 'Тий')).toBe(false);
    expect(sameTurn('Тийм', 'Үгүй')).toBe(false);
  });
});
