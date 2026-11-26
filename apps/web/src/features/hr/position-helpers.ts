import { businessDate } from '@tugeel/shared/time';

/** The next calendar month in the company's business timezone. */
export function nextPositionMonth(): string {
  const [yearText = '', monthText = ''] = businessDate().split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}`;
}
