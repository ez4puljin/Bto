import { addDays } from '@tugeel/shared/time';
import { ubDate } from '../dates/dates';

// The notifications screen and the popup (ADR-0062 #3), as pure functions over the server's
// answers: no React Native, so Vitest covers them.

/** A running notice as `GET /me/notifications/summary` gives it. */
export interface FeedNotice {
  id: number;
  popup: boolean;
  read: boolean;
  validFrom: string;
  createdAt: string;
}

/** An own notification as `GET /me/notifications` gives it. */
export interface FeedNotification {
  id: number;
  read: boolean;
  createdAt: string;
}

export type FeedItem<N extends FeedNotice, M extends FeedNotification> =
  | { type: 'notice'; key: string; at: string; day: string; notice: N }
  | { type: 'notification'; key: string; at: string; day: string; notification: M };

export interface FeedSection<N extends FeedNotice, M extends FeedNotification> {
  day: string;
  items: FeedItem<N, M>[];
}

/**
 * The notices and the own notifications in one list, newest first, by Ulaanbaatar day. A notice
 * counts from the day it first shows (`validFrom`), so one sent ahead sits on its first day.
 */
export function feedOf<N extends FeedNotice, M extends FeedNotification>(
  notices: readonly N[],
  notifications: readonly M[],
): FeedSection<N, M>[] {
  const items: FeedItem<N, M>[] = [
    ...notices.map((notice) => {
      const created = ubDate(notice.createdAt);
      const day = notice.validFrom > created ? notice.validFrom : created;
      return { type: 'notice' as const, key: `n${notice.id}`, at: notice.createdAt, day, notice };
    }),
    ...notifications.map((notification) => ({
      type: 'notification' as const,
      key: `u${notification.id}`,
      at: notification.createdAt,
      day: ubDate(notification.createdAt),
      notification,
    })),
  ];
  // ISO dates and instants sort as plain strings (no Intl on the phone, ADR-0061 #3).
  const descending = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
  items.sort((a, b) => (a.day === b.day ? descending(a.at, b.at) : descending(a.day, b.day)));
  const sections: FeedSection<N, M>[] = [];
  for (const item of items) {
    const last = sections[sections.length - 1];
    if (last && last.day === item.day) last.items.push(item);
    else sections.push({ day: item.day, items: [item] });
  }
  return sections;
}

export type DayName = 'today' | 'yesterday' | 'date';

/** «Өнөөдөр», «Өчигдөр» or the date, against the server's today. */
export function dayName(day: string, today: string): DayName {
  if (day === today) return 'today';
  if (day === addDays(today, -1)) return 'yesterday';
  return 'date';
}

/** The unread popup notices, newest first: what the app shows when it opens. */
export function popupQueue<N extends FeedNotice>(notices: readonly N[]): N[] {
  return notices.filter((notice) => notice.popup && !notice.read);
}

/** The unread items of a feed (what «Бүгдийг уншсан» marks: only what was loaded). */
export function unreadIds<N extends FeedNotice, M extends FeedNotification>(
  notices: readonly N[],
  notifications: readonly M[],
): { noticeIds: number[]; notificationIds: number[] } {
  return {
    noticeIds: notices.filter((notice) => !notice.read).map((notice) => notice.id),
    notificationIds: notifications.filter((row) => !row.read).map((row) => row.id),
  };
}
