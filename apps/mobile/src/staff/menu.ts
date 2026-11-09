import { isRep, mayPick, mayRequestTransfers } from '../state/phase';
import type { Me } from '../api/session';

// «Цэс» of the staff app (ADR-0174): every screen the app has, by the person's rights, and the
// favourites picked from them. Pure, so the rights are tested without a phone.

export type MenuKey =
  | 'rep'
  | 'picking'
  | 'transfers'
  | 'expiry'
  | 'attendance'
  | 'attendanceRequests'
  | 'attendanceHistory'
  | 'community'
  | 'notices'
  | 'news'
  | 'polls'
  | 'calendar'
  | 'thanks'
  | 'feedback'
  | 'location'
  | 'myDetails'
  | 'repNotifications'
  | 'repSettings'
  | 'profile';

export type MenuGroupKey = 'work' | 'attendance' | 'community' | 'me';

export interface MenuItem {
  key: MenuKey;
  href: string;
}

export interface MenuGroup {
  key: MenuGroupKey;
  items: MenuItem[];
}

type Rights = Pick<Me, 'permissions'>;

/** The groups with what this person may open, in the order «Цэс» draws them; an empty one is gone. */
export function menuOf(me: Rights): MenuGroup[] {
  const rep = isRep(me);
  const groups: MenuGroup[] = [
    {
      key: 'work',
      items: [
        ...(rep ? [{ key: 'rep' as const, href: '/rep' }] : []),
        ...(mayPick(me) ? [{ key: 'picking' as const, href: '/picking' }] : []),
        ...(mayRequestTransfers(me) ? [{ key: 'transfers' as const, href: '/transfers' }] : []),
        { key: 'expiry', href: '/expiry' },
      ],
    },
    {
      key: 'attendance',
      items: [
        { key: 'attendance', href: '/attendance' },
        { key: 'attendanceRequests', href: '/attendance/requests' },
        { key: 'attendanceHistory', href: '/attendance/history' },
      ],
    },
    {
      key: 'community',
      items: [
        { key: 'community', href: '/community' },
        { key: 'notices', href: '/community/messages?kind=NOTICE' },
        { key: 'news', href: '/community/messages?kind=NEWS' },
        { key: 'polls', href: '/community/polls' },
        { key: 'calendar', href: '/community/calendar' },
        { key: 'thanks', href: '/community/thanks' },
        { key: 'feedback', href: '/community/feedback' },
        { key: 'location', href: '/community/location' },
        { key: 'myDetails', href: '/community/profile' },
      ],
    },
    {
      key: 'me',
      items: [
        ...(rep
          ? [
              { key: 'repNotifications' as const, href: '/notifications' },
              { key: 'repSettings' as const, href: '/settings' },
            ]
          : []),
        { key: 'profile', href: rep ? '/profile' : '/me' },
      ],
    },
  ];
  return groups.filter((group) => group.items.length > 0);
}

/** Before the person has chosen any: their work first, then the company's side. */
const FIRST_FAVOURITES: readonly MenuKey[] = ['rep', 'picking', 'transfers', 'community'];

/**
 * The favourites to draw: what the person chose, in that order, without what they may no longer
 * open; nothing stored yet (`null`) gives their work and «Хамт олон».
 */
export function favouritesOf(stored: unknown, groups: readonly MenuGroup[]): MenuItem[] {
  const items = groups.flatMap((group) => group.items);
  const keys = Array.isArray(stored) ? (stored as unknown[]) : FIRST_FAVOURITES;
  return keys.flatMap((key) => items.filter((item) => item.key === key));
}

/** The chosen list with `key` added at the end or taken out. */
export function toggledFavourites(current: readonly MenuKey[], key: MenuKey): MenuKey[] {
  return current.includes(key) ? current.filter((one) => one !== key) : [...current, key];
}
