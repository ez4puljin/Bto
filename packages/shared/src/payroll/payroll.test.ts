import { describe, expect, it } from 'vitest';
import {
  attendanceCounts,
  attendanceScore,
  checkPayrollSettings,
  DEFAULT_PAYROLL_SETTINGS,
  employedSpan,
  isPayrollMonth,
  isSalaryProrated,
  kpiEarned,
  payrollMonthRange,
  payslipTotals,
  pitCreditFor,
  plannedWorkdays,
  proratedSalary,
  salaryDays,
} from './index';

const day = (status: string, lateMinutes = 0, planned = true) => ({ status, planned, lateMinutes });

describe('a KPI item', () => {
  it('earns the scored percent of its amount', () => {
    expect(kpiEarned('300000', '50').toString()).toBe('150000');
    expect(kpiEarned('300000', '100').toString()).toBe('300000');
    expect(kpiEarned('100000', '33.33').toString()).toBe('33330');
  });

  it('holds the score to 0–100 %', () => {
    expect(kpiEarned('300000', '140').toString()).toBe('300000');
    expect(kpiEarned('300000', '-5').toString()).toBe('0');
  });
});

describe('the attendance KPI', () => {
  it('counts planned days, attended days and late days from the report', () => {
    const days = [
      ...Array.from({ length: 18 }, () => day('PRESENT')),
      day('LATE', 12),
      day('LATE', 3),
      day('ABSENT'),
      day('ABSENT'),
      day('OFF', 0, false),
      // Work on a day off counts nowhere.
      day('PRESENT', 0, false),
    ];
    expect(attendanceCounts(days)).toEqual({ workdays: 22, attendedDays: 20, lateDays: 2 });
  });

  it('counts an approved whole-day leave or trip as attended', () => {
    expect(attendanceCounts([day('LEAVE'), day('AWAY'), day('OPEN'), day('ABSENT')])).toEqual({
      workdays: 4,
      attendedDays: 3,
      lateDays: 0,
    });
  });

  it("gives the owner's example: 200,000 with 20 of 22 days and 2 late days is 173,800", () => {
    const score = attendanceScore({ workdays: 22, attendedDays: 20, lateDays: 2 }, '2');
    expect(score.basePercent.toString()).toBe('90.9');
    expect(score.penaltyPercent.toString()).toBe('4');
    expect(score.scorePercent.toString()).toBe('86.9');
    expect(kpiEarned('200000', score.scorePercent).toString()).toBe('173800');
  });

  it('never goes below zero and is full when no day was planned', () => {
    expect(
      attendanceScore({ workdays: 20, attendedDays: 2, lateDays: 2 }, '10').scorePercent.toString(),
    ).toBe('0');
    expect(
      attendanceScore({ workdays: 0, attendedDays: 0, lateDays: 0 }, '2').scorePercent.toString(),
    ).toBe('100');
  });
});

describe('the payslip', () => {
  const settings = DEFAULT_PAYROLL_SETTINGS;

  it('takes insurance and income tax from an insured employee', () => {
    // 1,000,000 + 173,800 + 150,000 = 1,323,800.
    const totals = payslipTotals(
      {
        baseSalary: '1000000',
        kpiEarned: ['173800', '150000'],
        taxableAdditions: '0',
        otherAdditions: '0',
        deductions: '0',
        advance: '300000',
        paysSocialInsurance: true,
      },
      settings,
    );
    expect(totals.kpiTotal.toString()).toBe('323800');
    expect(totals.gross.toString()).toBe('1323800');
    // 11.5 % and 12.5 % of 1,323,800.
    expect(totals.employeeSi.toString()).toBe('152237');
    expect(totals.employerSi.toString()).toBe('165475');
    // Taxable 1,171,563: 10 % = 117,156.30, less the 16,000 credit of the 1.0–1.5 million step.
    expect(totals.taxable.toString()).toBe('1171563');
    expect(totals.pitCredit.toString()).toBe('16000');
    expect(totals.pit.toString()).toBe('101156.3');
    expect(totals.net.toString()).toBe('770406.7');
  });

  it('takes neither from an employee who pays no social insurance', () => {
    const totals = payslipTotals(
      {
        baseSalary: '800000',
        kpiEarned: ['150000'],
        taxableAdditions: '50000',
        otherAdditions: '20000',
        deductions: '10000',
        advance: '200000',
        paysSocialInsurance: false,
      },
      settings,
    );
    expect(totals.gross.toString()).toBe('1000000');
    expect(totals.employeeSi.toString()).toBe('0');
    expect(totals.employerSi.toString()).toBe('0');
    expect(totals.pit.toString()).toBe('0');
    expect(totals.net.toString()).toBe('810000');
  });

  it('caps the insurance base at ten minimum wages', () => {
    const totals = payslipTotals(
      {
        baseSalary: '10000000',
        kpiEarned: [],
        taxableAdditions: '0',
        otherAdditions: '0',
        deductions: '0',
        advance: '0',
        paysSocialInsurance: true,
      },
      settings,
    );
    expect(totals.siBase.toString()).toBe('7920000');
    expect(totals.employeeSi.toString()).toBe('910800');
    expect(totals.pitCredit.toString()).toBe('0');
    expect(totals.pit.toString()).toBe('908920');
  });

  it('never lets the credit exceed the tax, and shows a negative net when advances exceed the pay', () => {
    const totals = payslipTotals(
      {
        baseSalary: '100000',
        kpiEarned: [],
        taxableAdditions: '0',
        otherAdditions: '0',
        deductions: '0',
        advance: '150000',
        paysSocialInsurance: true,
      },
      settings,
    );
    expect(totals.pit.toString()).toBe('0');
    expect(totals.pitCredit.toString()).toBe('8850');
    expect(totals.net.toString()).toBe('-61500');
  });

  it('reads the credit table by steps', () => {
    expect(pitCreditFor('500000', settings.pitCredits).toString()).toBe('20000');
    expect(pitCreditFor('500000.01', settings.pitCredits).toString()).toBe('18000');
    expect(pitCreditFor('3000001', settings.pitCredits).toString()).toBe('0');
    expect(pitCreditFor('100', []).toString()).toBe('0');
  });
});

describe('the settings and the month', () => {
  it('accepts the defaults and refuses a falling credit table or a percent above 100', () => {
    expect(checkPayrollSettings(DEFAULT_PAYROLL_SETTINGS)).toMatchObject({ ok: true });
    expect(
      checkPayrollSettings({ ...DEFAULT_PAYROLL_SETTINGS, employeeSiPercent: '101' }),
    ).toMatchObject({ ok: false, path: 'employeeSiPercent' });
    expect(
      checkPayrollSettings({
        ...DEFAULT_PAYROLL_SETTINGS,
        pitCredits: [
          { upTo: '1000', credit: '5' },
          { upTo: '500', credit: '1' },
        ],
      }),
    ).toMatchObject({ ok: false, path: 'pitCredits[1].upTo' });
    expect(
      checkPayrollSettings({
        ...DEFAULT_PAYROLL_SETTINGS,
        pitCredits: [
          { upTo: null, credit: '5' },
          { upTo: '500', credit: '1' },
        ],
      }),
    ).toMatchObject({ ok: false, path: 'pitCredits[0].upTo' });
  });

  it('knows a month and its days', () => {
    expect(isPayrollMonth('2026-10')).toBe(true);
    expect(isPayrollMonth('2026-13')).toBe(false);
    expect(payrollMonthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('the fixed salary of a person who joined or left inside the month', () => {
  // Monday to Friday; October 2026 plans 22 workdays (it starts on a Thursday).
  const work = { start: '09:00', end: '18:00', breakMinutes: 0, minutes: 540, flexible: false };
  const weekdays = [work, work, work, work, work, null, null];

  it('counts the planned workdays of the schedule', () => {
    expect(plannedWorkdays(weekdays, '2026-10-01', '2026-10-31')).toBe(22);
    expect(plannedWorkdays(weekdays, '2026-11-01', '2026-11-30')).toBe(21);
    expect(plannedWorkdays(weekdays, '2026-10-16', '2026-10-31')).toBe(11);
    expect(plannedWorkdays(weekdays, '2026-10-03', '2026-10-04')).toBe(0);
    expect(plannedWorkdays(weekdays, '2026-10-05', '2026-10-01')).toBe(0);
  });

  it('pays the owner’s example: 1,000,000, 22 workdays, 11 of them employed → 500,000', () => {
    expect(proratedSalary('1000000', 11, 22).toFixed(2)).toBe('500000.00');
    // Joined on the 16th: the span holds 11 of the month's 22 workdays.
    const joined = salaryDays('2026-10', weekdays, '2026-10-16', null);
    expect(joined).toEqual({ days: 11, monthDays: 22 });
    expect(isSalaryProrated(joined.days, joined.monthDays)).toBe(true);
    expect(proratedSalary('1000000', joined.days, joined.monthDays).toFixed(2)).toBe('500000.00');
  });

  it('splits the salary of someone who left inside the month, HALF_UP to two decimals', () => {
    expect(employedSpan('2026-10', '2024-05-01', '2026-10-09')).toEqual({
      from: '2026-10-01',
      to: '2026-10-09',
    });
    // Left on Friday the 9th: 7 of 22 workdays; 1,000,000 × 7 ÷ 22 = 318,181.818…
    const left = salaryDays('2026-10', weekdays, '2024-05-01', '2026-10-09');
    expect(left).toEqual({ days: 7, monthDays: 22 });
    expect(proratedSalary('1000000', left.days, left.monthDays).toFixed(2)).toBe('318181.82');
    // Joined and left inside the same month.
    expect(salaryDays('2026-10', weekdays, '2026-10-12', '2026-10-16')).toEqual({
      days: 5,
      monthDays: 22,
    });
  });

  it('pays a whole month whole', () => {
    for (const [employedOn, leftOn] of [
      [null, null],
      ['2025-03-01', null],
      ['2026-10-01', '2026-10-31'],
      [null, '2026-11-15'],
    ] as const) {
      const counts = salaryDays('2026-10', weekdays, employedOn, leftOn);
      expect(counts).toEqual({ days: 22, monthDays: 22 });
      expect(isSalaryProrated(counts.days, counts.monthDays)).toBe(false);
      expect(proratedSalary('1000000', counts.days, counts.monthDays).toFixed(2)).toBe(
        '1000000.00',
      );
    }
    // Days off before the first workday cost nothing: November 2026 starts on a Sunday.
    expect(salaryDays('2026-11', weekdays, '2026-11-01', null)).toEqual({
      days: 21,
      monthDays: 21,
    });
    expect(salaryDays('2026-11', weekdays, '2026-11-02', null)).toEqual({
      days: 21,
      monthDays: 21,
    });
    // A month without a planned workday, and no counts at all (a line before this rule), pay whole.
    expect(proratedSalary('1000000', 0, 0).toFixed(2)).toBe('1000000.00');
    expect(isSalaryProrated(null, null)).toBe(false);
    expect(employedSpan('2026-10', '2026-11-02', null)).toBeNull();
  });
});
