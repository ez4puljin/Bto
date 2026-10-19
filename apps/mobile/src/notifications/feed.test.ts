import { describe, expect, it } from 'vitest';
import { initialsOf } from '../format/format';
import {
  dayName,
  dropPercent,
  feedOf,
  idsParam,
  percentIn,
  popupQueue,
  replayQueue,
  unreadIds,
} from './feed';

const notice = (
  id: number,
  fields: Partial<{ popup: boolean; read: boolean; validFrom: string; createdAt: string }> = {},
) => ({
  id,
  popup: true,
  read: false,
  validFrom: '2026-10-16',
  createdAt: '2026-10-16T01:00:00.000Z',
  ...fields,
});
const sold = (id: number, createdAt: string, read = false) => ({ id, read, createdAt });

describe('the notifications feed (ADR-0062 #3)', () => {
  it('merges notices and sold orders newest first, by Ulaanbaatar day', () => {
    const sections = feedOf(
      [
        notice(1, { createdAt: '2026-10-16T01:00:00.000Z' }),
        // Sent yesterday to start today: it sits on its first day.
        notice(2, { validFrom: '2026-10-16', createdAt: '2026-10-15T09:00:00.000Z' }),
      ],
      [
        // 16:30Z on the 15th is 00:30 on the 16th in Ulaanbaatar.
        sold(10, '2026-10-15T16:30:00.000Z'),
        sold(11, '2026-10-15T03:00:00.000Z'),
        sold(12, '2026-10-16T05:00:00.000Z'),
      ],
    );
    expect(sections.map((section) => section.day)).toEqual(['2026-10-16', '2026-10-15']);
    expect(sections[0]?.items.map((item) => item.key)).toEqual(['u12', 'n1', 'u10', 'n2']);
    expect(sections[1]?.items.map((item) => item.key)).toEqual(['u11']);
  });

  it('names today and yesterday by the server’s date', () => {
    expect(dayName('2026-10-16', '2026-10-16')).toBe('today');
    expect(dayName('2026-10-15', '2026-10-16')).toBe('yesterday');
    expect(dayName('2026-09-30', '2026-10-01')).toBe('yesterday');
    expect(dayName('2026-10-14', '2026-10-16')).toBe('date');
  });

  it('pops up the unread popup notices only, newest first as the server sent them', () => {
    const queue = popupQueue([
      notice(5),
      notice(4, { read: true }),
      notice(3, { popup: false }),
      notice(2),
    ]);
    expect(queue.map((entry) => entry.id)).toEqual([5, 2]);
  });

  it('marks only what is loaded and unread', () => {
    expect(
      unreadIds([notice(1), notice(2, { read: true })], [sold(9, '2026-10-16T00:00:00.000Z')]),
    ).toEqual({ noticeIds: [1], notificationIds: [9] });
  });
});

describe('initials', () => {
  it('takes the first letter of up to two words', () => {
    expect(initialsOf('Туршилтын Төлөөлөгч')).toBe('ТТ');
    expect(initialsOf('  бат  ')).toBe('Б');
    expect(initialsOf('Бат Эрдэнэ Дорж')).toBe('БЭ');
    expect(initialsOf('')).toBe('');
  });
});

describe('the popup pictures and its replay (ADR-0068)', () => {
  it('replays the notices asked for, in that order', () => {
    const notices = [1, 2, 3].map((id) => ({
      id,
      popup: true,
      read: true,
      validFrom: '2026-10-16',
      createdAt: '2026-10-16T01:00:00Z',
    }));
    expect(replayQueue(notices, [3, 1, 9]).map((notice) => notice.id)).toEqual([3, 1]);
    expect(idsParam('3,x,0,5')).toEqual([3, 5]);
    expect(idsParam(undefined)).toEqual([]);
  });

  it('reads a percentage from a promotion and the drop of a price', () => {
    expect(percentIn('Ус, ундаа 5% хямдарлаа')).toBe('5');
    expect(percentIn('12,5 % хямд')).toBe('12.5');
    expect(percentIn('Шинэ бараа')).toBeNull();
    expect(dropPercent('29100', '27600')).toBe('5');
    expect(dropPercent('1000', '1000')).toBeNull();
    expect(dropPercent(null, '950')).toBeNull();
  });
});
