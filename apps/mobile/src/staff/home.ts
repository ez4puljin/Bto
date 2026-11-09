// The rules of «Нүүр» (ADR-0174 #2, #10), without the phone.

export type Greeting = 'morning' | 'day' | 'evening';

/** «Өглөөний / Өдрийн / Оройн мэнд» by the hour in Ulaanbaatar (UTC+8, no daylight saving). */
export function greetingOf(clock: number): Greeting {
  const hour = new Date(clock + 8 * 3600 * 1000).getUTCHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'day';
  return 'evening';
}

/** The month and day of a `YYYY-MM-DD` date as numbers, for «11-р сарын 9». */
export function monthDayOf(date: string): { month: number; day: number } {
  const [, month = '1', day = '1'] = date.split('-');
  return { month: Number.parseInt(month, 10), day: Number.parseInt(day, 10) };
}

/** The first name of «Б.Болд» or «Батын Болд»: what a greeting calls a person. */
export function firstNameOf(fullName: string): string {
  const name = fullName.trim();
  const dotted = name.lastIndexOf('.');
  if (dotted >= 0 && dotted < name.length - 1) return name.slice(dotted + 1).trim();
  const words = name.split(/\s+/);
  return words[words.length - 1] ?? name;
}
