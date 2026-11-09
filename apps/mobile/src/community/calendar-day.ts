/** Whether a calendar item falls on a day: HR's events can run over several days (ADR-0146). */
export function isOnDay(item: { date: string; toDate?: string | null }, day: string): boolean {
  return item.date <= day && day <= (item.toDate ?? item.date);
}
